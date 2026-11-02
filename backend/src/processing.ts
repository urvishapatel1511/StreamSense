import { record, string } from './twitch-api.js';

export type MessageSource = 'demo' | 'twitch';
export type ProcessingMessage = { id: string; user: string; text: string; timestamp: string; source: MessageSource };
export type NormalizedMessage = ProcessingMessage & { key: string; question: boolean; topic?: 'game' | 'keyboard' | 'map' };
export type ActivityLevel = 'Quiet' | 'Normal' | 'Busy' | 'Very busy';
export interface ProcessingSettings {
  intervalSeconds: number; maxQueue: number; maxHistory: number; activityWindowSeconds: number;
  normalMin: number; busyMin: number; veryBusyMin: number;
}
export const defaultSettings: ProcessingSettings = { intervalSeconds: 20, maxQueue: 500, maxHistory: 20, activityWindowSeconds: 20, normalMin: 5, busyMin: 15, veryBusyMin: 30 };

export function loadProcessingSettings(env: NodeJS.ProcessEnv = process.env): ProcessingSettings {
  const read = (name: string, fallback: number, min: number, max: number) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
    return value;
  };
  const settings = {
    intervalSeconds: read('SUMMARY_INTERVAL_SECONDS', 20, 5, 300), maxQueue: read('SUMMARY_MAX_QUEUE_SIZE', 500, 10, 5000),
    maxHistory: read('SUMMARY_MAX_HISTORY', 20, 1, 100), activityWindowSeconds: read('SUMMARY_ACTIVITY_WINDOW_SECONDS', 20, 5, 300),
    normalMin: read('ACTIVITY_NORMAL_MIN', 5, 1, 10000), busyMin: read('ACTIVITY_BUSY_MIN', 15, 2, 10000), veryBusyMin: read('ACTIVITY_VERY_BUSY_MIN', 30, 3, 10000),
  };
  if (settings.normalMin >= settings.busyMin || settings.busyMin >= settings.veryBusyMin) throw new Error('Activity thresholds must increase: NORMAL < BUSY < VERY_BUSY.');
  return settings;
}

export function isQuestion(text: string): boolean {
  const value = text.trim().toLowerCase();
  if (/^https?:\/\/\S+$/i.test(value)) return false;
  if (value.replace(/https?:\/\/\S+/g, '').includes('?')) return true;
  if (/^(?:can|could|would|will)\s+you\b/.test(value)) return true;
  if (/^(?:what|how)\s+(?:a|an|i|we|you|they|he|she|it|my|our)\b/.test(value)) return false;
  const auxiliary = '(?:is|are|was|were|do|does|did|can|could|would|will|should|have|has)';
  if (new RegExp(`^(?:what|which|whose|how)\\s+(?:[\\p{L}\\p{N}'-]+\\s+){0,4}${auxiliary}\\b`, 'u').test(value)) return true;
  return /^(?:(?:why|when|where|who)\s+(?:is|are|was|were|do|does|did|can|could|would|will|should|have|has|not)\b|who\s+(?:won|knows|made|built)\b|(?:is|are|do|did|should|have)\s+you\b)/.test(value);
}

export function normalizeMessage(input: unknown, source: MessageSource): NormalizedMessage | undefined {
  if (!record(input) || input.source !== source || !string(input.id) || input.id.length > 200 || !string(input.user) || input.user.length > 100 || !string(input.text) || input.text.length > 5000 || !string(input.timestamp) || !Number.isFinite(Date.parse(input.timestamp))) return;
  const text = input.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/gu, ' ').trim();
  const user = input.user.trim();
  if (!text || !user) return;
  const comparison = text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').replace(/[!?.,]+$/u, '').trim();
  if (!comparison) return;
  const question = isQuestion(text);
  // Only these explicit whole-question aliases are merged. Common words alone never merge themes.
  let topic: NormalizedMessage['topic'];
  if (question && /^(?:what|which) game (?:is this|are you playing)$/.test(comparison)) topic = 'game';
  if (question && /^(?:what|which) keyboard (?:are you using|is that)$/.test(comparison)) topic = 'keyboard';
  if (question && /^(?:can|could) you (?:please )?(?:show|open) (?:us )?the map$/.test(comparison)) topic = 'map';
  return { id: input.id, user, text, timestamp: new Date(input.timestamp).toISOString(), source, key: topic ? `question:${topic}` : `${question ? 'question-text' : 'text'}:${comparison}`, question, ...(topic ? { topic } : {}) };
}

export interface MessageGroup { key: string; text: string; count: number; question: boolean; topic?: NormalizedMessage['topic']; senderCount: number; senders: string[] }
export function groupMessages(messages: NormalizedMessage[]): MessageGroup[] {
  const groups = new Map<string, MessageGroup & { names: Set<string> }>();
  for (const message of messages) {
    let group = groups.get(message.key);
    if (!group) {
      group = { key: message.key, text: message.text, count: 0, question: false, ...(message.topic ? { topic: message.topic } : {}), senderCount: 0, senders: [], names: new Set() };
      groups.set(message.key, group);
    }
    group.count++; group.question ||= message.question;
    const name = message.user.toLowerCase();
    if (!group.names.has(name)) { group.names.add(name); group.senderCount++; if (group.senders.length < 3) group.senders.push(message.user); }
  }
  return [...groups.values()].map(({ names: _names, ...group }) => group);
}

