import { ActivityMeter, analyzeBatch, normalizeMessage, type Activity, type Analysis, type BatchMetrics, type MessageGroup, type MessageSource, type NormalizedMessage, type ProcessingSettings, type SummaryMemory } from './processing.js';

export interface SummaryEntry { id: string; text: string; generatedAt: string; source: MessageSource; metrics: BatchMetrics; activity: Activity; groups: MessageGroup[] }
export type SummaryGenerator = (batch: NormalizedMessage[], activity: Activity, previous?: SummaryMemory) => Analysis | Promise<Analysis>;
export class SummaryBatcher {
  private queue: NormalizedMessage[] = [];
  private inFlight: NormalizedMessage[] = [];
  private history: SummaryEntry[] = [];
  private memory?: SummaryMemory;
  private seen = new Set<string>();
  private activity: ActivityMeter;
  private timer?: ReturnType<typeof setTimeout>;
  private nextBatchAt: string | null = null;
  private paused = false;
  private processing = false;
  private disposed = false;
  private dropped = 0;
  private sequence = 0;
  private historyRevision = 0;
  private error: string | null = null;
  private lastBatch: { generatedAt: string; metrics: BatchMetrics; reason: 'generated' | 'empty' | 'unchanged' | 'history_cleared' } | null = null;

  constructor(readonly source: MessageSource, private settings: ProcessingSettings, private readonly generator: SummaryGenerator = analyzeBatch, private readonly now: () => number = Date.now) {
    this.settings = { ...settings }; this.activity = new ActivityMeter(settings, now); this.schedule();
  }
  ingest(input: unknown): boolean {
    if (this.disposed) return false;
    const message = normalizeMessage(input, this.source);
    if (!message || this.seen.has(message.id)) return false;
    this.seen.add(message.id);
    while (this.seen.size > this.settings.maxQueue * 4) this.seen.delete(this.seen.values().next().value!);
    this.activity.add();
    if (this.queue.length + this.inFlight.length >= this.settings.maxQueue) { this.dropped++; return false; }
    this.queue.push(message); return true;
  }
  private clearTimer() { clearTimeout(this.timer); this.timer = undefined; this.nextBatchAt = null; }
  private schedule() {
    this.clearTimer();
    if (this.paused || this.disposed || this.processing) return;
    this.nextBatchAt = new Date(this.now() + this.settings.intervalSeconds * 1000).toISOString();
    this.timer = setTimeout(() => { this.timer = undefined; void this.generate('timer'); }, this.settings.intervalSeconds * 1000);
    this.timer.unref?.();
  }
  async generate(trigger: 'manual' | 'timer' = 'manual'): Promise<boolean> {
    if (this.disposed || this.processing || (this.paused && trigger === 'timer')) return false;
    this.clearTimer();
    if (!this.queue.length) { this.schedule(); return true; }
    // Detach the batch before awaiting the generator; subsequent arrivals stay in the next queue.
    const batch = this.queue; this.queue = []; this.inFlight = batch; this.processing = true;
    const revision = this.historyRevision;
    const activity = this.activity.snapshot();
    try {
      const analysis = await this.generator(batch, activity, this.memory);
      if (this.disposed) return false;
      const generatedAt = new Date(this.now()).toISOString();
      const cleared = revision !== this.historyRevision;
      this.lastBatch = { generatedAt, metrics: analysis.metrics, reason: cleared ? 'history_cleared' : analysis.text ? 'generated' : analysis.reason ?? 'empty' };
      if (!cleared) {
        this.memory = analysis.memory;
        if (analysis.text) {
          this.history.push({ id: `${this.source}-${++this.sequence}`, text: analysis.text, generatedAt, source: this.source, metrics: analysis.metrics, activity, groups: analysis.groups });
          if (this.history.length > this.settings.maxHistory) this.history.shift();
        }
      }
      this.error = null;
      return true;
    } catch {
      if (!this.disposed) { this.queue = [...batch, ...this.queue]; this.error = 'Summary generation failed. Messages remain queued for retry.'; }
      return false;
    } finally {
      this.inFlight = []; this.processing = false;
      if (!this.disposed) this.schedule();
    }
  }
  pause() { this.paused = true; this.clearTimer(); }
  resume() { if (!this.disposed) { this.paused = false; this.schedule(); } }
  setInterval(seconds: number) {
    if (!Number.isInteger(seconds) || seconds < 5 || seconds > 300) throw new Error('Summary interval must be an integer from 5 to 300 seconds.');
    this.settings.intervalSeconds = seconds; this.schedule();
  }
  clearPending() { this.queue = []; this.dropped = 0; this.error = null; }
  clearHistory() { this.historyRevision++; this.history = []; this.memory = undefined; this.lastBatch = null; }
  snapshot() {
    return { source: this.source, intervalSeconds: this.settings.intervalSeconds, paused: this.paused, processing: this.processing, pendingMessages: this.queue.length, processingMessages: this.inFlight.length, maxQueue: this.settings.maxQueue, droppedMessages: this.dropped, maxHistory: this.settings.maxHistory, nextBatchAt: this.nextBatchAt, activity: this.activity.snapshot(), latest: this.history.at(-1) ?? null, history: this.history, lastBatch: this.lastBatch, error: this.error };
  }
  dispose() { this.disposed = true; this.clearTimer(); this.queue = []; this.inFlight = []; this.history = []; this.memory = undefined; this.seen.clear(); this.activity.clear(); }
}
