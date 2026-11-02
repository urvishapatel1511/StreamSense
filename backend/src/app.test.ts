import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import type { SummaryBatcher } from './batcher.js';
import type { ProcessingMessage } from './processing.js';
import { configuration, config, FakeSocket, json, notification, subscription, tokens, validation, welcome } from './testing.js';

let runtime: ReturnType<typeof createApp>;
let server: Server;
let base: string;
let sockets: FakeSocket[];
let http: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(async () => {
  sockets = [];
  http = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    if (String(input).endsWith('/token')) return json(tokens);
    if (String(input).endsWith('/validate')) return json(validation);
    const body = JSON.parse(String(init!.body)) as { transport: { session_id: string } };
    return json(subscription(body.transport.session_id), 202);
  });
  runtime = createApp({ configuration, http, sockets: () => { const socket = new FakeSocket(); sockets.push(socket); return socket.asSocket(); } });
  await new Promise<void>((resolve, reject) => { server = runtime.app.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve()); });
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => { runtime.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
async function begin(cookie?: string) {
  const response = await fetch(`${base}/auth/twitch`, { redirect: 'manual', ...(cookie ? { headers: { Cookie: cookie } } : {}) });
  const location = new URL(response.headers.get('location')!);
  return { response, location, cookie: response.headers.get('set-cookie')!.split(';')[0]!, state: location.searchParams.get('state')! };
}
async function login(cookie?: string) {
  const start = await begin(cookie);
  const response = await fetch(`${base}/auth/twitch/callback?code=test-code&state=${start.state}`, { redirect: 'manual', headers: { Cookie: start.cookie } });
  return { ...start, callback: response, authenticatedCookie: response.headers.get('set-cookie')!.split(';')[0]! };
}
describe('OAuth and session HTTP routes', () => {
  it('retains the original health contract and adds /health', async () => {
    for (const path of ['/api/health', '/health']) {
      const response = await fetch(`${base}${path}`);
      expect(response.status).toBe(200); expect(response.headers.get('x-powered-by')).toBeNull();
      expect(await response.json()).toEqual({ status: 'ok', service: 'streamsense-backend', twitchConnected: false, demoMode: true });
    }
  });
  it('uses only read-chat scope, state and an HTTP-only SameSite cookie', async () => {
    const { response, location, state } = await begin();
    expect(response.status).toBe(302); expect(location.origin).toBe('https://id.twitch.tv');
    expect(location.searchParams.get('scope')).toBe('user:read:chat'); expect(location.searchParams.get('redirect_uri')).toBe(config.redirectUri);
    expect(state).toMatch(/^[a-f0-9]{64}$/);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly'); expect(response.headers.get('set-cookie')).toContain('SameSite=Lax');
    expect(response.headers.get('set-cookie')).not.toContain('Secure;');
  });
  it('canonicalizes 127.0.0.1 to localhost before starting OAuth', async () => {
    const response = await fetch(`${base.replace('localhost', '127.0.0.1')}/auth/twitch`, { redirect: 'manual' });
    expect(response.headers.get('location')).toBe('http://localhost:3001/auth/twitch'); expect(http).not.toHaveBeenCalled();
  });
  it('authenticates, rotates cookies, waits for EventSub and returns only safe status', async () => {
    const start = await login();
    expect(start.callback.headers.get('location')).toBe('http://localhost:5173/'); expect(start.authenticatedCookie).not.toBe(start.cookie);
    const status = async () => (await fetch(`${base}/api/twitch/status`, { headers: { Cookie: start.authenticatedCookie } })).json();
    expect(await status()).toMatchObject({ state: 'eventsub_connecting', user: { id: '42', login: 'test_streamer' }, demoMode: false, subscriptionConfirmed: false });
    sockets[0]!.receive(welcome()); await vi.waitFor(async () => expect(await status()).toMatchObject({ state: 'listening', subscriptionConfirmed: true, realChatReceived: false }));
    sockets[0]!.receive(notification()); await vi.waitFor(async () => expect(await status()).toMatchObject({ totalMessages: 1, realChatReceived: true }));
    const text = JSON.stringify(await status());
    for (const secret of [tokens.access_token, tokens.refresh_token, config.clientSecret]) expect(text).not.toContain(secret);
    expect(await (await fetch(`${base}/api/twitch/status`, { headers: { Cookie: start.cookie } })).json()).toMatchObject({ demoMode: true, user: null });
  });
  it('rejects callbacks without a matching state without contacting Twitch', async () => {
    const { cookie } = await begin();
    const response = await fetch(`${base}/auth/twitch/callback?code=test&state=wrong`, { redirect: 'manual', headers: { Cookie: cookie } });
    expect(response.headers.get('location')).toContain('oauth_error=invalid_state'); expect(http).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'missing-code', 'expired-state', 'missing-cookie'])('handles callback %s safely', async mode => {
    const start = await begin();
    if (mode === 'expired-state') for (const session of runtime.store.sessions.values()) session.oauth!.expiresAt = Date.now() - 1;
    const query = new URLSearchParams({ state: start.state }); if (mode === 'cancel') query.set('error', 'access_denied');
    const response = await fetch(`${base}/auth/twitch/callback?${query}`, { redirect: 'manual', headers: mode === 'missing-cookie' ? {} : { Cookie: start.cookie } });
    expect(response.headers.get('location')).toMatch(/oauth_error=(cancelled|missing_code|invalid_state)/); expect(http).not.toHaveBeenCalled();
  });
  it('does not replay a consumed callback', async () => {
    const start = await login();
    const response = await fetch(`${base}/auth/twitch/callback?code=again&state=${start.state}`, { redirect: 'manual', headers: { Cookie: start.cookie } });
    expect(response.headers.get('location')).toContain('invalid_state'); expect(http).toHaveBeenCalledTimes(2);
  });
  it('shows safe login failure without leaking upstream responses', async () => {
    http.mockResolvedValue(json({ message: config.clientSecret }, 400));
    const start = await begin();
    const response = await fetch(`${base}/auth/twitch/callback?code=test&state=${start.state}`, { redirect: 'manual', headers: { Cookie: start.cookie } });
    expect(response.headers.get('location')).toContain('login_failed');
    expect(JSON.stringify(await (await fetch(`${base}/api/twitch/status`, { headers: { Cookie: start.cookie } })).json())).not.toContain(config.clientSecret);
  });
  it('requires same-origin disconnect intent and cleans up sessions and sockets', async () => {
    const start = await login();
    const denied = await fetch(`${base}/api/twitch/disconnect`, { method: 'POST', headers: { Cookie: start.authenticatedCookie, Origin: 'http://attacker.example', 'X-StreamSense-Request': '1' } });
    expect(denied.status).toBe(403); expect(sockets[0]!.closed).toBe(false);
    const response = await fetch(`${base}/api/twitch/disconnect`, { method: 'POST', headers: { Cookie: start.authenticatedCookie, Origin: config.frontendUrl, 'X-StreamSense-Request': '1' } });
    expect(response.status).toBe(200); expect(response.headers.get('set-cookie')).toContain('Expires=Thu, 01 Jan 1970');
    expect(sockets[0]!.closed).toBe(true); expect(runtime.store.sessions.size).toBe(0);
    expect(await (await fetch(`${base}/api/twitch/status`, { headers: { Cookie: start.authenticatedCookie } })).json()).toMatchObject({ state: 'not_connected', demoMode: true, messages: [] });
  });
  it('returns a clear missing-configuration error', async () => {
    const unconfigured = createApp({ configuration: { missing: ['TWITCH_CLIENT_ID'], frontendUrl: config.frontendUrl } });
    const local = unconfigured.app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => local.once('listening', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(local.address() as AddressInfo).port}/auth/twitch`, { redirect: 'manual' });
      expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ missingConfiguration: ['TWITCH_CLIENT_ID'] });
    } finally { unconfigured.close(); await new Promise<void>(resolve => local.close(() => resolve())); }
  });
});

async function demoSession() {
  const response = await fetch(`${base}/api/twitch/status`);
  return { cookie: response.headers.get('set-cookie')!.split(';')[0]!, status: await readStatus(response) };
}
type StatusResponse = { summary: ReturnType<SummaryBatcher['snapshot']>; messages: ProcessingMessage[]; totalMessages: number; demoMode: boolean };
const readStatus = async (response: Response) => await response.json() as StatusResponse;
const summaryControl = (cookie: string, body: unknown, origin = config.frontendUrl) => fetch(`${base}/api/summaries/control`, { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'X-StreamSense-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('summary processing HTTP integration', () => {
  it('processes an explicit demo batch without contacting Twitch', async () => {
    const demo = await demoSession(); expect(demo.status.summary).toMatchObject({ source: 'demo', intervalSeconds: 20, pendingMessages: 0, latest: null });
    const queued = await readStatus(await summaryControl(demo.cookie, { action: 'demo_batch' }));
    expect(queued).toMatchObject({ demoMode: true, totalMessages: 28, realChatReceived: false, summary: { source: 'demo', pendingMessages: 28, activity: { level: 'Busy', count: 28 } } });
    expect(queued.messages.every((message: { source: string }) => message.source === 'demo')).toBe(true);
    const generated = await readStatus(await summaryControl(demo.cookie, { action: 'generate' }));
    expect(generated.summary.latest).toMatchObject({ source: 'demo', metrics: { messages: 28, questions: 12, repeatedMessages: 12, repeatedGroups: 6 } });
    expect(generated.summary.latest!.text).toContain('which game is being played'); expect(http).not.toHaveBeenCalled();
  });
  it('isolates browsers and prevents one demo session from seeing another queue', async () => {
    const first = await demoSession(), second = await demoSession();
    await summaryControl(first.cookie, { action: 'demo_batch' });
    const other = await readStatus(await fetch(`${base}/api/twitch/status`, { headers: { Cookie: second.cookie } }));
    expect(other.summary.pendingMessages).toBe(0); expect(other.messages).toHaveLength(0);
  });
  it('feeds unique EventSub messages into a real processor and never carries over demo history', async () => {
    const demo = await demoSession(); await summaryControl(demo.cookie, { action: 'demo_batch' }); await summaryControl(demo.cookie, { action: 'generate' });
    const authenticated = await login(demo.cookie);
    sockets[0]!.receive(welcome());
    const status = async () => readStatus(await fetch(`${base}/api/twitch/status`, { headers: { Cookie: authenticated.authenticatedCookie } }));
    await vi.waitFor(async () => expect(await status()).toMatchObject({ state: 'listening', summary: { source: 'twitch', pendingMessages: 0, history: [] } }));
    sockets[0]!.receive(notification('event-real', 'chat-real', 'What game is this?'));
    sockets[0]!.receive(notification('event-real', 'chat-real', 'What game is this?'));
    await vi.waitFor(async () => expect(await status()).toMatchObject({ summary: { pendingMessages: 1 }, totalMessages: 1 }));
    const generated = await readStatus(await summaryControl(authenticated.authenticatedCookie, { action: 'generate' }));
    expect(generated.summary.latest).toMatchObject({ source: 'twitch', metrics: { messages: 1, questions: 1 } });
    expect(generated.summary.history).toHaveLength(1);
  });
  it('opens and exits a demo preview without overwriting the Twitch account, socket or real processing', async () => {
    const authenticated = await login();
    const session = [...runtime.store.sessions.values()].find(session => session.account)!;
    const account = session.account, real = session.realSummary;
    sockets[0]!.receive(welcome());
    const get = async () => await (await fetch(`${base}/api/twitch/status`, { headers: { Cookie: authenticated.authenticatedCookie } })).json() as StatusResponse & { state: string; user: { id: string } };
    await vi.waitFor(async () => expect((await get()).state).toBe('listening'));
    sockets[0]!.receive(notification('real-before', 'before-demo', 'What game is this?'));
    await vi.waitFor(async () => expect((await get()).summary.pendingMessages).toBe(1));
    const previousCalls = http.mock.calls.length;
    const response = await summaryControl(authenticated.authenticatedCookie, { action: 'demo_batch' });
    expect(response.headers.get('set-cookie')).toBeNull();
    const preview = await readStatus(response);
    expect(preview).toMatchObject({ demoMode: true, totalMessages: 28, summary: { source: 'demo', pendingMessages: 28 } });
    expect(session.account).toBe(account); expect(session.realSummary).toBe(real); expect(sockets[0]!.closed).toBe(false);
    expect(http).toHaveBeenCalledTimes(previousCalls); expect(session.chat!.totalMessages).toBe(1); expect(real!.snapshot().pendingMessages).toBe(1);
    const demoGenerated = await readStatus(await summaryControl(authenticated.authenticatedCookie, { action: 'generate' }));
    expect(demoGenerated.summary.latest!.source).toBe('demo'); expect(real!.snapshot().history).toHaveLength(0);
    sockets[0]!.receive(notification('real-during', 'during-demo', 'Can you show the map?'));
    await vi.waitFor(() => expect(real!.snapshot().pendingMessages).toBe(2));
    const restored = await readStatus(await summaryControl(authenticated.authenticatedCookie, { action: 'show_twitch' }));
    expect(restored).toMatchObject({ demoMode: false, totalMessages: 2, summary: { source: 'twitch', pendingMessages: 2, history: [] } });
    expect(restored.messages.every(message => message.source === 'twitch')).toBe(true);
    const actual = await readStatus(await summaryControl(authenticated.authenticatedCookie, { action: 'generate' }));
    expect(actual.summary.latest!.metrics.messages).toBe(2); expect(actual.summary.latest!.source).toBe('twitch');
    expect(session.demoSummary!.snapshot().latest!.metrics.messages).toBe(28);
    expect(session.account).toBe(account); expect(sockets[0]!.closed).toBe(false); expect(http).toHaveBeenCalledTimes(previousCalls);
  });
  it('handles pause, resume, interval changes and separate queue/history clearing', async () => {
    const demo = await demoSession();
    expect((await readStatus(await summaryControl(demo.cookie, { action: 'pause' }))).summary).toMatchObject({ paused: true, nextBatchAt: null });
    await summaryControl(demo.cookie, { action: 'demo_batch' });
    const generated = await readStatus(await summaryControl(demo.cookie, { action: 'generate' }));
    expect(generated.summary).toMatchObject({ paused: true, pendingMessages: 0 }); expect(generated.summary.history).toHaveLength(1);
    await summaryControl(demo.cookie, { action: 'demo_batch' });
    const cleared = await readStatus(await summaryControl(demo.cookie, { action: 'clear_pending' }));
    expect(cleared.summary.pendingMessages).toBe(0); expect(cleared.summary.history).toHaveLength(1); expect(cleared.messages).toHaveLength(56);
    expect((await readStatus(await summaryControl(demo.cookie, { action: 'clear_history' }))).summary.latest).toBeNull();
    expect((await readStatus(await summaryControl(demo.cookie, { action: 'interval', seconds: 5 }))).summary.intervalSeconds).toBe(5);
    expect((await readStatus(await summaryControl(demo.cookie, { action: 'resume' }))).summary.paused).toBe(false);
  });
  it('rejects invalid actions, invalid intervals, missing sessions and cross-origin mutations', async () => {
    const demo = await demoSession();
    for (const body of [null, {}, { action: 'unknown' }, { action: 'interval', seconds: 0 }, { action: 'interval', seconds: '20' }]) expect((await summaryControl(demo.cookie, body)).status).toBe(400);
    expect((await summaryControl('', { action: 'generate' })).status).toBe(401);
    expect((await summaryControl(demo.cookie, { action: 'show_twitch' })).status).toBe(409);
    expect((await summaryControl(demo.cookie, { action: 'generate' }, 'http://attacker.example')).status).toBe(403);
    const invalidJson = await fetch(`${base}/api/summaries/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' }); expect(invalidJson.status).toBe(400);
  });
  it('disposes pending real processors on disconnect', async () => {
    const authenticated = await login(); const session = [...runtime.store.sessions.values()].find(session => session.account)!;
    const processing = session.realSummary!;
    const response = await fetch(`${base}/api/twitch/disconnect`, { method: 'POST', headers: { Cookie: authenticated.authenticatedCookie, Origin: config.frontendUrl, 'X-StreamSense-Request': '1' } });
    expect(response.status).toBe(200); expect(processing.snapshot()).toMatchObject({ nextBatchAt: null, pendingMessages: 0, latest: null });
    const fresh = await demoSession(); expect(fresh.status.summary).toMatchObject({ source: 'demo', history: [] });
  });
  it('expires anonymous demo sessions and clears their resources', async () => {
    const demo = await demoSession(); await summaryControl(demo.cookie, { action: 'demo_batch' });
    const session = [...runtime.store.sessions.values()][0]!; const processing = session.demoSummary!; session.expiresAt = Date.now() - 1;
    const response = await fetch(`${base}/api/twitch/status`, { headers: { Cookie: demo.cookie } });
    expect((await readStatus(response)).summary.pendingMessages).toBe(0); expect(processing.snapshot().nextBatchAt).toBeNull(); expect(processing.snapshot().pendingMessages).toBe(0);
  });
});
