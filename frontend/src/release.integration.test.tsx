// @vitest-environment jsdom
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../backend/src/app';
import { SummaryBatcher } from '../../backend/src/batcher';
import { analyzeBatch, defaultSettings } from '../../backend/src/processing';
import { demoBatch } from '../../backend/src/demo';
import { configuration, FakeSocket, json, notification, subscription, tokens, validation, welcome } from '../../backend/src/testing';
import App from './App';
import type { TwitchStatus } from './useTwitch';

// Real loopback HTTP, routes, sessions, processing and React. Only Twitch and audio are mocked.
const nativeFetch = globalThis.fetch;
let runtime: ReturnType<typeof createApp>;
let server: Server;
let base: string;
let cookie: string;
let sockets: FakeSocket[];
let spoken: SpeechSynthesisUtterance[];
let twitchHttp: ReturnType<typeof vi.fn<typeof fetch>>;
const speech = { getVoices: () => [{ name: 'Device fixture', voiceURI: 'local-fixture', lang: 'en-US', localService: true, default: true }], speak: vi.fn((utterance: SpeechSynthesisUtterance) => spoken.push(utterance)), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() };

async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('Cookie', cookie);
  if (init.method === 'POST') { headers.set('Origin', configuration.frontendUrl); headers.set('X-StreamSense-Request', '1'); headers.set('Content-Type', 'application/json'); }
  const response = await nativeFetch(`${base}${path}`, { ...init, headers, redirect: 'manual' });
  const next = response.headers.get('set-cookie'); if (next) cookie = next.split(';')[0]!;
  return response;
}
async function start(configured: boolean) {
  runtime = createApp({ configuration: configured ? configuration : { missing: ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'], frontendUrl: configuration.frontendUrl }, http: twitchHttp, sockets: () => { const socket = new FakeSocket(); sockets.push(socket); return socket.asSocket(); } });
  await new Promise<void>((resolve, reject) => { server = runtime.app.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve()); });
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => api(String(input), init)));
}
async function login() {
  const auth = await api('/auth/twitch'); const state = new URL(auth.headers.get('location')!).searchParams.get('state')!;
  const callback = await api(`/auth/twitch/callback?code=synthetic-code&state=${state}`); expect(callback.status).toBe(302);
  sockets[0]!.receive(welcome());
  await vi.waitFor(() => expect([...runtime.store.sessions.values()][0]!.chat!.state).toBe('listening'));
}
const action = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const finishAudio = () => act(() => spoken.at(-1)!.onend?.({} as SpeechSynthesisEvent));
beforeEach(() => {
  cookie = ''; sockets = []; spoken = []; localStorage.clear(); vi.clearAllMocks();
  twitchHttp = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    if (String(input).endsWith('/token')) return json(tokens);
    if (String(input).endsWith('/validate')) return json(validation);
    const body = JSON.parse(String(init?.body)) as { transport: { session_id: string } };
    return json(subscription(body.transport.session_id), 202);
  });
  vi.stubGlobal('speechSynthesis', speech); vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
});
afterEach(async () => {
  cleanup(); vi.unstubAllGlobals(); runtime?.close();
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe('release integration through actual local HTTP (mock Twitch and audio)', () => {
  it('works without Twitch credentials: demo → summary → speech controls → silent reload', async () => {
    await start(false); const view = render(<App />); await screen.findByText('Backend online');
    expect(screen.getByRole('button', { name: /Connect Twitch/ }).hasAttribute('disabled')).toBe(true); expect(spoken).toHaveLength(0);
    action('Pause summarisation'); await screen.findByText(/Summarisation paused/);
    action('Enable Speech'); finishAudio(); action('Load Demo Batch'); await screen.findByText(/28 pending/);
    expect(screen.getAllByText('DEMO')).toHaveLength(28); expect(spoken).toHaveLength(1);
    action('Generate summary now'); await waitFor(() => expect(spoken).toHaveLength(2));
    const status = await (await api('/api/twitch/status')).json() as TwitchStatus;
    expect(status.summary.latest!.metrics).toEqual({ messages: 28, questions: 12, repeatedMessages: 12, repeatedGroups: 6 });
    expect(status.summary.latest!.activity.level).toBe('Busy'); expect(spoken[1]!.text).toBe(status.summary.latest!.text);
    expect(screen.getByRole('heading', { name: 'Detected questions' })).toBeTruthy(); expect(screen.getByRole('heading', { name: 'Repeated messages' })).toBeTruthy();
    action('Pause Speech'); expect(speech.pause).toHaveBeenCalled(); action('Resume Speech'); expect(speech.resume).toHaveBeenCalled();
    action('Repeat Last Summary'); expect(spoken.at(-1)!.text).toBe(status.summary.latest!.text); action('Stop Speaking');
    action('Clear summary history'); await screen.findByText(/No generated summaries yet/);
    action('Load Demo Batch'); await screen.findByText(/28 pending/); action('Generate summary now'); await waitFor(() => expect(screen.getAllByText(/which game is being played/).length).toBeGreaterThan(0));
    expect(spoken).toHaveLength(3); expect(twitchHttp).not.toHaveBeenCalled();
    expect(screen.getByRole('list', { name: 'Sample chat messages' }).closest('[aria-live]')).toBeNull();
    view.unmount(); render(<App />); await screen.findByText('Backend online'); expect(screen.getByText('Speech disabled')).toBeTruthy(); expect(spoken).toHaveLength(3);
  }, 15000);

  it('joins mocked OAuth/EventSub to real processing/UI/speech while preserving the Twitch session across demo mode', async () => {
    await start(true); await login(); const session = [...runtime.store.sessions.values()][0]!;
    const account = session.account; const chat = session.chat; session.realSummary!.pause();
    render(<App />); await screen.findByText('Listening for chat', { exact: true }); action('Enable Speech'); finishAudio();
    const batch = demoBatch(0);
    for (const [i, message] of batch.entries()) {
      const frame = notification(`event-${i}`, `chat-${i}`, message.text); frame.payload.event.chatter_user_name = message.user; sockets[0]!.receive(frame);
    }
    sockets[0]!.receive(notification('event-0', 'chat-0', batch[0]!.text));
    await waitFor(() => expect(screen.getByText(/28 real messages received/)).toBeTruthy(), { timeout: 5000 });
    expect(spoken).toHaveLength(1); expect(session.realSummary!.snapshot().pendingMessages).toBe(28);
    const twitchCalls = twitchHttp.mock.calls.length;
    action('Load Demo Batch'); await screen.findByText('Demo mode'); await screen.findByText('Speech disabled');
    expect(session.account).toBe(account); expect(session.chat).toBe(chat); expect(sockets[0]!.closed).toBe(false); expect(twitchHttp).toHaveBeenCalledTimes(twitchCalls);
    action('Generate summary now'); await waitFor(() => expect(screen.getAllByText(/which game is being played/).length).toBeGreaterThan(0));
    expect(session.realSummary!.snapshot().pendingMessages).toBe(28); expect(spoken).toHaveLength(1);
    action('Return to Twitch chat'); await screen.findByText('Twitch chat mode'); await screen.findByText('Speech disabled'); action('Enable Speech'); finishAudio(); action('Generate summary now');
    await waitFor(() => expect(spoken).toHaveLength(3));
    expect(spoken.at(-1)!.text).toBe(session.realSummary!.snapshot().latest!.text); expect(session.realSummary!.snapshot().latest!.source).toBe('twitch');
    expect(session.demoSummary!.snapshot().latest!.source).toBe('demo');
    const payload = JSON.stringify(await (await api('/api/twitch/status')).json());
    for (const secret of [tokens.access_token, tokens.refresh_token, configuration.twitch!.clientSecret]) expect(payload).not.toContain(secret);
    action('Disconnect Twitch'); expect(speech.cancel).toHaveBeenCalled(); await screen.findByText('Not connected', { exact: true });
    expect(sockets[0]!.closed).toBe(true); expect(account!.user).toBeUndefined(); expect(session.realSummary!.snapshot().nextBatchAt).toBeNull(); expect(session.realSummary!.snapshot().history).toHaveLength(0);
  }, 15000);

  it('disconnects during a real in-flight batch without stale UI, audio or history returning', async () => {
    await start(true); await login(); const session = [...runtime.store.sessions.values()][0]!;
    session.realSummary!.dispose(); let release!: () => void;
    session.realSummary = new SummaryBatcher('twitch', defaultSettings, (batch, activity, previous) => new Promise(resolve => { release = () => resolve(analyzeBatch(batch, activity, previous)); }));
    session.realSummary.pause(); sockets[0]!.receive(notification('pending-event', 'pending-chat', 'What game is this?'));
    await vi.waitFor(() => expect(session.realSummary!.snapshot().pendingMessages).toBe(1));
    render(<App />); await screen.findByText('Listening for chat', { exact: true }); action('Enable Speech'); action('Generate summary now');
    await waitFor(() => expect(session.realSummary!.snapshot().processing).toBe(true));
    expect(screen.getByRole('button', { name: 'Disconnect Twitch' }).hasAttribute('disabled')).toBe(false);
    action('Disconnect Twitch'); await screen.findByText('Not connected', { exact: true }); await act(async () => { release(); await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(screen.getByText('Demo mode')).toBeTruthy(); expect(spoken).toHaveLength(1); expect(session.realSummary.snapshot().history).toHaveLength(0); expect(sockets[0]!.closed).toBe(true);
  }, 15000);
});