export function activityLevel(count: number, settings: ProcessingSettings = defaultSettings): ActivityLevel {
  if (count >= settings.veryBusyMin) return 'Very busy';
  if (count >= settings.busyMin) return 'Busy';
  return count >= settings.normalMin ? 'Normal' : 'Quiet';
}
export interface Activity { level: ActivityLevel; count: number; previousCount: number; windowSeconds: number; burst: boolean }
export class ActivityMeter {
  private buckets = new Map<number, number>();
  private startedAt: number;
  constructor(private readonly settings: ProcessingSettings, private readonly now: () => number = Date.now) { this.startedAt = now(); }
  add() { const second = Math.floor(this.now() / 1000); this.buckets.set(second, (this.buckets.get(second) ?? 0) + 1); this.prune(); }
  private prune() { const cutoff = Math.floor(this.now() / 1000) - this.settings.activityWindowSeconds * 2; for (const key of this.buckets.keys()) if (key <= cutoff) this.buckets.delete(key); }
  snapshot(): Activity {
    this.prune();
    const end = Math.floor(this.now() / 1000), start = end - this.settings.activityWindowSeconds;
    let count = 0, previousCount = 0;
    for (const [second, amount] of this.buckets) { if (second > start && second <= end) count += amount; else if (second > start - this.settings.activityWindowSeconds && second <= start) previousCount += amount; }
    return { level: activityLevel(count, this.settings), count, previousCount, windowSeconds: this.settings.activityWindowSeconds, burst: this.now() - this.startedAt >= this.settings.activityWindowSeconds * 2000 && count >= this.settings.busyMin && count >= Math.max(1, previousCount) * 2 && count - previousCount >= 5 };
  }
  clear() { this.buckets.clear(); this.startedAt = this.now(); }
}

export interface BatchMetrics { messages: number; questions: number; repeatedMessages: number; repeatedGroups: number }
export interface SummaryMemory { highlights: string[]; activity: string; text: string; activityLevel?: ActivityLevel }
export interface Analysis { text?: string; metrics: BatchMetrics; groups: MessageGroup[]; memory: SummaryMemory; reason?: 'empty' | 'unchanged' }
function quote(text: string) { const short = text.length > 100 ? `${text.slice(0, 97)}…` : text; return `“${short}”`; }

export function analyzeBatch(messages: NormalizedMessage[], activity: Activity, previous?: SummaryMemory): Analysis {
  const all = groupMessages(messages);
  const groups = [...all].sort((a, b) => Number(b.question) - Number(a.question) || b.count - a.count);
  const metrics = { messages: messages.length, questions: messages.filter(message => message.question).length, repeatedMessages: all.reduce((sum, group) => sum + Math.max(0, group.count - 1), 0), repeatedGroups: all.filter(group => group.count > 1).length };
  if (!messages.length) return { metrics, groups: [], memory: previous ?? { highlights: [], activity: '', text: '' }, reason: 'empty' };
  const highlights = groups.filter(group => group.question || group.count > 1);
  const fingerprint = (group: MessageGroup) => JSON.stringify([group.key, group.count, group.question]);
  const activitySignature = JSON.stringify([activity.level, activity.count, activity.burst, activity.burst ? activity.previousCount : 0]);
  const fresh = highlights.filter(group => !previous?.highlights.includes(fingerprint(group)));
  const sentences: string[] = [];
  // Up to two questions, plus a repeated phrase; never enumerate the whole chat.
  const selected = fresh.filter(group => group.question).slice(0, 2);
  const repeated = fresh.find(group => !group.question && group.count > 1);
  if (repeated) selected.push(repeated);
  for (const group of fresh) if (selected.length < 2 && !selected.includes(group)) selected.push(group);
  for (const group of selected) {
    const amount = `${group.count} ${group.count === 1 ? 'message' : 'messages'}`;
    if (group.topic === 'game') sentences.push(`${amount} ${group.count === 1 ? 'asks' : 'ask'} which game is being played.`);
    else if (group.topic === 'keyboard') sentences.push(`${amount} ${group.count === 1 ? 'asks' : 'ask'} which keyboard is being used.`);
    else if (group.topic === 'map') sentences.push(`${amount} ${group.count === 1 ? 'asks' : 'ask'} to see the map.`);
    else if (group.question) sentences.push(`${amount} ${group.count === 1 ? 'asks' : 'ask'}: ${quote(group.text)}.`);
    else sentences.push(`${quote(group.text)} was sent ${group.count} times.`);
  }
  const usefulActivity = activity.level === 'Busy' || activity.level === 'Very busy' || (!sentences.length && (!highlights.length || !previous || activity.level !== previous.activityLevel || activity.burst));
  if (activitySignature !== previous?.activity && usefulActivity) {
    const activityText = `Chat is ${activity.level.toLowerCase()}: ${activity.count} ${activity.count === 1 ? 'message' : 'messages'} in the last ${activity.windowSeconds} seconds${activity.burst ? ', at least twice the previous window' : ''}`;
    if (sentences.length >= 3) sentences[0] = `${activityText}; ${sentences[0]}`;
    else sentences.push(`${activityText}.`);
  }
  if (!sentences.length && !highlights.length && !previous) sentences.push(`${messages.length} chat ${messages.length === 1 ? 'message was' : 'messages were'} received; no questions or repetitions detected.`);
  const text = sentences.slice(0, 3).join(' ');
  const mentioned = highlights.filter(group => previous?.highlights.includes(fingerprint(group))).map(fingerprint);
  const memory = { highlights: [...new Set([...mentioned, ...selected.map(fingerprint)])], activity: activitySignature, activityLevel: activity.level, text: text || previous?.text || '' };
  return { metrics, groups: groups.slice(0, 10), memory, ...(text && text !== previous?.text ? { text } : { reason: 'unchanged' as const }) };
}
