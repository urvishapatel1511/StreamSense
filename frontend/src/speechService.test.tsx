// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { defaultPreferences, safePreferences, SpeechService } from './speechService';
import { initialSummary, type SummaryEntry } from './summaryTypes';
import { handleSpeechShortcut } from './useSpeech';

const localVoice = { voiceURI: 'device-fr', name: 'Device French', lang: 'fr-FR', default: true, localService: true } as SpeechSynthesisVoice;
const otherVoice = { ...localVoice, voiceURI: 'device-hi', name: 'Device Hindi', lang: 'hi-IN', default: false };
const remoteVoice = { ...localVoice, voiceURI: 'remote', localService: false };
function entry(id = '1', text = `Summary ${id}`, source: 'demo' | 'twitch' = 'demo'): SummaryEntry {
  return { id, text, source, generatedAt: '2026-11-02T00:00:00Z', activity: initialSummary.activity, metrics: { messages: 2, questions: 1, repeatedMessages: 1, repeatedGroups: 1 }, groups: [] };
}
function setup(initialVoices = [localVoice, otherVoice, remoteVoice]) {
  const events = new EventTarget();
  let voices = initialVoices;
  const spoken: SpeechSynthesisUtterance[] = [];
  const driver = { getVoices: vi.fn(() => voices), speak: vi.fn((utterance: SpeechSynthesisUtterance) => spoken.push(utterance)), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(), addEventListener: vi.fn(events.addEventListener.bind(events)), removeEventListener: vi.fn(events.removeEventListener.bind(events)) };
  const save = vi.fn();
  const service = new SpeechService(driver as unknown as SpeechSynthesis, text => ({ text } as SpeechSynthesisUtterance), defaultPreferences, save);
  service.start(); service.observe('demo:anonymous', null);
  const end = () => spoken.at(-1)!.onend?.({} as SpeechSynthesisEvent);
  return { service, driver, spoken, end, save, voicesChanged: (next: SpeechSynthesisVoice[]) => { voices = next; events.dispatchEvent(new Event('voiceschanged')); } };
}
describe('generated summary speech service (mock browser audio)', () => {
  it('starts silent, skips pre-enable history, and requires an explicit announcement', () => {
    const { service, driver, spoken, end } = setup();
    service.observe('demo:anonymous', entry()); expect(driver.speak).not.toHaveBeenCalled();
    service.enable(); service.enable(); expect(spoken).toHaveLength(1); expect(spoken[0]!.text).toMatch(/^Speech enabled/);
    end(); service.observe('demo:anonymous', entry()); expect(spoken).toHaveLength(1);
    expect(service.getSnapshot().state).toBe('ready');
  });
  it.each(['demo', 'twitch'] as const)('speaks only new completed %s summaries without a demo prefix', source => {
    const { service, spoken, end } = setup();
    service.observe(`${source}:42`, null); service.enable(); end();
    service.observe(`${source}:42`, entry('new', '4 messages ask about the game.', source));
    expect(spoken.at(-1)!.text).toBe('4 messages ask about the game.');
  });
  it('rejects empty, whitespace-only, zero-message and wrong-source summaries', () => {
    const { service, spoken, end } = setup(); service.enable(); end();
    service.observe('demo:anonymous', entry('a', '')); service.observe('demo:anonymous', entry('b', '   '));
    service.observe('demo:anonymous', { ...entry('c'), metrics: { ...entry().metrics, messages: 0 } });
    service.observe('demo:anonymous', entry('d', 'Wrong source', 'twitch'));
    expect(spoken).toHaveLength(1); expect(service.getSnapshot().hasSummary).toBe(false);
  });
  it('deduplicates IDs and consecutive equivalent text across polls', () => {
    const { service, spoken, end } = setup(); service.enable(); end();
    service.observe('demo:anonymous', entry()); end();
    service.observe('demo:anonymous', entry()); service.observe('demo:anonymous', entry('2', ' SUMMARY  1 '));
    expect(spoken).toHaveLength(2);
  });
  it('keeps the current utterance and only the newest waiting summary', () => {
    const { service, driver, spoken, end } = setup(); service.enable(); end();
    service.observe('demo:anonymous', entry('active'));
    for (let i = 0; i < 200; i++) service.observe('demo:anonymous', entry(String(i)));
    expect(spoken).toHaveLength(2); expect(driver.cancel).not.toHaveBeenCalled(); expect(service.getSnapshot().pending).toBe(true);
    end(); expect(spoken).toHaveLength(3); expect(spoken[2]!.text).toBe('Summary 199');
    end(); expect(service.getSnapshot().pending).toBe(false); expect(service.getSnapshot().state).toBe('ready');
  });
  it('pauses/resumes current speech and retains only the newest waiting item', () => {
    const { service, driver, spoken, end } = setup(); service.enable(); end();
    service.observe('demo:anonymous', entry('current')); service.pause(); service.pause();
    service.observe('demo:anonymous', entry('old')); service.observe('demo:anonymous', entry('new'));
    expect(driver.pause).toHaveBeenCalledOnce(); expect(service.getSnapshot().state).toBe('paused');
    service.resume(); expect(service.getSnapshot().state).toBe('speaking'); end(); expect(spoken.at(-1)!.text).toBe('Summary new');
  });
  it('does not queue the currently spoken text again when chat returns to that topic', () => {
    const { service, spoken, end } = setup(); service.enable(); end();
    service.observe('demo:anonymous', entry('active', 'Game questions.'));
    service.observe('demo:anonymous', entry('waiting', 'Keyboard questions.'));
    service.observe('demo:anonymous', entry('latest', ' GAME  questions. '));
    end(); expect(spoken).toHaveLength(2); expect(service.getSnapshot().pending).toBe(false);
  });
  it('accepts a newly generated summary with a reused ID after a server restart', () => {
    const { service, spoken, end } = setup(); service.enable(); end();
    service.observe('demo:anonymous', entry()); end();
    service.observe('demo:anonymous', { ...entry('1', 'New session summary.'), generatedAt: '2026-11-02T01:00:00Z' });
    expect(spoken.at(-1)!.text).toBe('New session summary.');
  });
  it('can pause between summaries and resume the latest waiting summary', () => {
    const { service, spoken, end } = setup(); service.enable(); end(); service.pause();
    service.observe('demo:anonymous', entry()); expect(spoken).toHaveLength(1);
    service.resume(); expect(spoken.at(-1)!.text).toBe('Summary 1');
  });
  it('does not drain the queue if the browser ends an utterance while paused', () => {
    const { service, spoken, end } = setup(); service.enable(); service.pause(); service.observe('demo:anonymous', entry());
    end(); expect(spoken).toHaveLength(1); service.resume(); expect(spoken).toHaveLength(2);
  });
  it.each(['disable', 'stop'] as const)('%s cancels and suppresses all automatic speech until reenabled', action => {
    const { service, driver, spoken, end } = setup(); service.enable(); service.pause(); service.observe('demo:anonymous', entry('pending'));
    const staleEnd = spoken[0]!.onend!; service[action](); staleEnd.call(spoken[0]!, {} as SpeechSynthesisEvent);
    expect(driver.cancel).toHaveBeenCalledOnce(); expect(service.getSnapshot().enabled).toBe(false); expect(service.getSnapshot().pending).toBe(false);
    service.observe('demo:anonymous', entry('silent')); service.resume(); service.repeat(); expect(spoken).toHaveLength(1);
    service.enable(); end(); service.observe('demo:anonymous', entry('fresh')); expect(spoken.at(-1)!.text).toBe('Summary fresh');
    expect(driver.resume).toHaveBeenCalledTimes(2);
  });
  it('repeats the latest completed summary deliberately and clears an outdated wait', () => {
    const { service, driver, spoken } = setup(); service.observe('demo:anonymous', entry('history')); service.enable();
    service.observe('demo:anonymous', entry('latest')); service.pause(); service.repeat();
    expect(driver.cancel).toHaveBeenCalledOnce(); expect(spoken.at(-1)!.text).toBe('Summary latest'); expect(service.getSnapshot().pending).toBe(false); expect(service.getSnapshot().state).toBe('speaking');
  });
  it('clears repeat eligibility and pending speech when summary history is cleared', () => {
    const { service, spoken } = setup(); service.enable(); service.observe('demo:anonymous', entry()); service.observe('demo:anonymous', null); service.repeat();
    expect(spoken).toHaveLength(1); expect(service.getSnapshot().hasSummary).toBe(false); expect(service.getSnapshot().pending).toBe(false);
  });
  it('excludes remote voices and uses the selected local language and settings', () => {
    const { service, spoken, save } = setup();
    expect(service.getSnapshot().voices).toHaveLength(2);
    service.setPreferences({ voiceURI: otherVoice.voiceURI, rate: 1.5, pitch: 0.8, volume: 0.4 }); service.enable();
    expect(spoken[0]).toMatchObject({ voice: otherVoice, lang: 'hi-IN', rate: 1.5, pitch: 0.8, volume: 0.4 });
    expect(save).toHaveBeenLastCalledWith({ voiceURI: 'device-hi', rate: 1.5, pitch: 0.8, volume: 0.4 });
  });
  it('applies preferences to the next utterance without interrupting the current one', () => {
    const { service, spoken, driver, end } = setup(); service.enable(); service.setPreferences({ rate: 2 });
    expect(spoken[0]!.rate).toBe(1); expect(driver.cancel).not.toHaveBeenCalled(); end(); service.observe('demo:anonymous', entry()); expect(spoken[1]!.rate).toBe(2);
  });
  it('falls back safely for invalid or removed voice selections', () => {
    const { service, voicesChanged } = setup(); service.setPreferences({ voiceURI: 'missing' }); expect(service.getSnapshot().preferences.voiceURI).toBe(localVoice.voiceURI);
    service.setPreferences({ voiceURI: otherVoice.voiceURI }); voicesChanged([localVoice]); expect(service.getSnapshot().preferences.voiceURI).toBe(localVoice.voiceURI);
  });
  it('handles asynchronous voice loading without automatically enabling speech', () => {
    const { service, spoken, voicesChanged } = setup([]); service.enable(); expect(spoken).toHaveLength(0); expect(service.getSnapshot().error).toContain('No on-device voices');
    voicesChanged([localVoice]); expect(service.getSnapshot().enabled).toBe(false); service.enable(); expect(spoken).toHaveLength(1);
  });
  it('does not use a remote default voice when no device voices exist', () => {
    const { service, spoken } = setup([remoteVoice]); service.enable(); expect(spoken).toHaveLength(0);
  });
  it('stops safely if all device voices disappear', () => {
    const { service, driver, voicesChanged } = setup(); service.enable(); voicesChanged([]); expect(driver.cancel).toHaveBeenCalledOnce(); expect(service.getSnapshot().enabled).toBe(false);
  });
  it.each(['audio-busy', 'interrupted', 'canceled', 'not-allowed'])('handles %s and allows a deliberate retry', error => {
    const { service, spoken } = setup(); service.enable(); service.observe('demo:anonymous', entry());
    spoken[0]!.onerror!({ error } as SpeechSynthesisErrorEvent);
    expect(service.getSnapshot()).toMatchObject({ enabled: false, state: 'error', pending: false }); expect(service.getSnapshot().error).toContain(error);
    service.enable(); expect(spoken).toHaveLength(2);
  });
  it('catches thrown browser speech failures', () => {
    const { service, driver } = setup(); driver.speak.mockImplementationOnce(() => { throw new Error('unavailable'); }); service.enable(); expect(service.getSnapshot().state).toBe('error');
  });
  it('does not reuse stale cached voices after voice discovery throws', () => {
    const { service, driver, spoken } = setup();
    driver.getVoices.mockImplementation(() => { throw new Error('driver unavailable'); });
    service.enable(); expect(spoken).toHaveLength(0); expect(service.getSnapshot().enabled).toBe(false); expect(service.getSnapshot().voices).toHaveLength(0);
  });
  it('handles unsupported speech without throwing', () => {
    const service = new SpeechService(null, () => { throw new Error('must not create utterance'); });
    service.start(); service.enable(); service.pause(); service.resume(); service.repeat(); service.stop(); service.dispose(); expect(service.getSnapshot().supported).toBe(false);
  });
  it('cancels, resets history and disables speech on a mode/account change', () => {
    const { service, spoken, driver } = setup(); service.enable(); service.observe('demo:anonymous', entry());
    service.observe('twitch:42', entry('real', 'Real summary', 'twitch')); expect(driver.cancel).toHaveBeenCalledOnce(); expect(service.getSnapshot().enabled).toBe(false);
    service.enable(); service.repeat(); expect(spoken.at(-1)!.text).toBe('Real summary');
    service.observe('twitch:43', null); expect(service.getSnapshot().hasSummary).toBe(false);
  });
  it('removes voice listeners, ignores stale callbacks and can restart for Strict Mode', () => {
    const { service, driver, spoken, voicesChanged } = setup(); service.enable(); const staleError = spoken[0]!.onerror!;
    service.dispose(); staleError.call(spoken[0]!, { error: 'canceled' } as SpeechSynthesisErrorEvent);
    expect(driver.removeEventListener).toHaveBeenCalledWith('voiceschanged', service.refreshVoices); expect(service.getSnapshot().state).toBe('disabled');
    voicesChanged([]); expect(service.getSnapshot().voices).toHaveLength(2);
    service.start(); service.enable(); expect(service.getSnapshot().enabled).toBe(false);
  });
  it('sanitizes stored settings and does not persist enabled state or chat', () => {
    expect(safePreferences({ rate: 100, pitch: -10, volume: NaN, enabled: true, text: 'private' })).toEqual({ voiceURI: '', rate: 2, pitch: 0, volume: 1 });
    expect(safePreferences(null)).toEqual(defaultPreferences);
    const { service, save } = setup(); service.enable(); service.observe('demo:anonymous', entry()); expect(save).not.toHaveBeenCalled();
    save.mockImplementation(() => { throw new Error('storage blocked'); }); expect(() => service.setPreferences({ volume: 0 })).not.toThrow();
  });
});

