import { normalizeChat, type ChatMessage } from './chat.js';
import { record, string, TwitchError } from './twitch-api.js';

export type ConnectionState = 'not_connected' | 'connecting' | 'authenticated' | 'eventsub_connecting' | 'listening' | 'reconnecting' | 'error';
export type SocketFactory = (url: string) => WebSocket;
type Context = {
  socket: WebSocket; migrated: boolean; welcomed: boolean; chain: Promise<void>; pendingFrames: number;
  timer?: ReturnType<typeof setTimeout>; timeout: number;
  message: (event: MessageEvent) => void; lost: (event: Event) => void;
};

export class EventSubClient {
  state: ConnectionState = 'authenticated';
  error?: string;
  readonly messages: ChatMessage[] = [];
  totalMessages = 0;
  private seen = new Set<string>();
  private contexts = new Set<Context>();
  private active?: Context;
  private migrating?: Context;
  private subscriptionId?: string;
  private stopped = true;
  private attempts = 0;
  private retry?: ReturnType<typeof setTimeout>;

  constructor(private readonly userId: string, private readonly subscribe: (sessionId: string) => Promise<string>, private readonly sockets: SocketFactory = url => new WebSocket(url), private readonly onAuthFailure: () => void = () => {}, private readonly onChatMessage: (message: ChatMessage) => void = () => {}) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false; this.error = undefined; this.attempts = 0;
    this.state = 'eventsub_connecting'; this.open('wss://eventsub.wss.twitch.tv/ws', false);
  }

  private arm(context: Context) {
    clearTimeout(context.timer);
    context.timer = setTimeout(() => this.lost(context), context.timeout);
    context.timer.unref?.();
  }

  private open(url: string, migrated: boolean) {
    if (this.stopped) return;
    try {
      const socket = this.sockets(url);
      const context: Context = { socket, migrated, welcomed: false, chain: Promise.resolve(), pendingFrames: 0, timeout: 15_000,
        message: event => {
          const raw: unknown = event.data;
          if (this.stopped || !this.contexts.has(context) || typeof raw !== 'string' || raw.length > 100_000) return;
          // Bound frames waiting behind an asynchronous subscription request as well as chat batches.
          if (context.pendingFrames >= 500) {
            this.fail('Chat received too many messages to process safely. Please reconnect; some messages may be missing.'); return;
          }
          context.pendingFrames++;
          // Serialize frames, including notifications received while the subscription POST completes.
          context.chain = context.chain.then(() => this.handle(context, raw)).catch(error => {
            if (!this.contexts.has(context) || this.stopped) return;
            if (error instanceof TwitchError && error.retryable) this.lost(context);
            else this.fail(error instanceof TwitchError ? error.message : 'An invalid Twitch response interrupted chat.', error instanceof TwitchError && error.authentication);
          }).finally(() => { context.pendingFrames--; });
        },
        lost: () => this.lost(context),
      };
      this.contexts.add(context);
      if (migrated) this.migrating = context;
      else this.active = context;
      socket.addEventListener('message', context.message);
      socket.addEventListener('close', context.lost);
      socket.addEventListener('error', context.lost);
      this.arm(context);
    } catch { this.scheduleRetry(); }
  }

  private async handle(context: Context, raw: unknown) {
    if (this.stopped || !this.contexts.has(context) || typeof raw !== 'string' || raw.length > 100_000) return;
    let data: unknown;
    try { data = JSON.parse(raw); } catch { return; }
    if (!record(data) || !record(data.metadata) || !record(data.payload)) return;
    const { metadata, payload } = data;
    if (!string(metadata.message_type)) return;
    if (metadata.message_type === 'session_welcome') {
      if (context.welcomed || !record(payload.session) || !string(payload.session.id) || typeof payload.session.keepalive_timeout_seconds !== 'number' || payload.session.keepalive_timeout_seconds < 1 || payload.session.keepalive_timeout_seconds > 600) return;
      context.welcomed = true;
      context.timeout = (payload.session.keepalive_timeout_seconds + 5) * 1000;
      this.arm(context);
      if (context.migrated) {
        if (!this.subscriptionId) throw new TwitchError('Twitch reconnect lost its subscription. Please reconnect.');
        const previous = this.active;
        this.active = context;
        this.migrating = undefined;
        if (previous && previous !== context) this.remove(previous);
      } else {
        const id = await this.subscribe(payload.session.id);
        if (this.stopped || !this.contexts.has(context)) return;
        this.subscriptionId = id;
      }
      this.state = 'listening'; this.error = undefined; this.attempts = 0;
      return;
    }
    if (!context.welcomed) return;
    if (metadata.message_type === 'session_keepalive') { this.arm(context); return; }
    if (metadata.message_type === 'session_reconnect') {
      this.arm(context);
      if (this.migrating) return;
      if (!record(payload.session) || !string(payload.session.reconnect_url)) throw new TwitchError('Twitch supplied an invalid reconnect address.');
      const url = new URL(payload.session.reconnect_url);
      if (url.protocol !== 'wss:' || url.hostname !== 'eventsub.wss.twitch.tv' || url.username || url.password || (url.port && url.port !== '443')) throw new TwitchError('Twitch supplied an invalid reconnect address.');
      this.state = 'reconnecting';
      this.open(payload.session.reconnect_url, true);
      return;
    }
    if (metadata.message_type === 'revocation') {
      if (!record(payload.subscription) || payload.subscription.id !== this.subscriptionId) return;
      this.fail('Twitch revoked the chat subscription. Please disconnect and reconnect.', true);
      return;
    }
    if (metadata.message_type !== 'notification' || metadata.subscription_type !== 'channel.chat.message' || metadata.subscription_version !== '1' || !string(metadata.message_id) || metadata.message_id.length > 200 || !record(payload.subscription) || payload.subscription.id !== this.subscriptionId || payload.subscription.type !== 'channel.chat.message' || payload.subscription.version !== '1') return;
    this.arm(context);
    const message = normalizeChat(payload.event, metadata.message_timestamp, this.userId);
    if (!message || this.seen.has(`event:${metadata.message_id}`) || this.seen.has(`chat:${message.id}`)) return;
    this.seen.add(`event:${metadata.message_id}`); this.seen.add(`chat:${message.id}`);
    while (this.seen.size > 4000) this.seen.delete(this.seen.values().next().value!);
    this.messages.push(message); if (this.messages.length > 100) this.messages.shift();
    this.totalMessages += 1;
    this.onChatMessage(message);
  }

  private remove(context: Context) {
    clearTimeout(context.timer);
    this.contexts.delete(context);
    context.socket.removeEventListener('message', context.message);
    context.socket.removeEventListener('close', context.lost);
    context.socket.removeEventListener('error', context.lost);
    try { context.socket.close(); } catch { /* Already closed. */ }
  }

  private lost(context: Context) {
    if (!this.contexts.has(context) || this.stopped) return;
    if (context === this.active && this.migrating) {
      this.remove(context); this.active = undefined; return;
    }
    for (const item of this.contexts) this.remove(item);
    this.active = undefined; this.migrating = undefined; this.subscriptionId = undefined;
    this.scheduleRetry();
  }

  private scheduleRetry() {
    if (this.stopped || this.retry) return;
    if (this.attempts >= 6) { this.fail('Chat could not reconnect after six attempts. Please reconnect manually.'); return; }
    this.state = 'reconnecting';
    const delay = Math.min(1000 * 2 ** this.attempts++, 30_000);
    this.retry = setTimeout(() => { this.retry = undefined; this.open('wss://eventsub.wss.twitch.tv/ws', false); }, delay);
    this.retry.unref?.();
  }

  fail(message: string, authentication = false) {
    this.stop(); this.state = 'error'; this.error = message;
    if (authentication) this.onAuthFailure();
  }

  stop() {
    this.stopped = true; clearTimeout(this.retry); this.retry = undefined;
    for (const context of this.contexts) this.remove(context);
    this.active = undefined; this.migrating = undefined; this.subscriptionId = undefined;
    this.state = 'not_connected';
  }

  clearMessages() { this.messages.length = 0; this.totalMessages = 0; this.seen.clear(); }
}
