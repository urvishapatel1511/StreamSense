import { useCallback, useEffect, useRef, useState } from 'react';
import { initialSummary, validSummary, type SummaryAction, type SummarySnapshot } from './summaryTypes';

export const connectionLabels = {
  not_connected: 'Not connected', connecting: 'Connecting to Twitch', authenticated: 'Twitch account authenticated',
  eventsub_connecting: 'Connecting to EventSub', listening: 'Listening for chat', reconnecting: 'Reconnecting', error: 'Connection error',
} as const;
export type TwitchStatus = {
  configured: boolean; missingConfiguration: string[]; state: keyof typeof connectionLabels;
  user: { id: string; login: string } | null; error: string | null; demoMode: boolean;
  subscriptionConfirmed: boolean; realChatReceived: boolean; totalMessages: number;
  messages: { id: string; user: string; text: string; timestamp: string; source: 'twitch' | 'demo' }[];
  summary: SummarySnapshot;
};
export const initialStatus: TwitchStatus = { configured: false, missingConfiguration: [], state: 'not_connected', user: null, error: null, demoMode: true, subscriptionConfirmed: false, realChatReceived: false, totalMessages: 0, messages: [], summary: initialSummary };

function validStatus(value: unknown): value is TwitchStatus {
  if (typeof value !== 'object' || !value) return false;
  const data = value as Partial<TwitchStatus>;
  return typeof data.configured === 'boolean' && typeof data.demoMode === 'boolean' && typeof data.state === 'string' && Object.hasOwn(connectionLabels, data.state) && Array.isArray(data.missingConfiguration) && data.missingConfiguration.every(value => typeof value === 'string') && typeof data.subscriptionConfirmed === 'boolean' && typeof data.realChatReceived === 'boolean' && typeof data.totalMessages === 'number' && Number.isSafeInteger(data.totalMessages) && data.totalMessages >= 0 && (data.user === null || (typeof data.user?.id === 'string' && typeof data.user?.login === 'string')) && (data.error === null || typeof data.error === 'string') && Array.isArray(data.messages) && data.messages.length <= 100 && data.messages.every(message => typeof message?.id === 'string' && typeof message.user === 'string' && typeof message.text === 'string' && typeof message.timestamp === 'string' && Number.isFinite(Date.parse(message.timestamp)) && message.source === (data.demoMode ? 'demo' : 'twitch')) && validSummary(data.summary);
}

const oauthErrors: Record<string, string> = {
  configuration: 'Add your Twitch configuration to the root .env and restart the backend.',
  invalid_state: 'The login expired or its security check failed. Use Connect Twitch to try again on localhost.',
  cancelled: 'Twitch authorization was cancelled or denied. You can try again.',
  missing_code: 'Twitch did not return an authorization code. Please try again.',
  session_expired: 'The local login session expired. Please connect again.',
  login_failed: 'Twitch login failed. Check your local app configuration and try again.',
};

export function useTwitch() {
  const [status, setStatus] = useState<TwitchStatus>(initialStatus);
  const [available, setAvailable] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(() => oauthErrors[new URLSearchParams(window.location.search).get('oauth_error') ?? ''] ?? '');
  const [revision, setRevision] = useState(0);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryNotice, setSummaryNotice] = useState('');
  const control = useRef<AbortController | null>(null);
  const disconnecting = useRef(false);
  const version = useRef(0);
  const previousJson = useRef('');
  const applyStatus = useCallback((data: TwitchStatus) => {
    const json = JSON.stringify(data);
    if (json !== previousJson.current) { previousJson.current = json; setStatus(data); }
  }, []);
  useEffect(() => () => { control.current?.abort(); version.current++; }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('oauth_error')) window.history.replaceState(null, '', window.location.pathname);
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      const requestVersion = version.current;
      try {
        const response = await fetch('/api/twitch/status', { credentials: 'same-origin', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]) });
        if (!response.ok) throw new Error();
        const data: unknown = await response.json();
        if (!validStatus(data)) throw new Error();
        if (active && requestVersion === version.current && !control.current) { applyStatus(data); setAvailable(true); }
      } catch {
        if (active && requestVersion === version.current && !control.current) { previousJson.current = ''; setAvailable(false); setStatus(previous => ({ ...previous, state: 'error', subscriptionConfirmed: false, error: 'Backend unavailable. Check the server and wait for it to reconnect.' })); }
      } finally { if (active) { setChecked(true); timer = setTimeout(() => void poll(), 1000); } }
    }
    void poll();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [revision, applyStatus]);

  const controlSummary = useCallback(async (action: SummaryAction, seconds?: number) => {
    if (control.current) return;
    const controller = new AbortController(); control.current = controller; version.current++;
    setSummaryBusy(true); setSummaryNotice('');
    try {
      const response = await fetch('/api/summaries/control', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-StreamSense-Request': '1' }, body: JSON.stringify({ action, ...(seconds === undefined ? {} : { seconds }) }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]) });
      if (!response.ok) throw new Error();
      const data: unknown = await response.json();
      if (!validStatus(data)) throw new Error();
      if (!controller.signal.aborted) { applyStatus(data); setAvailable(true); }
    } catch { if (!controller.signal.aborted) setSummaryNotice('The summary action failed. Check the backend and use http://localhost:5173, then try again.'); }
    finally {
      if (control.current === controller) { version.current++; control.current = null; if (!controller.signal.aborted) setSummaryBusy(false); }
    }
  }, [applyStatus]);

  const connect = () => {
    setNotice(''); setStatus(previous => ({ ...previous, state: 'connecting' }));
    window.location.assign('/auth/twitch');
  };
  const disconnect = useCallback(async () => {
    if (disconnecting.current) return;
    disconnecting.current = true;
    // Disconnect wins over a pending summary request and invalidates older polls.
    control.current?.abort();
    const controller = new AbortController(); control.current = controller; version.current++;
    setBusy(true); setNotice(''); setSummaryBusy(false); setSummaryNotice('');
    try {
      const response = await fetch('/api/twitch/disconnect', { method: 'POST', credentials: 'same-origin', headers: { 'X-StreamSense-Request': '1' }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]) });
      if (!response.ok) throw new Error();
      if (!controller.signal.aborted) { previousJson.current = ''; setStatus(initialStatus); setRevision(previous => previous + 1); }
    } catch { if (!controller.signal.aborted) setNotice('Disconnect failed. Check the backend and try again.'); }
    finally {
      if (control.current === controller) { version.current++; control.current = null; disconnecting.current = false; if (!controller.signal.aborted) setBusy(false); }
    }
  }, []);
  return { status, available, checked, busy, notice, connect, disconnect, summaryBusy, summaryNotice, controlSummary };
}