describe('optional speech keyboard shortcuts', () => {
  function key(service: SpeechService, letter: string, extra: KeyboardEventInit = {}, target: HTMLElement = document.body) {
    const event = new KeyboardEvent('keydown', { key: letter, altKey: true, bubbles: true, cancelable: true, ...extra });
    const handle = (event: Event) => handleSpeechShortcut(event as KeyboardEvent, service);
    target.addEventListener('keydown', handle); target.dispatchEvent(event); target.removeEventListener('keydown', handle); return event;
  }
  it('toggles, pauses/resumes, repeats and stops using the documented keys', () => {
    const { service, spoken } = setup(); service.observe('demo:anonymous', entry());
    expect(key(service, 's').defaultPrevented).toBe(true); expect(service.getSnapshot().enabled).toBe(true);
    key(service, 'p'); expect(service.getSnapshot().state).toBe('paused'); key(service, 'p'); expect(service.getSnapshot().state).toBe('speaking');
    key(service, 'r'); expect(spoken.at(-1)!.text).toBe('Summary 1'); key(service, 'm'); expect(service.getSnapshot().state).toBe('stopped');
    key(service, 's'); key(service, 's'); expect(service.getSnapshot().enabled).toBe(false);
  });
  it.each(['input', 'textarea', 'select', 'div'])('does not intercept typing/settings in %s', tag => {
    const { service, spoken } = setup(); const target = document.createElement(tag); if (tag === 'div') target.setAttribute('contenteditable', 'true');
    expect(key(service, 's', {}, target).defaultPrevented).toBe(false); expect(spoken).toHaveLength(0);
  });
  it('ignores repeat, extra modifiers, unknown keys, already-handled keys and AltGraph', () => {
    const { service, spoken } = setup();
    for (const options of [{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: false }]) expect(key(service, 's', options).defaultPrevented).toBe(false);
    expect(key(service, 'x').defaultPrevented).toBe(false);
    const handled = new KeyboardEvent('keydown', { key: 's', altKey: true, cancelable: true }); handled.preventDefault(); handleSpeechShortcut(handled, service);
    const altGraph = new KeyboardEvent('keydown', { key: 's', altKey: true }); vi.spyOn(altGraph, 'getModifierState').mockReturnValue(true); handleSpeechShortcut(altGraph, service);
    expect(spoken).toHaveLength(0);
  });
});
