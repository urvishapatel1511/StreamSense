// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { connectionLabels, initialStatus, type TwitchStatus } from './useTwitch';
import type { SummaryEntry } from './summaryTypes';

const speech = { speak: vi.fn(), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(), getVoices: vi.fn(() => [{ voiceURI: 'device-en', name: 'Device English', lang: 'en-US', default: true, localService: true }]), addEventListener: vi.fn(), removeEventListener: vi.fn() };
beforeEach(() => {
  localStorage.clear();
  let status = initialStatus;
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input, init) => {
    if (String(input).endsWith('/summaries/control')) {
      const body = JSON.parse(init.body) as { action: string; seconds?: number };
      if (body.action === 'interval') status = { ...status, summary: { ...status.summary, intervalSeconds: body.seconds! } };
    }
    return { ok: true, json: async () => status };
  }));
  vi.stubGlobal('speechSynthesis', speech);
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  vi.clearAllMocks();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('foundation dashboard', () => {
  it('mounts the updated hook layout cleanly in Strict Mode', async () => {
    render(<StrictMode><App /></StrictMode>);
    await screen.findByText('Backend online');
    expect(screen.getByRole('button', { name: 'Load Demo Batch' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Chat summary' })).toBeTruthy();
  });
  it('labels sample content and keeps Twitch authentication unavailable', async () => {
    render(<App />);
    expect(screen.getByText('Not connected')).toBeTruthy();
    expect(screen.getByText('Demo mode')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Connect Twitch/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    expect(screen.getByText('DETERMINISTIC RULES · GENERATED SUMMARY')).toBeTruthy();
    await screen.findByText('Backend online');
    expect(speech.speak).not.toHaveBeenCalled();
  });
  it('controls speech only after a deliberate Enable action', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Enable/ }));
    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(speech.speak.mock.calls[0]?.[0].text).toContain('Speech enabled.');
    fireEvent.click(screen.getByRole('button', { name: 'Pause Speech' }));
    expect(speech.pause).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Resume Speech' }));
    expect(speech.resume).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Repeat Last Summary' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Stop Speaking' }));
    expect(screen.getByText('Speech stopped')).toBeTruthy();
    expect(speech.cancel).toHaveBeenCalled();
    await screen.findByText('Backend online');
    fireEvent.change(screen.getByLabelText('Summary interval'), { target: { value: '60' } });
    await waitFor(() => expect((screen.getByLabelText('Summary interval') as HTMLSelectElement).value).toBe('60'));
  });
  it('explains backend failures', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    render(<App />);
    await screen.findByText('Backend unavailable — check that the server is running');
  });
  it('reports speech errors and allows another attempt', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Enable/ }));
    const utterance = speech.speak.mock.calls[0]?.[0] as SpeechSynthesisUtterance;
    act(() => utterance.onerror?.({ error: 'audio-busy' } as SpeechSynthesisErrorEvent));
    expect(screen.getByText(/Speech could not play/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Enable Speech' }));
    expect(speech.speak).toHaveBeenCalledTimes(2);
    act(() => (speech.speak.mock.calls[1]?.[0] as SpeechSynthesisUtterance).onend?.({} as SpeechSynthesisEvent));
    expect(screen.getByText('Speech ready')).toBeTruthy();
    await screen.findByText('Backend online');
  });
  it('handles unsupported speech gracefully', async () => {
    Reflect.deleteProperty(window, 'speechSynthesis');
    render(<App />);
    expect(screen.getByText('Text-to-speech is unavailable in this browser.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Enable/ }).hasAttribute('disabled')).toBe(true);
    await waitFor(() => expect(screen.getByText('Backend online')).toBeTruthy());
  });

  it.each(Object.entries(connectionLabels))('displays the %s connection state', async (state, label) => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...initialStatus, configured: true, state }) } as Response);
    render(<App />);
    await screen.findByText(label, { exact: true });
    await screen.findByText('Backend online');
  });

  it('keeps real chat separate from samples and renders untrusted text safely', async () => {
    const live: TwitchStatus = { ...initialStatus, configured: true, state: 'listening', demoMode: false, user: { id: '42', login: 'real_streamer' }, subscriptionConfirmed: true, realChatReceived: true, totalMessages: 1, messages: [{ id: 'real-one', user: 'Viewer', text: '<img src=x onerror=alert(1)>', timestamp: '2026-11-02T00:00:00Z', source: 'twitch' }] };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => live } as Response);
    render(<App />);
    await screen.findByText('Listening for chat', { exact: true });
    expect(screen.getByText('Twitch chat mode')).toBeTruthy(); expect(screen.getByText('Channel: real_streamer')).toBeTruthy();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy(); expect(document.querySelector('img')).toBeNull();
    expect(screen.queryByText('lunar_fox')).toBeNull(); expect(screen.queryByText('HANDWRITTEN SAMPLE')).toBeNull();
    expect(screen.getByText('1 real messages received · Showing latest 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Enable/ }).hasAttribute('disabled')).toBe(false); expect(speech.speak).not.toHaveBeenCalled();
  });

  it('shows waiting for real chat after subscription confirmation with no messages', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...initialStatus, configured: true, state: 'listening', subscriptionConfirmed: true, demoMode: false, user: { id: '42', login: 'streamer' } }) } as Response);
    render(<App />);
    await screen.findByText('Waiting for the first real chat message. Send a message in your Twitch channel.');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('disconnects with same-origin intent and returns to Demo Mode', async () => {
    let disconnected = false;
    vi.mocked(fetch).mockImplementation(async input => {
      if (String(input).endsWith('/disconnect')) { disconnected = true; return { ok: true } as Response; }
      return { ok: true, json: async () => disconnected ? { ...initialStatus, configured: true } : { ...initialStatus, configured: true, state: 'listening', subscriptionConfirmed: true, demoMode: false, user: { id: '42', login: 'streamer' } } } as Response;
    });
    render(<App />);
    await screen.findByText('Twitch chat mode');
    fireEvent.click(screen.getByRole('button', { name: 'Enable Speech' }));
    const cancellations = speech.cancel.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Twitch' }));
    expect(speech.cancel.mock.calls.length).toBeGreaterThan(cancellations);
    expect(screen.getByText('Speech disabled')).toBeTruthy();
    await screen.findByText('Demo mode');
    expect(fetch).toHaveBeenCalledWith('/api/twitch/disconnect', expect.objectContaining({ method: 'POST', credentials: 'same-origin', headers: { 'X-StreamSense-Request': '1' } }));
    await screen.findByText('lunar_fox');
  });

  it('keeps the authenticated state on disconnect failure and shows a retry message', async () => {
    vi.mocked(fetch).mockImplementation(async input => {
      if (String(input).endsWith('/disconnect')) return { ok: false } as Response;
      return { ok: true, json: async () => ({ ...initialStatus, configured: true, state: 'listening', subscriptionConfirmed: true, demoMode: false, user: { id: '42', login: 'streamer' } }) } as Response;
    });
    render(<App />); await screen.findByText('Twitch chat mode');
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Twitch' }));
    await screen.findByText('Disconnect failed. Check the backend and try again.'); expect(screen.queryByText('Demo mode')).toBeNull();
  });
  it.each([false, true])('loads a demo queue and speaks only a generated summary when speech enabled=%s', async enabled => {
    let status = initialStatus;
    const entry: SummaryEntry = { id: 'generated-one', text: '4 messages ask which game is being played.', generatedAt: '2026-11-02T00:00:20Z', source: 'demo', metrics: { messages: 28, questions: 12, repeatedMessages: 12, repeatedGroups: 6 }, activity: { ...initialStatus.summary.activity, level: 'Busy', count: 28 }, groups: [] };
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith('/summaries/control')) {
        const body = JSON.parse(String(init!.body)) as { action: string };
        if (body.action === 'demo_batch') status = { ...status, summary: { ...status.summary, pendingMessages: 28 } };
        if (body.action === 'generate') status = { ...status, summary: { ...status.summary, pendingMessages: 0, latest: entry, history: [entry] } };
      }
      return { ok: true, json: async () => status } as Response;
    });
    render(<App />); await screen.findByText('Backend online');
    if (enabled) {
      fireEvent.click(screen.getByRole('button', { name: 'Enable Speech' }));
      act(() => (speech.speak.mock.calls[0]?.[0] as SpeechSynthesisUtterance).onend?.({} as SpeechSynthesisEvent));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Load Demo Batch' })); await screen.findByText(/28 pending/);
    expect(speech.speak).toHaveBeenCalledTimes(enabled ? 1 : 0);
    fireEvent.click(screen.getByRole('button', { name: 'Generate summary now' }));
    await waitFor(() => expect(screen.getAllByText(entry.text)).toHaveLength(2));
    expect(fetch).toHaveBeenCalledWith('/api/summaries/control', expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'generate' }) }));
    expect(speech.speak).toHaveBeenCalledTimes(enabled ? 2 : 0);
    if (enabled) {
      expect(speech.speak.mock.calls[1]?.[0].text).toBe(entry.text);
      fireEvent.click(screen.getByRole('button', { name: 'Repeat Last Summary' }));
      expect(speech.speak.mock.calls[2]?.[0].text).toBe(entry.text);
    }
  });
  it('reports summary-control errors without inventing a generated summary', async () => {
    vi.mocked(fetch).mockImplementation(async input => String(input).endsWith('/summaries/control') ? { ok: false } as Response : { ok: true, json: async () => initialStatus } as Response);
    render(<App />); await screen.findByText('Backend online');
    fireEvent.click(screen.getByRole('button', { name: 'Load Demo Batch' }));
    await screen.findByText(/The summary action failed/); expect(screen.getByText(/No generated summaries yet/)).toBeTruthy();
  });
  it('labels every loaded message DEMO and returns to real chat without a disconnect call', async () => {
    const real: TwitchStatus = { ...initialStatus, configured: true, state: 'listening', user: { id: '42', login: 'real_streamer' }, demoMode: false, subscriptionConfirmed: true, totalMessages: 1, realChatReceived: true, summary: { ...initialStatus.summary, source: 'twitch' }, messages: [{ id: 'real-before', user: 'actual_viewer', text: 'Actual Twitch input', source: 'twitch', timestamp: '2026-11-02T00:00:00Z' }] };
    let current = real;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith('/summaries/control')) {
        const body = JSON.parse(String(init!.body)) as { action: string };
        if (body.action === 'demo_batch') current = { ...real, demoMode: true, totalMessages: 28, summary: { ...initialStatus.summary, pendingMessages: 28 }, messages: Array.from({ length: 28 }, (_, index) => ({ id: `demo-${index}`, user: `fictional_viewer_${index}`, text: 'Demo input', timestamp: '2026-11-02T00:00:00Z', source: 'demo' as const })) };
        if (body.action === 'show_twitch') current = real;
      }
      return { ok: true, json: async () => current } as Response;
    });
    render(<App />); await screen.findByText('Actual Twitch input');
    fireEvent.click(screen.getByRole('button', { name: 'Load Demo Batch' })); await screen.findByText('Demo mode');
    expect(screen.getAllByText('DEMO', { exact: true })).toHaveLength(28); expect(screen.queryByText('Actual Twitch input')).toBeNull();
    expect(screen.getByText(/Your Twitch session is preserved/)).toBeTruthy(); expect(screen.getByText('Listening for chat', { exact: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Return to Twitch chat' })); await screen.findByText('Actual Twitch input');
    expect(screen.queryByText('DEMO', { exact: true })).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith('/twitch/disconnect'))).toBe(false);
  });
});
