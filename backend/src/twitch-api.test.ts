import { afterEach, describe, expect, it, vi } from 'vitest';
import { TwitchApi, subscriptionBody } from './twitch-api.js';
import { config, tokens, validation, json, subscription } from './testing.js';

afterEach(() => vi.useRealTimers());
describe('Twitch user-token management', () => {
  it('exchanges a code and validates its client, user and scope', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(json(tokens)).mockResolvedValueOnce(json(validation));
    const api = new TwitchApi(config, http);
    expect(await api.login('code-one')).toEqual({ id: '42', login: 'test_streamer' });
    const request = http.mock.calls[0]![1]!;
    expect(request.method).toBe('POST');
    expect(new URLSearchParams(request.body as URLSearchParams).get('redirect_uri')).toBe(config.redirectUri);
    expect(http.mock.calls[1]![1]!.headers).toEqual({ Authorization: 'OAuth test-access' }); api.dispose();
  });
  it.each([{ ...validation, client_id: 'wrong' }, { ...validation, scopes: [] }, { ...validation, user_id: null }, { ...validation, expires_in: 0 }])('rejects invalid token identity or permissions', async invalid => {
    const api = new TwitchApi(config, vi.fn<typeof fetch>().mockResolvedValueOnce(json(tokens)).mockResolvedValueOnce(json(invalid)));
    await expect(api.login('code')).rejects.toThrow(/wrong account|permission/); api.dispose();
  });
  it('refreshes on HTTP 401, URL encodes refresh tokens, validates again, and retries', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(json(tokens)).mockResolvedValueOnce(json(validation))
      .mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({ ...tokens, access_token: 'new-access', refresh_token: 'new-refresh' }))
      .mockResolvedValueOnce(json(validation)).mockResolvedValueOnce(json(subscription(), 202));
    const api = new TwitchApi(config, http); await api.login('code');
    expect(await api.subscribe('ws-one')).toBe('subscription-one');
    const body = http.mock.calls[3]![1]!.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token'); expect(body.get('refresh_token')).toBe(tokens.refresh_token);
    expect((http.mock.calls[5]![1]!.headers as Record<string, string>).Authorization).toBe('Bearer new-access'); api.dispose();
  });
  it('refreshes expired credentials and validates hourly', async () => {
    vi.useFakeTimers();
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(json(tokens)).mockResolvedValueOnce(json(validation))
      .mockResolvedValueOnce(json(validation)).mockResolvedValueOnce(json(tokens)).mockResolvedValueOnce(json(validation));
    const api = new TwitchApi(config, http); await api.login('code');
    vi.setSystemTime(Date.now() + 60 * 60 * 1000 + 1); await api.maintain();
    expect(http.mock.calls[2]![0]).toContain('/validate');
    vi.setSystemTime(Date.now() + 7200 * 1000 + 1); await api.maintain();
    expect((http.mock.calls[3]![1]!.body as URLSearchParams).get('grant_type')).toBe('refresh_token'); api.dispose();
  });
  it('reports refresh rejection safely', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(json(tokens)).mockResolvedValueOnce(json(validation)).mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({ message: 'PRIVATE UPSTREAM RESPONSE' }, 400));
    const api = new TwitchApi(config, http); await api.login('code');
    await expect(api.subscribe('ws-one')).rejects.toThrow('Twitch login or token refresh failed. Please connect again.'); api.dispose();
  });
  it('rejects unconfirmed subscriptions and prevents work after disposal', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(json(tokens)).mockResolvedValueOnce(json(validation)).mockResolvedValueOnce(json({ data: [] }, 202));
    const api = new TwitchApi(config, http); await api.login('code');
    await expect(api.subscribe('ws-one')).rejects.toThrow('did not confirm'); api.dispose();
    await expect(api.validate()).rejects.toThrow('connect your Twitch account');
  });
  it('constructs a user-token WebSocket subscription for the broadcaster account', () => {
    expect(subscriptionBody('42', 'welcome-id')).toEqual({ type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: '42', user_id: '42' }, transport: { method: 'websocket', session_id: 'welcome-id' } });
  });
});
