import type { SpeechControls } from './useSpeech';

export default function SpeechPanel({ speech }: { speech: SpeechControls }) {
  const { supported, enabled, state, voices, preferences } = speech;
  return <section className="panel speech-panel" aria-labelledby="speech-heading">
    <div className="panel-heading"><div><p className="eyebrow">LISTEN ON YOUR TERMS</p><h2 id="speech-heading">Spoken summaries</h2></div><span className="badge neutral">Speech {state}</span></div>
    <p className="panel-description">Read completed summaries from the displayed mode. Individual chat messages are never read. Switching modes turns speech off.</p>
    <div className="speech-buttons" role="group" aria-label="Summary speech controls">
      <button className="button primary" onClick={speech.enable} disabled={!supported || enabled}>Enable Speech</button>
      <button className="button secondary" onClick={speech.disable} disabled={!enabled}>Disable Speech</button>
      <button className="button secondary" onClick={speech.pause} disabled={!enabled || state === 'paused'}>Pause Speech</button>
      <button className="button secondary" onClick={speech.resume} disabled={!enabled || state !== 'paused'}>Resume Speech</button>
      <button className="button secondary" onClick={speech.repeat} disabled={!enabled || !speech.hasSummary}>Repeat Last Summary</button>
      <button className="button secondary stop-speech" onClick={speech.stop} disabled={!enabled}>Stop Speaking</button>
    </div>
    <p className="speech-status" role="status" aria-live={enabled ? 'off' : 'polite'}>{!supported ? 'Text-to-speech is unavailable in this browser.' : speech.error || `Speech ${state}. ${enabled ? 'New summaries will be spoken.' : 'Enable Speech to hear the test announcement and future summaries.'}`}{speech.pending ? ' The newest waiting summary will play next.' : ''}</p>
    {supported && voices.length === 0 && <p className="small-note">No on-device voices available yet. Voices may load shortly. Check Windows Settings → Time &amp; language → Speech if this persists. Remote voices are excluded to keep summaries on your device.</p>}
    <fieldset className="speech-settings" disabled={!supported}><legend>Speech settings</legend>
      <label htmlFor="speech-voice">On-device voice</label>
      <select id="speech-voice" value={preferences.voiceURI} disabled={!voices.length} onChange={event => speech.setPreferences({ voiceURI: event.target.value })}>
        {voices.length ? voices.map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} ({voice.lang})</option>) : <option value="">Waiting for device voices</option>}
      </select>
      {(['rate', 'pitch', 'volume'] as const).map(setting => <div className="speech-setting" key={setting}>
        <label htmlFor={`speech-${setting}`}>Speech {setting}: <output htmlFor={`speech-${setting}`} aria-live="off">{preferences[setting]}</output></label>
        <input id={`speech-${setting}`} type="range" min={setting === 'rate' ? 0.5 : 0} max={setting === 'volume' ? 1 : 2} step="0.1" value={preferences[setting]} onChange={event => speech.setPreferences({ [setting]: Number(event.target.value) })} />
      </div>)}
      <p className="small-note">Voice, rate, pitch and volume are saved on this browser and apply to the next utterance. Speech always starts off. Stop Speaking clears audio and keeps automatic speech off until Enable Speech.</p>
    </fieldset>
    <div className="shortcut-reference"><h3>Keyboard shortcuts</h3>
      <label className="shortcut-toggle"><input type="checkbox" checked={speech.shortcuts} onChange={event => speech.setShortcuts(event.target.checked)} /> Enable optional keyboard shortcuts</label>
      <p>Alt + S: enable/disable · Alt + P: pause/resume · Alt + R: repeat · Alt + M: stop.</p>
      <p>Shortcuts are off by default and ignored while editing text or settings. Browser, keyboard layout and screen-reader shortcuts may take priority. Leave them off if they conflict; all buttons work with Tab and Enter or Space.</p>
      <p>Speech and your screen reader may overlap. Stop Speaking is always available while speech is enabled. Connection and speech live announcements are quiet while speech is enabled; you can still read every status manually.</p>
    </div>
  </section>;
}
