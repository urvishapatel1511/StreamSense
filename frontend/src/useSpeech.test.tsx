// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSpeech } from './useSpeech';
import SpeechPanel from './SpeechPanel';
import { preferenceKey } from './speechService';
import { initialSummary, type SummaryEntry } from './summaryTypes';

const voice = { voiceURI: 'device', name: 'Device voice', lang: 'en-GB', localService: true, default: true };
const driver = { getVoices: vi.fn(() => [voice]), speak: vi.fn(), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() };
const summary: SummaryEntry = { id: 'one', source: 'demo', text: 'Two messages ask about the game.', generatedAt: '2026-11-02T00:00:00Z', metrics: { messages: 2, questions: 2, repeatedMessages: 1, repeatedGroups: 1 }, activity: initialSummary.activity, groups: [] };
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  vi.stubGlobal('speechSynthesis', driver);
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function Harness() { const speech = useSpeech(summary, 'demo:anonymous'); return <SpeechPanel speech={speech} />; }

describe('speech lifecycle and accessible controls (mock audio)', () => {
  it('makes shortcuts opt-in and removes them on opt-out and unmount', () => {
    const { unmount } = render(<Harness />);
    fireEvent.keyDown(window, { key: 's', altKey: true }); expect(driver.speak).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Enable optional keyboard shortcuts'));
    fireEvent.keyDown(window, { key: 's', altKey: true }); expect(driver.speak).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: 'm', altKey: true }); expect(screen.getByText('Speech stopped')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Enable optional keyboard shortcuts'));
    fireEvent.keyDown(window, { key: 's', altKey: true }); expect(driver.speak).toHaveBeenCalledOnce();
    unmount(); fireEvent.keyDown(window, { key: 's', altKey: true }); expect(driver.speak).toHaveBeenCalledOnce();
  });
  it('exposes native labelled voice and range settings and restores only preferences', () => {
    const first = render(<Harness />);
    expect(screen.getByRole('combobox', { name: 'On-device voice' })).toBeTruthy();
    fireEvent.change(screen.getByRole('slider', { name: /Speech rate/ }), { target: { value: '1.4' } });
    fireEvent.change(screen.getByRole('slider', { name: /Speech pitch/ }), { target: { value: '0.8' } });
    fireEvent.change(screen.getByRole('slider', { name: /Speech volume/ }), { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable Speech' }));
    expect(driver.speak.mock.calls[0]![0]).toMatchObject({ rate: 1.4, pitch: 0.8, volume: 0.5, voice });
    expect(JSON.parse(localStorage.getItem(preferenceKey)!)).toEqual({ voiceURI: 'device', rate: 1.4, pitch: 0.8, volume: 0.5 });
    first.unmount(); render(<Harness />);
    expect(screen.getByText('Speech disabled')).toBeTruthy(); expect(driver.speak).toHaveBeenCalledOnce();
    expect((screen.getByRole('slider', { name: /Speech rate/ }) as HTMLInputElement).value).toBe('1.4');
  });
  it('recovers from malformed stored settings without autoplay', () => {
    localStorage.setItem(preferenceKey, '{invalid'); const { result } = renderHook(() => useSpeech(summary, 'demo:anonymous'));
    expect(result.current.preferences.rate).toBe(1); expect(result.current.enabled).toBe(false); expect(driver.speak).not.toHaveBeenCalled();
  });
  it('keeps raw chat and queue changes out of live speech and silences status regions while enabled', () => {
    render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Enable Speech' }));
    expect(document.querySelector('.speech-status')!.getAttribute('aria-live')).toBe('off');
    fireEvent.click(screen.getByRole('button', { name: 'Disable Speech' }));
    expect(document.querySelector('.speech-status')!.getAttribute('aria-live')).toBe('polite');
  });
  it.each(['pagehide', 'beforeunload'])('cancels speech and waiting summaries on %s', event => {
    const { result, rerender } = renderHook(({ value }) => useSpeech(value, 'demo:anonymous'), { initialProps: { value: null as SummaryEntry | null } });
    act(() => result.current.enable()); rerender({ value: summary });
    act(() => window.dispatchEvent(new Event(event)));
    expect(driver.cancel).toHaveBeenCalled(); expect(result.current.enabled).toBe(false); expect(result.current.pending).toBe(false);
  });
  it('cleans up active speech and listeners on unmount, ignoring late callbacks', () => {
    const { result, unmount } = renderHook(() => useSpeech(summary, 'demo:anonymous'));
    act(() => result.current.enable()); const utterance = driver.speak.mock.calls[0]![0] as SpeechSynthesisUtterance;
    unmount(); expect(driver.cancel).toHaveBeenCalled(); expect(driver.removeEventListener).toHaveBeenCalled(); expect(utterance.onend).toBeNull(); expect(utterance.onerror).toBeNull();
  });
  it('cancels speech on source change while leaving backend summary controls untouched', () => {
    const { result, rerender } = renderHook(({ scope, value }) => useSpeech(value, scope), { initialProps: { scope: 'demo:anonymous', value: summary } });
    act(() => result.current.enable()); rerender({ scope: 'twitch:42', value: { ...summary, source: 'twitch' } });
    expect(result.current.enabled).toBe(false); expect(driver.cancel).toHaveBeenCalled(); expect(driver.speak).toHaveBeenCalledOnce();
  });
});
