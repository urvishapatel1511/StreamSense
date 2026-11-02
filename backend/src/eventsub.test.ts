import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventSubClient } from './eventsub.js';
import { FakeSocket, welcome, notification } from './testing.js';

let sockets: FakeSocket[];
let urls: string[];
let subscribe: ReturnType<typeof vi.fn<(id: string) => Promise<string>>>;
let client: EventSubClient;
const flush = async () => { for (let index = 0; index < 15; index++) await Promise.resolve(); };
beforeEach(() => {
  vi.useFakeTimers(); sockets = []; urls = [];
  subscribe = vi.fn<(id: string) => Promise<string>>().mockResolvedValue('subscription-one');
  client = new EventSubClient('42', subscribe, url => { urls.push(url); const socket = new FakeSocket(); sockets.push(socket); return socket.asSocket(); });
});
afterEach(() => { client.stop(); vi.useRealTimers(); });
describe('EventSub WebSocket lifecycle', () => {
  it('does not create duplicate sockets/listeners when start is repeated', async () => {
    client.start(); client.start(); expect(sockets).toHaveLength(1);
    sockets[0]!.receive(welcome()); await flush(); expect(subscribe).toHaveBeenCalledOnce();
    client.stop(); client.start(); expect(sockets).toHaveLength(2); expect(sockets[0]!.closed).toBe(true);
  });
  it('rejects oversized envelope IDs before retaining them in the deduplication set', async () => {
    client.start(); sockets[0]!.receive(welcome()); await flush();
    sockets[0]!.receive(notification('x'.repeat(5000))); await flush(); expect(client.totalMessages).toBe(0);
    sockets[0]!.receive(notification()); await flush(); expect(client.totalMessages).toBe(1);
  });
  it('bounds frames waiting behind a slow subscription and stops with an explicit error on overflow', async () => {
    let release!: (id: string) => void;
    subscribe.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    client.start(); sockets[0]!.receive(welcome()); await flush();
    for (let i = 0; i < 501; i++) sockets[0]!.receive(notification(`waiting-${i}`, `chat-${i}`));
    expect(client.state).toBe('error'); expect(client.error).toContain('too many messages'); expect(sockets[0]!.closed).toBe(true);
    release('subscription-one'); await vi.advanceTimersByTimeAsync(0);
    expect(client.totalMessages).toBe(0); expect(client.state).toBe('error'); expect(vi.getTimerCount()).toBe(0);
  });
  it('waits for welcome and a successful subscription before reporting listening', async () => {
    client.start(); expect(client.state).toBe('eventsub_connecting'); expect(subscribe).not.toHaveBeenCalled();
    sockets[0]!.receive(welcome()); await flush();
    expect(subscribe).toHaveBeenCalledExactlyOnceWith('ws-one'); expect(client.state).toBe('listening');
    sockets[0]!.receive(welcome()); await flush(); expect(subscribe).toHaveBeenCalledOnce();
  });
  it('normalizes notification frames and deduplicates envelope and chat IDs', async () => {
    client.start(); sockets[0]!.receive(welcome()); sockets[0]!.receive(notification()); await flush();
    sockets[0]!.receive(notification()); sockets[0]!.receive(notification('event-two')); await flush();
    expect(client.totalMessages).toBe(1);
    expect(client.messages[0]).toEqual({ id: 'chat-one', user: 'Viewer', text: '<script>untrusted chat</script>', timestamp: '2026-11-02T00:00:00Z', source: 'twitch' });
  });
  it('ignores malformed frames, unrelated subscriptions and the wrong broadcaster', async () => {
    client.start(); sockets[0]!.receive(welcome()); await flush();
    sockets[0]!.receive('{bad json'); sockets[0]!.receive({ payload: null });
    const wrong = notification(); wrong.payload.event.broadcaster_user_id = 'wrong'; sockets[0]!.receive(wrong);
    const unrelated = notification(); unrelated.payload.subscription.id = 'wrong'; sockets[0]!.receive(unrelated);
    await flush(); expect(client.totalMessages).toBe(0); expect(client.state).toBe('listening');
  });
  it('migrates to the supplied URL without duplicate subscriptions or an early close', async () => {
    client.start(); sockets[0]!.receive(welcome()); await flush();
    const reconnect = 'wss://eventsub.wss.twitch.tv/ws?reconnect=opaque-value';
    sockets[0]!.receive({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: reconnect } } }); await flush();
    expect(client.state).toBe('reconnecting'); expect(urls[1]).toBe(reconnect); expect(sockets[0]!.closed).toBe(false);
    sockets[0]!.receive(notification()); await flush();
    sockets[1]!.receive(welcome('migrated')); await flush();
    expect(sockets[0]!.closed).toBe(true); expect(client.state).toBe('listening'); expect(subscribe).toHaveBeenCalledOnce();
    sockets[1]!.receive(notification()); await flush(); expect(client.totalMessages).toBe(1);
  });
  it('rejects reconnect addresses outside Twitch', async () => {
    client.start(); sockets[0]!.receive(welcome()); await flush();
    sockets[0]!.receive({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: 'wss://attacker.example/ws' } } }); await flush();
    expect(client.state).toBe('error'); expect(sockets).toHaveLength(1);
  });
  it('uses keepalives, detects silence and resubscribes after a dropped connection', async () => {
    client.start(); sockets[0]!.receive(welcome()); await flush();
    await vi.advanceTimersByTimeAsync(12_000);
    sockets[0]!.receive({ metadata: { message_type: 'session_keepalive' }, payload: {} }); await flush();
    await vi.advanceTimersByTimeAsync(12_000); expect(client.state).toBe('listening');
    await vi.advanceTimersByTimeAsync(3001); expect(client.state).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1000); expect(sockets).toHaveLength(2);
    sockets[1]!.receive(welcome('fresh-session')); await flush();
    expect(subscribe).toHaveBeenLastCalledWith('fresh-session'); expect(subscribe).toHaveBeenCalledTimes(2);
  });
  it('stops retrying after six failed attempts', async () => {
    client.start();
    for (let attempt = 0; attempt < 7; attempt++) { sockets.at(-1)!.lose(); await vi.advanceTimersByTimeAsync(30_000); }
    expect(client.state).toBe('error'); expect(client.error).toContain('six attempts');
  });
  it('shows subscription rejection rather than a false connected state', async () => {
    subscribe.mockRejectedValue(new Error('failure'));
    client.start(); sockets[0]!.receive(welcome()); await flush();
    expect(client.state).toBe('error'); expect(sockets[0]!.closed).toBe(true);
  });
  it('handles revocation and cleans up sockets and timers on stop', async () => {
    client.start(); sockets[0]!.receive(welcome()); await flush();
    sockets[0]!.receive({ metadata: { message_type: 'revocation' }, payload: { subscription: { id: 'subscription-one' } } }); await flush();
    expect(client.state).toBe('error'); expect(sockets[0]!.closed).toBe(true);
    client.stop(); sockets[0]!.receive(notification()); sockets[0]!.lose();
    await vi.advanceTimersByTimeAsync(120_000); expect(sockets).toHaveLength(1); expect(client.totalMessages).toBe(0);
  });
  it('retains only the latest 100 messages', async () => {
    client.start(); sockets[0]!.receive(welcome()); await flush();
    for (let index = 0; index < 105; index++) sockets[0]!.receive(notification(`event-${index}`, `chat-${index}`));
    for (let index = 0; index < 110; index++) await flush();
    expect(client.messages).toHaveLength(100); expect(client.totalMessages).toBe(105);
  });
});
