import type { TwitchConfig } from './config.js';

export const CHAT_SCOPE = 'user:read:chat';
export type Fetcher = typeof fetch;
export function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
export function string(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }

export class TwitchError extends Error {
  constructor(message: string, public readonly authentication = false, public readonly retryable = false) { super(message); }
}

type Tokens = { access: string; refresh: string; expiresAt: number };
export type TwitchUser = { id: string; login: string };

export function subscriptionBody(userId: string, sessionId: string) {
  return { type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: userId, user_id: userId }, transport: { method: 'websocket', session_id: sessionId } };
}

export class TwitchApi {
  private tokens?: Tokens;
  private refreshPending?: Promise<void>;
  private readonly controller = new AbortController();
  private disposed = false;
  private validatedAt = 0;
  user?: TwitchUser;

  constructor(private readonly config: TwitchConfig, private readonly http: Fetcher = fetch) {}

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    if (this.disposed) throw new TwitchError('The Twitch session has ended.', true);
    try {
      return await this.http(url, { ...init, signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(8000)]) });
    } catch { throw new TwitchError('Twitch could not be reached. Check your connection and try again.', false, true); }
  }

  private async readTokens(body: URLSearchParams) {
    const response = await this.request('https://id.twitch.tv/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    if (!response.ok) throw new TwitchError('Twitch login or token refresh failed. Please connect again.', response.status < 500, response.status >= 500);
    let data: unknown;
    try { data = await response.json(); } catch { throw new TwitchError('Twitch returned an invalid token response.'); }
    if (!record(data) || !string(data.access_token) || !string(data.refresh_token) || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || data.token_type !== 'bearer') throw new TwitchError('Twitch returned an invalid token response.');
    if (this.disposed) throw new TwitchError('The Twitch session has ended.', true);
    this.tokens = { access: data.access_token, refresh: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000 };
  }

  async login(code: string): Promise<TwitchUser> {
    await this.readTokens(new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, grant_type: 'authorization_code', code, redirect_uri: this.config.redirectUri }));
    await this.validate(false);
    return this.user!;
  }

  private async refresh() {
    if (this.refreshPending) return this.refreshPending;
    const refreshToken = this.tokens?.refresh;
    if (!refreshToken) throw new TwitchError('Please connect your Twitch account again.', true);
    this.refreshPending = (async () => {
      await this.readTokens(new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }));
      await this.validate(false);
    })();
    try { await this.refreshPending; } finally { this.refreshPending = undefined; }
  }

  async validate(allowRefresh = true) {
    if (!this.tokens) throw new TwitchError('Please connect your Twitch account again.', true);
    const response = await this.request('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${this.tokens.access}` } });
    if (response.status === 401 && allowRefresh) { await this.refresh(); return; }
    if (!response.ok) throw new TwitchError(response.status === 401 ? 'Twitch authorization expired or was revoked. Please reconnect.' : 'Twitch token validation is temporarily unavailable.', response.status === 401, response.status >= 500);
    const data: unknown = await response.json();
    if (!record(data) || data.client_id !== this.config.clientId || !string(data.user_id) || !string(data.login) || !Array.isArray(data.scopes) || !data.scopes.includes(CHAT_SCOPE) || typeof data.expires_in !== 'number' || data.expires_in <= 0 || (this.user && this.user.id !== data.user_id)) throw new TwitchError('Twitch returned the wrong account, application or chat permission. Please reconnect.', true);
    this.user = { id: data.user_id, login: data.login };
    this.tokens.expiresAt = Date.now() + data.expires_in * 1000;
    this.validatedAt = Date.now();
  }

  async maintain() {
    if (this.tokens && Date.now() >= this.tokens.expiresAt) await this.refresh();
    else if (Date.now() - this.validatedAt >= 55 * 60 * 1000) await this.validate();
  }

  async subscribe(sessionId: string): Promise<string> {
    if (this.disposed || !this.tokens || !this.user) throw new TwitchError('Please connect your Twitch account again.', true);
    await this.maintain();
    const send = () => this.request('https://api.twitch.tv/helix/eventsub/subscriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${this.tokens?.access}`, 'Client-Id': this.config.clientId, 'Content-Type': 'application/json' },
      body: JSON.stringify(subscriptionBody(this.user!.id, sessionId)),
    });
    let response = await send();
    if (response.status === 401) { await this.refresh(); response = await send(); }
    if (response.status !== 202) throw new TwitchError('Twitch rejected the chat subscription. Reconnect and check your app permissions.', response.status === 401 || response.status === 403, response.status >= 500 || response.status === 429);
    const result: unknown = await response.json();
    const subscription = record(result) && Array.isArray(result.data) ? result.data[0] : undefined;
    if (!record(subscription) || !string(subscription.id) || subscription.status !== 'enabled' || subscription.type !== 'channel.chat.message' || subscription.version !== '1' || !record(subscription.transport) || subscription.transport.method !== 'websocket' || subscription.transport.session_id !== sessionId || !record(subscription.condition) || subscription.condition.broadcaster_user_id !== this.user!.id || subscription.condition.user_id !== this.user!.id) throw new TwitchError('Twitch did not confirm the requested chat subscription.');
    return subscription.id;
  }

  dispose() { this.disposed = true; this.controller.abort(); this.tokens = undefined; this.user = undefined; }
}
