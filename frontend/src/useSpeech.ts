import { useEffect, useState, useSyncExternalStore } from 'react';
import { defaultPreferences, preferenceKey, safePreferences, SpeechService } from './speechService';
import type { SummaryEntry } from './summaryTypes';

export function handleSpeechShortcut(event: KeyboardEvent, service: SpeechService) {
  const target = event.target;
  if (event.defaultPrevented || event.repeat || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.getModifierState('AltGraph')) return;
  if (target instanceof Element && (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') || (target instanceof HTMLElement && target.isContentEditable))) return;
  const state = service.getSnapshot();
  switch (event.key.toLowerCase()) {
    case 's': state.enabled ? service.disable() : service.enable(); break;
    case 'p': state.state === 'paused' ? service.resume() : service.pause(); break;
    case 'r': service.repeat(); break;
    case 'm': service.stop(); break;
    default: return;
  }
  event.preventDefault();
}

export function useSpeech(summary: SummaryEntry | null, scope: string) {
  const [service] = useState(() => {
    let preferences = defaultPreferences;
    try { preferences = safePreferences(JSON.parse(localStorage.getItem(preferenceKey) ?? 'null')); } catch { /* Defaults when storage is blocked or malformed. */ }
    const supported = typeof window !== 'undefined' && Boolean(window.speechSynthesis) && typeof window.SpeechSynthesisUtterance === 'function';
    return new SpeechService(supported ? window.speechSynthesis : null, text => new SpeechSynthesisUtterance(text), preferences, next => localStorage.setItem(preferenceKey, JSON.stringify(next)));
  });
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const [shortcuts, setShortcuts] = useState(false);
  useEffect(() => {
    service.start();
    window.addEventListener('pagehide', service.disable);
    window.addEventListener('beforeunload', service.disable);
    return () => {
      window.removeEventListener('pagehide', service.disable);
      window.removeEventListener('beforeunload', service.disable);
      service.dispose();
    };
  }, [service]);
  useEffect(() => { service.observe(scope, summary); }, [service, scope, summary]);
  useEffect(() => {
    if (!shortcuts) return;
    const handle = (event: KeyboardEvent) => handleSpeechShortcut(event, service);
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [service, shortcuts]);
  return { ...snapshot, enable: service.enable, disable: service.disable, pause: service.pause, resume: service.resume, repeat: service.repeat, stop: service.stop, setPreferences: service.setPreferences, shortcuts, setShortcuts };
}
export type SpeechControls = ReturnType<typeof useSpeech>;
