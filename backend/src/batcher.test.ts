import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SummaryBatcher, type SummaryGenerator } from './batcher.js';
import { analyzeBatch, defaultSettings } from './processing.js';
import { demoBatch } from './demo.js';

const message = (id: string, text = 'What game is this?', source: 'demo' | 'twitch' = 'demo') => ({ id, text, user: 'Viewer', timestamp: new Date().toISOString(), source });
let batchers: SummaryBatcher[];
function create(generator?: SummaryGenerator, override: Partial<typeof defaultSettings> = {}, source: 'demo' | 'twitch' = 'demo') {
  const batcher = new SummaryBatcher(source, { ...defaultSettings, ...override }, generator); batchers.push(batcher); return batcher;
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-02T00:00:00Z')); batchers = []; });
afterEach(() => { for (const batcher of batchers) batcher.dispose(); vi.useRealTimers(); });

describe('summary batching lifecycle', () => {
  it('retains bounded queues and history under 10,000 inputs and repeated batches', async () => {
    const batcher = create();
    for (let i = 0; i < 10000; i++) batcher.ingest(message(`stress-${i}`, `Can you explain puzzle ${i}?`));
    expect(batcher.snapshot()).toMatchObject({ pendingMessages: 500, processingMessages: 0, droppedMessages: 9500 });
    await batcher.generate(); expect(batcher.snapshot().latest!.metrics.messages).toBe(500); expect(batcher.snapshot().latest!.groups.length).toBeLessThanOrEqual(10);
    for (let i = 0; i < 30; i++) { batcher.ingest(message(`later-${i}`, `Can you explain section ${i}?`)); await batcher.generate(); }
    expect(batcher.snapshot().history).toHaveLength(20); expect(batcher.snapshot().pendingMessages).toBe(0);
    batcher.dispose(); expect(batcher.snapshot().nextBatchAt).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
  it('runs the 28-message demo through the exact same pipeline as equivalent Twitch inputs', async () => {
    const demo = create(), real = create(undefined, {}, 'twitch');
    const messages = demoBatch(0);
    expect(messages).toHaveLength(28); expect(new Set(messages.map(message => message.user)).size).toBe(28);
    for (const message of messages) { expect(demo.ingest(message)).toBe(true); expect(real.ingest({ ...message, source: 'twitch' })).toBe(true); }
    await demo.generate(); await real.generate();
    expect(demo.snapshot().latest!.text).toBe(real.snapshot().latest!.text);
    expect(demo.snapshot().latest!.groups).toEqual(real.snapshot().latest!.groups);
    expect(demo.snapshot().latest!.metrics).toEqual(real.snapshot().latest!.metrics);
    expect(demo.snapshot().activity).toMatchObject({ count: 28, level: 'Busy' });
    expect(demo.snapshot().latest!.source).toBe('demo'); expect(real.snapshot().latest!.source).toBe('twitch');
  });
  it('uses 20-second batches and does not create empty summaries', async () => {
    const batcher = create(); await vi.advanceTimersByTimeAsync(20_000); expect(batcher.snapshot().history).toHaveLength(0);
    batcher.ingest(message('one')); await vi.advanceTimersByTimeAsync(19_999); expect(batcher.snapshot().history).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); expect(batcher.snapshot().history).toHaveLength(1); expect(batcher.snapshot().pendingMessages).toBe(0);
  });
  it('places arrivals during generation in the next batch and prevents overlap', async () => {
    let release!: () => void;
    const generator = vi.fn<SummaryGenerator>().mockImplementation(analyzeBatch).mockImplementationOnce((batch, activity, previous) => new Promise(resolve => { release = () => resolve(analyzeBatch(batch, activity, previous)); }));
    const batcher = create(generator); batcher.ingest(message('one'));
    const first = batcher.generate(); batcher.ingest(message('two', 'Can you show the map?'));
    expect(batcher.snapshot()).toMatchObject({ processingMessages: 1, pendingMessages: 1, processing: true });
    expect(await batcher.generate()).toBe(false); expect(generator).toHaveBeenCalledOnce();
    release(); await first; expect(batcher.snapshot().latest!.metrics.messages).toBe(1);
    await batcher.generate(); expect(batcher.snapshot().latest!.metrics.messages).toBe(1); expect(batcher.snapshot().history).toHaveLength(2);
  });
  it('pauses timers while retaining inputs and allows an explicit manual generation', async () => {
    const batcher = create(); batcher.pause(); batcher.ingest(message('one'));
    await vi.advanceTimersByTimeAsync(60_000); expect(batcher.snapshot().pendingMessages).toBe(1); expect(batcher.snapshot().history).toHaveLength(0);
    await batcher.generate(); expect(batcher.snapshot().paused).toBe(true); expect(batcher.snapshot().history).toHaveLength(1);
    batcher.ingest(message('two', 'Can you show the map?')); batcher.resume(); await vi.advanceTimersByTimeAsync(20_000);
    expect(batcher.snapshot().history).toHaveLength(2);
  });
  it('changes the interval without overlapping or dropping queued messages', async () => {
    const batcher = create(); batcher.ingest(message('one')); batcher.setInterval(5);
    await vi.advanceTimersByTimeAsync(5000); expect(batcher.snapshot().history).toHaveLength(1);
    expect(() => batcher.setInterval(0)).toThrow('5 to 300');
  });
  it('clears pending messages separately from history', async () => {
    const batcher = create(); batcher.ingest(message('one')); await batcher.generate(); batcher.ingest(message('two'));
    batcher.clearPending(); expect(batcher.snapshot().pendingMessages).toBe(0); expect(batcher.snapshot().history).toHaveLength(1);
    batcher.clearHistory(); expect(batcher.snapshot().latest).toBeNull(); expect(batcher.snapshot().history).toHaveLength(0);
  });
  it('keeps history cleared if a generation was already in flight', async () => {
    let release!: () => void;
    const batcher = create((batch, activity, previous) => new Promise(resolve => { release = () => resolve(analyzeBatch(batch, activity, previous)); }));
    batcher.ingest(message('one')); const pending = batcher.generate(); batcher.clearHistory(); release(); await pending;
    expect(batcher.snapshot().history).toHaveLength(0); expect(batcher.snapshot().lastBatch!.reason).toBe('history_cleared');
  });
  it('restores a failed batch ahead of new arrivals without losing accepted messages', async () => {
    let fail!: () => void;
    const generator = vi.fn<SummaryGenerator>().mockImplementation(analyzeBatch).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = () => reject(new Error('failure')); }));
    const batcher = create(generator); batcher.ingest(message('one')); const pending = batcher.generate(); batcher.ingest(message('two'));
    fail(); await pending; expect(batcher.snapshot().pendingMessages).toBe(2); expect(batcher.snapshot().error).toContain('remain queued');
    await batcher.generate(); expect(batcher.snapshot().latest!.metrics.messages).toBe(2); expect(batcher.snapshot().error).toBeNull();
  });
  it('bounds queue size, reports overflow and deduplicates message IDs', () => {
    const batcher = create(undefined, { maxQueue: 2 });
    expect(batcher.ingest(message('one'))).toBe(true); expect(batcher.ingest(message('one'))).toBe(false);
    expect(batcher.ingest(message('two'))).toBe(true); expect(batcher.ingest(message('three'))).toBe(false);
    expect(batcher.snapshot()).toMatchObject({ pendingMessages: 2, droppedMessages: 1 });
  });
  it('bounds history and skips duplicate consecutive summaries', async () => {
    const batcher = create(undefined, { maxHistory: 2 }); batcher.ingest(message('one')); await batcher.generate();
    batcher.ingest(message('two')); await batcher.generate(); expect(batcher.snapshot().history).toHaveLength(1); expect(batcher.snapshot().lastBatch!.reason).toBe('unchanged');
    batcher.ingest(message('three', 'Can you show the map?')); await batcher.generate();
    batcher.ingest(message('four', 'What keyboard are you using?')); await batcher.generate(); expect(batcher.snapshot().history).toHaveLength(2);
  });
  it('disposes timers and rejects stale in-flight results after disconnect', async () => {
    let release!: () => void;
    const batcher = create((batch, activity, previous) => new Promise(resolve => { release = () => resolve(analyzeBatch(batch, activity, previous)); }));
    batcher.ingest(message('one')); const pending = batcher.generate(); batcher.dispose(); release(); await pending;
    await vi.advanceTimersByTimeAsync(60_000); expect(batcher.snapshot().history).toHaveLength(0); expect(batcher.snapshot().nextBatchAt).toBeNull(); expect(batcher.ingest(message('two'))).toBe(false);
  });
  it('processes demo and real input in isolated queues', async () => {
    const demo = create(); const real = create(undefined, {}, 'twitch');
    expect(demo.ingest(message('real', 'What game is this?', 'twitch'))).toBe(false);
    expect(real.ingest(message('demo'))).toBe(false);
    real.ingest(message('real', 'What game is this?', 'twitch')); await real.generate();
    expect(real.snapshot().latest!.source).toBe('twitch'); expect(demo.snapshot().latest).toBeNull();
  });
});
