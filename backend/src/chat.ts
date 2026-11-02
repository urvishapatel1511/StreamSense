import { record, string } from './twitch-api.js';

export type ChatMessage = { id: string; user: string; text: string; timestamp: string; source: 'twitch' };

export function normalizeChat(event: unknown, timestamp: unknown, broadcasterId: string): ChatMessage | undefined {
  if (!record(event) || event.broadcaster_user_id !== broadcasterId || !string(event.message_id) || event.message_id.length > 200 || !string(event.chatter_user_name) || event.chatter_user_name.length > 100 || !record(event.message) || !string(event.message.text) || event.message.text.length > 5000 || !string(timestamp) || !Number.isFinite(Date.parse(timestamp))) return;
  return { id: event.message_id, user: event.chatter_user_name, text: event.message.text, timestamp, source: 'twitch' };
}
