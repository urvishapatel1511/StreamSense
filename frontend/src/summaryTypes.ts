export type SummaryAction = 'pause' | 'resume' | 'generate' | 'clear_pending' | 'clear_history' | 'interval' | 'demo_batch' | 'show_twitch';
type Metrics = { messages: number; questions: number; repeatedMessages: number; repeatedGroups: number };
type Activity = { level: 'Quiet' | 'Normal' | 'Busy' | 'Very busy'; count: number; previousCount: number; windowSeconds: number; burst: boolean };
export type SummaryEntry = {
  id: string; text: string; generatedAt: string; source: 'demo' | 'twitch'; metrics: Metrics; activity: Activity;
  groups: { key: string; text: string; count: number; question: boolean; senderCount: number; senders: string[] }[];
};
export type SummarySnapshot = {
  source: 'demo' | 'twitch'; intervalSeconds: number; paused: boolean; processing: boolean;
  pendingMessages: number; processingMessages: number; maxQueue: number; droppedMessages: number; maxHistory: number;
  nextBatchAt: string | null; activity: Activity; latest: SummaryEntry | null; history: SummaryEntry[];
  lastBatch: { generatedAt: string; metrics: Metrics; reason: 'generated' | 'empty' | 'unchanged' | 'history_cleared' } | null;
  error: string | null;
};
export const initialSummary: SummarySnapshot = {
  source: 'demo', intervalSeconds: 20, paused: false, processing: false, pendingMessages: 0, processingMessages: 0,
  maxQueue: 500, droppedMessages: 0, maxHistory: 20, nextBatchAt: null,
  activity: { level: 'Quiet', count: 0, previousCount: 0, windowSeconds: 20, burst: false }, latest: null, history: [], lastBatch: null, error: null,
};
export function validSummary(value: unknown): value is SummarySnapshot {
  const object = (item: unknown): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item);
  if (!object(value)) return false;
  const data = value;
  const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  const date = (item: unknown) => typeof item === 'string' && Number.isFinite(Date.parse(item));
  const metrics = (item: unknown) => object(item) && ['messages', 'questions', 'repeatedMessages', 'repeatedGroups'].every(key => count(item[key]));
  const activity = (item: unknown) => object(item) && ['Quiet', 'Normal', 'Busy', 'Very busy'].includes(String(item.level)) && count(item.count) && count(item.previousCount) && count(item.windowSeconds) && typeof item.burst === 'boolean';
  const entry = (item: unknown) => object(item) && typeof item.id === 'string' && typeof item.text === 'string' && item.text.length <= 1000 && date(item.generatedAt) && (item.source === 'demo' || item.source === 'twitch') && metrics(item.metrics) && activity(item.activity) && Array.isArray(item.groups) && item.groups.length <= 10 && item.groups.every(group => object(group) && typeof group.text === 'string' && typeof group.key === 'string' && count(group.count) && count(group.senderCount) && typeof group.question === 'boolean' && Array.isArray(group.senders) && group.senders.length <= 3 && group.senders.every(name => typeof name === 'string'));
  return (data.source === 'demo' || data.source === 'twitch') && typeof data.intervalSeconds === 'number' && Number.isInteger(data.intervalSeconds) && data.intervalSeconds >= 5 && data.intervalSeconds <= 300 && typeof data.paused === 'boolean' && typeof data.processing === 'boolean' && ['pendingMessages', 'processingMessages', 'maxQueue', 'droppedMessages', 'maxHistory'].every(key => count(data[key])) && (data.nextBatchAt === null || date(data.nextBatchAt)) && activity(data.activity) && Array.isArray(data.history) && data.history.length <= 100 && data.history.every(entry) && (data.latest === null || entry(data.latest)) && (data.error === null || typeof data.error === 'string') && (data.lastBatch === null || (object(data.lastBatch) && date(data.lastBatch.generatedAt) && metrics(data.lastBatch.metrics) && ['generated', 'empty', 'unchanged', 'history_cleared'].includes(String(data.lastBatch.reason))));
}
