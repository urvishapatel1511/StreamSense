// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialStatus, useTwitch, type TwitchStatus } from './useTwitch';

const live: TwitchStatus = { ...initialStatus, configured: true, demoMode: false, state: 'listening', user: { id: '42', login: 'fixture_streamer' }, subscriptionConfirmed: true, summary: { ...initialStatus.summary, source: 'twitch' } };
const response = (data: TwitchStatus) => ({ ok: true, json: async () => data }) as Response;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('HTTP polling and disconnect races', () => {
  it('does not apply an old poll while disconnect is pending', async () => {
    const oldPoll = deferred<Response>(), disconnect = deferred<Response>(); let polls = 0;
    vi.stubGlobal('fetch', vi.fn((input: string) => input.endsWith('/disconnect') ? disconnect.promise : ++polls === 1 ? Promise.resolve(response(live)) : oldPoll.promise));
    const { result } = renderHook(useTwitch); await act(flush);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    let ending!: Promise<void>; act(() => { ending = result.current.disconnect(); });
    await act(async () => { oldPoll.resolve(response({ ...live, totalMessages: 7 })); await flush(); });
    expect(result.current.status.totalMessages).toBe(0);
    await act(async () => { disconnect.resolve({ ok: true } as Response); await ending; });
  });
  it('lets disconnect supersede a summary request and ignores its late response', async () => {
    const summary = deferred<Response>(); let disconnected = false;
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.endsWith('/summaries/control')) return summary.promise;
      if (input.endsWith('/disconnect')) { disconnected = true; return { ok: true } as Response; }
      return response(disconnected ? initialStatus : live);
    }));
    const { result } = renderHook(useTwitch); await act(flush);
    let generation!: Promise<void>; act(() => { generation = result.current.controlSummary('generate'); });
    await act(() => result.current.disconnect());
    await act(async () => { summary.resolve(response(live)); await generation; });
    expect(result.current.status.demoMode).toBe(true); expect(result.current.status.user).toBeNull(); expect(result.current.summaryBusy).toBe(false);
  });
  it('aborts a pending disconnect on unmount', async () => {
    const disconnect = deferred<Response>(); let signal: AbortSignal | null | undefined;
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith('/disconnect')) { signal = init?.signal; return disconnect.promise; }
      return response(live);
    }));
    const { result, unmount } = renderHook(useTwitch); await act(flush);
    let ending!: Promise<void>; act(() => { ending = result.current.disconnect(); }); unmount();
    expect(signal?.aborted).toBe(true); disconnect.resolve({ ok: true } as Response); await ending;
  });
  it('sends only one disconnect for repeated activations', async () => {
    const disconnect = deferred<Response>();
    const http = vi.fn((input: string) => input.endsWith('/disconnect') ? disconnect.promise : Promise.resolve(response(live))); vi.stubGlobal('fetch', http);
    const { result } = renderHook(useTwitch); await act(flush);
    let first!: Promise<void>, second!: Promise<void>; act(() => { first = result.current.disconnect(); second = result.current.disconnect(); });
    expect(http.mock.calls.filter(([input]) => input.endsWith('/disconnect'))).toHaveLength(1);
    await act(async () => { disconnect.resolve({ ok: true } as Response); await Promise.all([first, second]); });
  });
  it('reuses unchanged status objects instead of updating the dashboard each poll', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(live))); const { result } = renderHook(useTwitch); await act(flush);
    const previous = result.current.status; await act(() => vi.advanceTimersByTimeAsync(3000)); expect(result.current.status).toBe(previous);
  });
});
