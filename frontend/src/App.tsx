import { sampleMessages } from './sampleData';
import { useSpeech } from './useSpeech';
import { useTwitch, connectionLabels } from './useTwitch';
import SummaryPanel from './SummaryPanel';
import SpeechPanel from './SpeechPanel';

export default function App() {
  const twitch = useTwitch();
  const { status } = twitch;
  const demo = status.demoMode;
  const speech = useSpeech(status.summary.latest, `${demo ? 'demo' : 'twitch'}:${status.user?.id ?? 'anonymous'}`);
  const messages = demo && status.messages.length === 0 ? sampleMessages.map(message => ({ ...message, id: message.user, source: 'demo' as const })) : status.messages.map(message => ({ ...message, color: 'purple', time: new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }));
  const connecting = ['connecting', 'authenticated', 'eventsub_connecting', 'reconnecting'].includes(status.state);
  const connectionHelp = !status.configured ? `The server's Twitch connection is not configured. Set its Twitch application settings and restart the service. ${status.missingConfiguration.join(', ')}` : status.user ? `Twitch account authenticated: ${status.user.login}. ${status.subscriptionConfirmed ? 'Chat subscription confirmed. Waiting for or receiving real messages.' : 'The account is authenticated; chat is not currently listening.'}` : 'Connect your own broadcaster account to receive real Twitch chat. You will be redirected to Twitch.';

  return (
    <>
      <a className="skip-link" href="#main">Skip to dashboard</a>
      <header className="topbar">
        <a className="brand" href="#main" aria-label="StreamSense dashboard"><span className="brand-mark" aria-hidden="true">≋</span>Stream<span>Sense</span></a>
        <span className="topbar-label">YOUR CHAT, WITH CLARITY</span>
        <span className="badge demo"><span className="dot" />{demo ? 'Demo mode' : 'Twitch chat mode'}</span>
      </header>

      <main id="main" tabIndex={-1}>
        <div className="page-heading"><div><p className="eyebrow">STREAM COMPANION</p><h1>Stay in the moment.</h1><p className="subtitle">Catch what matters in chat. Keep your focus on your stream.</p></div><span className="session-label"><span className="dot" />{demo ? 'Sample session' : `Channel: ${status.user?.login ?? 'Twitch'}`}</span></div>

        <section className="connection panel" aria-labelledby="connection-heading">
          <div className="connection-icon" aria-hidden="true">◈</div>
          <div className="connection-copy"><h2 id="connection-heading">Your Twitch connection <span className="badge disconnected" role="status" aria-live={speech.enabled ? 'off' : 'polite'}>{connectionLabels[status.state]}</span></h2><p id="connection-help">{connectionHelp}</p>{demo && status.user && <p>Viewing DEMO messages. Your Twitch session is preserved; use Return to Twitch chat to switch back.</p>}{(status.error || twitch.notice) && <p className="connection-error" role="alert">{status.error || twitch.notice}</p>}</div>
          {status.user || !demo || status.state === 'error' || connecting ? <button className="button secondary" onClick={() => { speech.disable(); void twitch.disconnect(); }} disabled={twitch.busy}>Disconnect Twitch</button> : null}
          {!status.user && !connecting && <button className="button secondary" onClick={() => { speech.disable(); twitch.connect(); }} disabled={!status.configured || !twitch.available || twitch.busy || twitch.summaryBusy} aria-describedby="connection-help">Connect Twitch <span aria-hidden="true">↗</span></button>}
        </section>

        <div className="dashboard-grid">
          <section className="panel chat-panel" aria-labelledby="chat-heading">
            <div className="panel-heading"><div><p className="eyebrow">THE CONVERSATION</p><h2 id="chat-heading">Live chat</h2></div><span className="badge neutral">{demo ? 'Sample messages' : 'Twitch messages'}</span></div>
            <p className="panel-description">{demo ? status.messages.length ? 'Loaded demo messages. These are sample inputs, separate from Twitch.' : 'Sample preview only. Use Load demo batch to add inputs to the summary queue.' : status.subscriptionConfirmed ? 'Real messages from your channel. Chat is displayed as text and is not read aloud.' : 'Chat is not currently listening. Check the connection status above.'}</p>
            {!demo && messages.length === 0 && <p className="empty-chat">{status.subscriptionConfirmed ? 'Waiting for the first real chat message. Send a message in your Twitch channel.' : 'No real messages received yet.'}</p>}
            <ol className="message-list" tabIndex={0} aria-label={demo ? 'Sample chat messages' : 'Twitch chat messages'}>
              {messages.map((message) => <li key={message.id}><div className={`avatar ${message.color}`} aria-hidden="true">{message.user.slice(0, 1).toUpperCase()}</div><div className="message-body"><div className="message-meta"><span className={`username ${message.color}`}>{message.user}</span><span className="message-source">{message.source === 'demo' ? 'DEMO' : 'TWITCH'}</span><span className="timestamp">{message.time}</span></div><p>{message.text}</p></div></li>)}
            </ol>
            <div className="panel-footer"><span className="dot" />{demo ? status.totalMessages ? `${status.totalMessages} demo messages loaded · Showing latest ${messages.length}` : '6 sample messages · Preview only, not queued' : `${status.totalMessages} real messages received · Showing latest ${messages.length}`}</div>
          </section>

          <div className="right-column">
            <SummaryPanel summary={status.summary} demo={demo} twitchSession={Boolean(status.user)} available={twitch.available} busy={twitch.summaryBusy || twitch.busy} notice={twitch.summaryNotice} onAction={twitch.controlSummary} />

            <SpeechPanel speech={speech} />
          </div>
        </div>

        <aside className="accessibility-note" aria-label="Keyboard help"><span aria-hidden="true">⌨</span><p><strong>Built for your flow.</strong> Use Tab to move between controls and Enter or Space to activate buttons. No automatic audio.</p></aside>
        <footer className="page-footer"><span>StreamSense <span aria-hidden="true">/</span> Local hackathon build</span><span role="status" aria-live={speech.enabled ? 'off' : 'polite'}>{!twitch.checked ? 'Checking backend…' : twitch.available ? 'Backend online' : 'Backend unavailable — check that the server is running'}</span></footer>
      </main>
    </>
  );
}

// During development, structural hook changes need a fresh page rather than stale refresh state.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
