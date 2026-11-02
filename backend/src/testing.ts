import type { TwitchConfig, Configuration } from './config.js';

// Synthetic test fixtures; never loaded by the application.
export const config: TwitchConfig = { clientId: 'test-client', clientSecret: 'test-secret', redirectUri: 'http://localhost:3001/auth/twitch/callback', frontendUrl: 'http://localhost:5173' };
export const configuration: Configuration = { twitch: config, missing: [], frontendUrl: config.frontendUrl };
export const tokens = { access_token: 'test-access', refresh_token: 'test-refresh+/%&', expires_in: 7200, token_type: 'bearer', scope: ['user:read:chat'] };
export const validation = { client_id: config.clientId, user_id: '42', login: 'test_streamer', scopes: ['user:read:chat'], expires_in: 7200 };
export const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
export function subscription(sessionId = 'ws-one') {
  return { data: [{ id: 'subscription-one', status: 'enabled', type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: '42', user_id: '42' }, transport: { method: 'websocket', session_id: sessionId } }] };
}
export class FakeSocket extends EventTarget {
  closed = false;
  close() { this.closed = true; }
  receive(data: unknown) { this.dispatchEvent(new MessageEvent('message', { data: typeof data === 'string' ? data : JSON.stringify(data) })); }
  lose() { this.dispatchEvent(new Event('close')); }
  asSocket() { return this as unknown as WebSocket; }
}
export function welcome(id = 'ws-one') { return { metadata: { message_type: 'session_welcome' }, payload: { session: { id, keepalive_timeout_seconds: 10 } } }; }
export function notification(envelopeId = 'event-one', chatId = 'chat-one', text = '<script>untrusted chat</script>') {
  return { metadata: { message_id: envelopeId, message_type: 'notification', subscription_type: 'channel.chat.message', subscription_version: '1', message_timestamp: '2026-11-02T00:00:00Z' }, payload: { subscription: { id: 'subscription-one', type: 'channel.chat.message', version: '1' }, event: { broadcaster_user_id: '42', message_id: chatId, chatter_user_name: 'Viewer', message: { text } } } };
}
