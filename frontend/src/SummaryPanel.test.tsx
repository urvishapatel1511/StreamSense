// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SummaryPanel from './SummaryPanel';
import { initialSummary, validSummary, type SummaryEntry } from './summaryTypes';

afterEach(cleanup);
export const entry: SummaryEntry = {
  id: 'demo-1', text: '2 messages ask which game is being played.', generatedAt: '2026-11-02T00:00:20Z', source: 'demo',
  metrics: { messages: 6, questions: 3, repeatedMessages: 2, repeatedGroups: 2 },
  activity: { ...initialSummary.activity, count: 6, level: 'Normal' },
  groups: [{ key: 'question:game', text: 'What game is this?', count: 2, question: true, senderCount: 2, senders: ['ViewerOne', 'ViewerTwo'] }],
};
describe('summary dashboard', () => {
  it('shows generated text, transcript, metrics and source with a separate speech panel', () => {
    render(<SummaryPanel summary={{ ...initialSummary, latest: entry, history: [entry] }} demo available busy={false} notice="" onAction={vi.fn()} />);
    expect(screen.getAllByText(entry.text)).toHaveLength(2); expect(screen.getByRole('list', { name: 'Summary transcript' })).toBeTruthy();
    expect(screen.getByText('Messages processed').parentElement!.querySelector('dd')!.textContent).toBe('6');
    expect(screen.getByText('Questions detected').parentElement!.querySelector('dd')!.textContent).toBe('3');
    expect(screen.getByText('Repeat messages').parentElement!.querySelector('dd')!.textContent).toBe('2');
    expect(screen.getByText('Demo Mode summaries')).toBeTruthy(); expect(screen.getByText(/Enable Speech to hear new generated summaries/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /speak|read aloud/i })).toBeNull();
  });
  it('exposes labelled native controls for all summary actions', () => {
    const action = vi.fn().mockResolvedValue(undefined);
    const summary = { ...initialSummary, pendingMessages: 6, latest: entry, history: [entry] };
    const view = render(<SummaryPanel summary={summary} demo available busy={false} notice="" onAction={action} />);
    for (const [name, expected] of [['Load Demo Batch', 'demo_batch'], ['Pause summarisation', 'pause'], ['Generate summary now', 'generate'], ['Clear pending messages', 'clear_pending'], ['Clear summary history', 'clear_history']]) {
      fireEvent.click(screen.getByRole('button', { name: name! })); expect(action).toHaveBeenLastCalledWith(expected);
    }
    fireEvent.change(screen.getByLabelText('Summary interval'), { target: { value: '60' } }); expect(action).toHaveBeenLastCalledWith('interval', 60);
    view.rerender(<SummaryPanel summary={{ ...summary, paused: true }} demo available busy={false} notice="" onAction={action} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume summarisation' })); expect(action).toHaveBeenLastCalledWith('resume');
  });
  it('shows overflow and suppressed-batch notices honestly', () => {
    render(<SummaryPanel summary={{ ...initialSummary, droppedMessages: 4, lastBatch: { generatedAt: entry.generatedAt, metrics: entry.metrics, reason: 'unchanged' } }} demo available busy={false} notice="" onAction={vi.fn()} />);
    expect(screen.getByText(/4 messages were not queued/)).toBeTruthy(); expect(screen.getByText(/Unchanged highlights were not repeated/)).toBeTruthy();
  });
  it('offers the isolated demo loader in Twitch mode and disables actions while processing', () => {
    render(<SummaryPanel summary={{ ...initialSummary, source: 'twitch', processing: true }} demo={false} available busy notice="" onAction={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Load Demo Batch' }).hasAttribute('disabled')).toBe(true); expect(screen.getByText('Real Twitch summaries')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate summary now' }).hasAttribute('disabled')).toBe(true);
  });
  it('offers a return action without disconnecting a preserved Twitch session', () => {
    const action = vi.fn().mockResolvedValue(undefined);
    render(<SummaryPanel summary={initialSummary} demo twitchSession available busy={false} notice="" onAction={action} />);
    fireEvent.click(screen.getByRole('button', { name: 'Return to Twitch chat' })); expect(action).toHaveBeenCalledWith('show_twitch');
    expect(screen.getByText(/real chat processing remain active/)).toBeTruthy();
  });
  it('rejects malformed summary payloads instead of crashing on history or metrics', () => {
    expect(validSummary(initialSummary)).toBe(true);
    expect(validSummary({ ...initialSummary, history: [null] })).toBe(false);
    expect(validSummary({ ...initialSummary, latest: { ...entry, metrics: {} } })).toBe(false);
  });
});
