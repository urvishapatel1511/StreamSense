import type { SummaryAction, SummarySnapshot } from './summaryTypes';

type Props = { summary: SummarySnapshot; demo: boolean; twitchSession?: boolean; available: boolean; busy: boolean; notice: string; onAction: (action: SummaryAction, seconds?: number) => Promise<void> };
const time = (date: string) => new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export default function SummaryPanel({ summary, demo, twitchSession = false, available, busy, notice, onAction }: Props) {
  const latest = summary.latest;
  const disabled = !available || busy;
  const intervals = [...new Set([5, 10, 15, 20, 30, 60, 120, 300, summary.intervalSeconds])].sort((a, b) => a - b);
  return <section className="panel summary-panel" aria-labelledby="summary-heading">
    <div className="panel-heading"><div><p className="eyebrow">LESS NOISE. MORE MEANING.</p><h2 id="summary-heading">Chat summary</h2></div><span className="badge neutral">{demo ? 'Demo Mode summaries' : 'Real Twitch summaries'}</span></div>
    <div className="summary-card"><span className="summary-label">DETERMINISTIC RULES · GENERATED SUMMARY</span><p>{latest?.text ?? (demo ? 'Load a demo batch, then wait for the interval or choose Generate summary now.' : 'Waiting for real Twitch messages to summarise.')}</p>
      {latest && <p className="summary-time">Generated <time dateTime={latest.generatedAt}>{time(latest.generatedAt)}</time> · {latest.source === 'demo' ? 'Demo Mode' : 'Real Twitch'}</p>}
    </div>
    <dl className="summary-metrics">
      <div><dt>Messages processed</dt><dd>{latest?.metrics.messages ?? 0}</dd></div>
      <div><dt>Questions detected</dt><dd>{latest?.metrics.questions ?? 0}</dd></div>
      <div><dt>Repeat messages</dt><dd>{latest?.metrics.repeatedMessages ?? 0}</dd></div>
      <div><dt>Current activity</dt><dd>{summary.activity.level}</dd></div>
    </dl>
    <p className="small-note">Repeat messages counts extra occurrences beyond the first. Activity: {summary.activity.count} messages in the last {summary.activity.windowSeconds} seconds.{summary.activity.burst ? ' Volume is at least twice the previous window.' : ''}</p>
    {latest && latest.groups.length > 0 && <details className="summary-details" open><summary>Why this summary? Questions and repeated messages</summary>
      <h3>Detected questions</h3><ul>{latest.groups.filter(group => group.question).map(group => <li key={group.key}><span>{group.text}</span><span> {group.count} messages · {group.senderCount} senders</span></li>)}</ul>
      <h3>Repeated messages</h3><ul>{latest.groups.filter(group => group.count > 1).map(group => <li key={group.key}><span>{group.text}</span><span> {group.count} occurrences · Examples: {group.senders.join(', ')}</span></li>)}</ul>
    </details>}
    <div className="interval-setting"><div><label htmlFor="summary-interval">Summary interval</label><p id="interval-help">Server-side batches · default 20 seconds</p></div><select id="summary-interval" value={summary.intervalSeconds} onChange={event => void onAction('interval', Number(event.target.value))} disabled={disabled} aria-describedby="interval-help">{intervals.map(seconds => <option key={seconds} value={seconds}>{seconds} seconds</option>)}</select></div>
    <div className="summary-controls" role="group" aria-label="Summarisation controls">
      <button className="button primary" onClick={() => void onAction('demo_batch')} disabled={disabled}>Load Demo Batch</button>
      {demo && twitchSession && <button className="button secondary" onClick={() => void onAction('show_twitch')} disabled={disabled}>Return to Twitch chat</button>}
      <button className="button secondary" onClick={() => void onAction('pause')} disabled={disabled || summary.paused}>Pause summarisation</button>
      <button className="button secondary" onClick={() => void onAction('resume')} disabled={disabled || !summary.paused}>Resume summarisation</button>
      <button className="button secondary" onClick={() => void onAction('generate')} disabled={disabled || summary.processing || summary.pendingMessages === 0}>Generate summary now</button>
      <button className="button secondary" onClick={() => void onAction('clear_pending')} disabled={disabled || summary.pendingMessages === 0}>Clear pending messages</button>
      <button className="button secondary" onClick={() => void onAction('clear_history')} disabled={disabled || summary.history.length === 0}>Clear summary history</button>
    </div>
    <p className="summary-queue">{summary.paused ? 'Summarisation paused.' : 'Summarisation running.'} {summary.pendingMessages} pending · {summary.processingMessages} processing.{summary.nextBatchAt && !summary.paused ? ` Next batch at ${time(summary.nextBatchAt)}.` : ''}</p>
    {demo && twitchSession && <p className="small-note">Demo preview only. Your Twitch account and real chat processing remain active in the background.</p>}
    {summary.lastBatch?.reason === 'unchanged' && <p className="small-note">Last batch: {summary.lastBatch.metrics.messages} messages processed. Unchanged highlights were not repeated.</p>}
    {summary.lastBatch?.reason === 'history_cleared' && <p className="small-note">The active batch finished after history was cleared. Its result was discarded.</p>}
    {summary.droppedMessages > 0 && <p className="connection-error" role="alert">Queue limit reached: {summary.droppedMessages} messages were not queued. Capacity is {summary.maxQueue}, including the active batch.</p>}
    {(notice || summary.error) && <p className="connection-error" role="alert">{notice || summary.error}</p>}
    <section className="transcript" aria-labelledby="history-heading"><h3 id="history-heading">Summary history / transcript</h3>
      {summary.history.length === 0 ? <p className="small-note">No generated summaries yet. Empty or unchanged batches do not add history.</p> : <ol className="summary-history" tabIndex={0} aria-label="Summary transcript">{[...summary.history].reverse().map(entry => <li key={entry.id}><time dateTime={entry.generatedAt}>{time(entry.generatedAt)}</time><span className="history-source">{entry.source === 'demo' ? 'Demo Mode' : 'Real Twitch'}</span><p>{entry.text}</p></li>)}</ol>}
    </section>
    <p className="small-note">Enable Speech to hear new generated summaries. Individual chat messages are never spoken. Clearing pending messages leaves the active batch and chat feed intact.</p>
  </section>;
}
