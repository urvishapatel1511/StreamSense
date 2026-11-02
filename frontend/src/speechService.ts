import type { SummaryEntry } from './summaryTypes';

export type SpeechPreferences = { voiceURI: string; rate: number; pitch: number; volume: number };
export type SpeechSnapshot = {
  supported: boolean; enabled: boolean; state: 'disabled' | 'ready' | 'speaking' | 'paused' | 'stopped' | 'error';
  error: string; voices: SpeechSynthesisVoice[]; preferences: SpeechPreferences; hasSummary: boolean; pending: boolean;
};
export const defaultPreferences: SpeechPreferences = { voiceURI: '', rate: 1, pitch: 1, volume: 1 };
export const preferenceKey = 'streamsense.speech.preferences.v1';
const clamp = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
export function safePreferences(value: unknown): SpeechPreferences {
  const data = value && typeof value === 'object' ? value as Partial<SpeechPreferences> : {};
  return { voiceURI: typeof data.voiceURI === 'string' ? data.voiceURI.slice(0, 500) : '', rate: clamp(data.rate, 1, 0.5, 2), pitch: clamp(data.pitch, 1, 0, 2), volume: clamp(data.volume, 1, 0, 1) };
}

// Own one active utterance and one replaceable waiting summary, never a browser backlog.
export class SpeechService {
  private snapshot: SpeechSnapshot;
  private listeners = new Set<() => void>();
  private active: SpeechSynthesisUtterance | null = null;
  private waiting: SummaryEntry | null = null;
  private latest: SummaryEntry | null = null;
  private seen = new Set<string>();
  private lastText = '';
  private scope: string | undefined;
  private started = false;
  constructor(private driver: SpeechSynthesis | null, private makeUtterance: (text: string) => SpeechSynthesisUtterance, preferences: SpeechPreferences = defaultPreferences, private save?: (preferences: SpeechPreferences) => void) {
    this.snapshot = { supported: Boolean(driver), enabled: false, state: 'disabled', error: '', voices: [], preferences: safePreferences(preferences), hasSummary: false, pending: false };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<SpeechSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(listener => listener()); }
  start = () => {
    if (this.started || !this.driver) return;
    this.started = true;
    this.driver.addEventListener('voiceschanged', this.refreshVoices);
    this.refreshVoices();
  };
  refreshVoices = () => {
    if (!this.driver) return;
    try {
      // Remote browser voices may send text to a server. Explicitly select a device voice.
      const voices = this.driver.getVoices().filter(voice => voice.localService);
      const selected = voices.find(voice => voice.voiceURI === this.snapshot.preferences.voiceURI) ?? voices.find(voice => voice.default) ?? voices[0];
      this.update({ voices, preferences: { ...this.snapshot.preferences, voiceURI: selected?.voiceURI ?? '' } });
      if (!voices.length && this.snapshot.enabled) this.fail('No on-device voices are available. Check Windows speech settings, then enable speech again.');
    } catch { this.update({ voices: [] }); this.fail('Could not load device voices. Try enabling speech again.'); }
  };
  setPreferences = (patch: Partial<SpeechPreferences>) => {
    const preferences = safePreferences({ ...this.snapshot.preferences, ...patch });
    if (!this.snapshot.voices.some(voice => voice.voiceURI === preferences.voiceURI)) preferences.voiceURI = this.snapshot.voices[0]?.voiceURI ?? '';
    this.update({ preferences });
    try { this.save?.(preferences); } catch { /* Storage can be unavailable; speech still works. */ }
  };
  observe = (scope: string, summary: SummaryEntry | null) => {
    if (scope !== this.scope) {
      if (this.scope !== undefined) this.disable();
      this.scope = scope; this.seen.clear(); this.lastText = ''; this.latest = null;
      this.update({ hasSummary: false });
    }
    if (!summary) {
      this.latest = null; this.waiting = null;
      if (this.snapshot.hasSummary || this.snapshot.pending) this.update({ hasSummary: false, pending: false });
      return;
    }
    if (summary.source !== scope.split(':')[0] || !summary.text.trim() || summary.metrics.messages === 0) return;
    this.latest = summary;
    if (!this.snapshot.hasSummary) this.update({ hasSummary: true });
    // Generation time distinguishes IDs reused after a backend/session restart.
    const identity = `${summary.id}:${summary.generatedAt}`;
    if (this.seen.has(identity)) return;
    this.seen.add(identity);
    if (this.seen.size > 100) this.seen.delete(this.seen.values().next().value!);
    const normalized = summary.text.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    if (normalized === this.lastText) return;
    this.lastText = normalized;
    if (!this.snapshot.enabled) return;
    if (this.active?.text.trim().replace(/\s+/g, ' ').toLocaleLowerCase() === normalized) {
      this.waiting = null; this.update({ pending: false }); return;
    }
    if (this.active || this.snapshot.state === 'paused') { this.waiting = summary; this.update({ pending: true }); }
    else this.speak(summary.text);
  };
  enable = () => {
    if (!this.driver || this.snapshot.enabled) return;
    this.refreshVoices();
    if (!this.snapshot.voices.length) { this.update({ error: 'No on-device voices are available. Wait for voices to load or check Windows speech settings.' }); return; }
    this.update({ enabled: true, state: 'ready', error: '' });
    try { this.driver.resume(); this.speak('Speech enabled. New chat summaries will be read aloud.'); }
    catch { this.fail('Speech could not start. Enable Speech to try again.'); }
  };
  private clear() {
    if (this.active) { this.active.onend = null; this.active.onerror = null; }
    this.active = null; this.waiting = null;
    try { this.driver?.cancel(); } catch { /* Cleanup remains safe when the browser driver fails. */ }
  }
  disable = () => { this.clear(); this.update({ enabled: false, state: 'disabled', pending: false, error: '' }); };
  stop = () => { this.clear(); this.update({ enabled: false, state: 'stopped', pending: false, error: '' }); };
  private fail(message: string) { this.clear(); this.update({ enabled: false, state: 'error', pending: false, error: message }); }
  private speak(text: string) {
    if (!this.driver || !this.snapshot.enabled || !text.trim()) return;
    const voice = this.snapshot.voices.find(voice => voice.voiceURI === this.snapshot.preferences.voiceURI);
    if (!voice) { this.fail('The selected device voice is unavailable. Select another voice and enable speech again.'); return; }
    try {
      const utterance = this.makeUtterance(text);
      const { rate, pitch, volume } = this.snapshot.preferences;
      utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = rate; utterance.pitch = pitch; utterance.volume = volume;
      this.active = utterance;
      utterance.onend = () => {
        if (this.active !== utterance) return;
        this.active = null;
        if (this.snapshot.state === 'paused') return;
        const next = this.waiting; this.waiting = null;
        this.update({ state: 'ready', pending: false });
        if (next) this.speak(next.text);
      };
      utterance.onerror = event => {
        if (this.active !== utterance) return;
        this.fail(`Speech could not play (${event.error}). Enable Speech to try again.`);
      };
      this.update({ state: 'speaking', error: '' });
      this.driver.speak(utterance);
    } catch { this.fail('Speech could not play. Check your browser and audio device, then enable speech again.'); }
  }
  pause = () => {
    if (!this.snapshot.enabled || this.snapshot.state === 'paused') return;
    try { this.driver?.pause(); this.update({ state: 'paused' }); }
    catch { this.fail('Speech could not pause. Enable Speech to try again.'); }
  };
  resume = () => {
    if (!this.snapshot.enabled || this.snapshot.state !== 'paused') return;
    try {
      this.driver?.resume(); this.update({ state: this.active ? 'speaking' : 'ready' });
      if (!this.active && this.waiting) { const next = this.waiting; this.waiting = null; this.update({ pending: false }); this.speak(next.text); }
    } catch { this.fail('Speech could not resume. Enable Speech to try again.'); }
  };
  repeat = () => {
    if (!this.snapshot.enabled || !this.latest) return;
    const text = this.latest.text;
    this.clear(); this.update({ pending: false, state: 'ready' });
    // A repeat is a deliberate interruption, including when the previous speech was paused.
    try { this.driver?.resume(); this.speak(text); }
    catch { this.fail('Speech could not repeat. Enable Speech to try again.'); }
  };
  dispose = () => {
    this.driver?.removeEventListener('voiceschanged', this.refreshVoices);
    this.started = false; this.disable();
  };
}
