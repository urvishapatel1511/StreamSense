import express from 'express';
import { loadConfiguration, type Configuration } from './config.js';
import { TwitchApi, CHAT_SCOPE, TwitchError, type Fetcher } from './twitch-api.js';
import { EventSubClient, type SocketFactory } from './eventsub.js';
import { consumeState, generateState, SessionStore, STATE_TTL } from './sessions.js';
import type { Session } from './sessions.js';
import { loadProcessingSettings, type ProcessingSettings } from './processing.js';
import { SummaryBatcher } from './batcher.js';
import { demoBatch } from './demo.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function createApp(options: { configuration?: Configuration; http?: Fetcher; sockets?: SocketFactory; processing?: ProcessingSettings; frontendDirectory?: string } = {}) {
  const configuration = options.configuration ?? loadConfiguration();
  const config = configuration.twitch;
  const processingSettings = options.processing ?? loadProcessingSettings();
  const frontendDirectory = configuration.production ? options.frontendDirectory ?? fileURLToPath(new URL('../../frontend/dist/', import.meta.url)) : undefined;
  if (frontendDirectory !== undefined && !existsSync(join(frontendDirectory, 'index.html'))) throw new Error('Frontend production files are missing. Run npm run build before starting the service.');
  const store = new SessionStore(new URL(configuration.frontendUrl).protocol === 'https:');
  const app = express();
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (configuration.production) {
      response.setHeader('Strict-Transport-Security', 'max-age=15552000');
      response.setHeader('X-Frame-Options', 'DENY');
      response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    }
    next();
  });
  app.use(express.json({ limit: '2kb' }));
  const isDemoView = (session: Session) => !session.account || session.view === 'demo';
  function processor(session: Session) {
    if (!isDemoView(session)) return session.realSummary ??= new SummaryBatcher('twitch', processingSettings);
    return session.demoSummary ??= new SummaryBatcher('demo', processingSettings);
  }
  function status(session: Session) {
    const live = Boolean(session.account);
    const demo = isDemoView(session);
    return {
      configured: Boolean(config), missingConfiguration: configuration.missing,
      state: session.error ? 'error' : session.chat?.state ?? (session.oauth ? 'connecting' : session.account ? 'authenticated' : 'not_connected'),
      user: session.account?.user ?? null, error: session.error ?? session.chat?.error ?? null,
      demoMode: demo, subscriptionConfirmed: session.chat?.state === 'listening', realChatReceived: live && Boolean(session.chat?.totalMessages),
      messages: !demo ? session.chat?.messages ?? [] : session.demoMessages ?? [], totalMessages: !demo ? session.chat?.totalMessages ?? 0 : session.demoTotal ?? 0,
      summary: processor(session).snapshot(),
    };
  }

  app.get(['/api/health', '/health'], (request, response) => {
    const session = store.read(request);
    response.json({ status: 'ok', service: 'streamsense-backend', twitchConnected: session?.chat?.state === 'listening', demoMode: session ? isDemoView(session) : true });
  });

  app.get('/api/twitch/status', (request, response) => {
    const session = store.read(request) ?? store.create(response);
    response.json(status(session));
  });

  app.post('/api/summaries/control', async (request, response) => {
    if (request.get('Origin') !== configuration.frontendUrl || request.get('X-StreamSense-Request') !== '1') { response.status(403).json({ error: 'Use the configured StreamSense frontend address for summary controls.' }); return; }
    const session = store.read(request);
    if (!session) { response.status(401).json({ error: 'The local session expired. Reload the dashboard.' }); return; }
    const body: unknown = request.body;
    if (typeof body !== 'object' || body === null || !('action' in body) || typeof body.action !== 'string') { response.status(400).json({ error: 'A valid summary action is required.' }); return; }
    if (body.action === 'demo_batch') session.view = 'demo';
    if (body.action === 'show_twitch') {
      if (!session.account) { response.status(409).json({ error: 'Connect Twitch before returning to Twitch chat.' }); return; }
      session.view = 'twitch';
    }
    const summary = processor(session);
    switch (body.action) {
      case 'show_twitch': break;
      case 'pause': summary.pause(); break;
      case 'resume': summary.resume(); break;
      case 'generate':
        if (summary.snapshot().processing) { response.status(409).json({ error: 'A summary batch is already processing.' }); return; }
        await summary.generate(); break;
      case 'clear_pending': summary.clearPending(); break;
      case 'clear_history': summary.clearHistory(); break;
      case 'interval': {
        const seconds = 'seconds' in body ? body.seconds : undefined;
        if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 5 || seconds > 300) { response.status(400).json({ error: 'Choose an interval from 5 to 300 whole seconds.' }); return; }
        summary.setInterval(seconds); break;
      }
      case 'demo_batch': {
        const batch = demoBatch(session.demoTotal ?? 0);
        session.demoMessages = [...(session.demoMessages ?? []), ...batch].slice(-100);
        session.demoTotal = (session.demoTotal ?? 0) + batch.length;
        for (const message of batch) summary.ingest(message);
        break;
      }
      default: response.status(400).json({ error: 'Unknown summary action.' }); return;
    }
    if (!store.sessions.has(session.id)) { response.status(401).json({ error: 'The local session ended while processing.' }); return; }
    response.json(status(session));
  });

  app.get('/auth/twitch', (request, response) => {
    if (!config) { response.status(503).json({ error: 'Twitch configuration is missing or invalid. Add the required values to the root .env and restart the backend.', missingConfiguration: configuration.missing }); return; }
    if (request.hostname !== new URL(config.redirectUri).hostname && !(configuration.production && request.hostname === configuration.proxyHostname)) {
      response.redirect(new URL('/auth/twitch', config.redirectUri).href); return;
    }
    const old = store.read(request);
    if (old) store.remove(old);
    const session = store.create(response);
    const state = generateState();
    session.oauth = { value: state, expiresAt: Date.now() + STATE_TTL };
    const url = new URL('https://id.twitch.tv/oauth2/authorize');
    url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: CHAT_SCOPE, state }).toString();
    response.redirect(url.href);
  });

  app.get('/auth/twitch/callback', async (request, response) => {
    const failure = (code: string) => response.redirect(`${configuration.frontendUrl}/?oauth_error=${code}`);
    if (!config) { failure('configuration'); return; }
    const session = store.read(request);
    if (!consumeState(session, request.query.state)) { failure('invalid_state'); return; }
    if (typeof request.query.error === 'string') { session!.error = 'Twitch authorization was cancelled or denied.'; failure('cancelled'); return; }
    if (typeof request.query.code !== 'string' || !request.query.code || request.query.code.length > 4096) { session!.error = 'The Twitch callback did not include a valid authorization code.'; failure('missing_code'); return; }
    const account = new TwitchApi(config, options.http);
    try {
      const user = await account.login(request.query.code);
      if (!store.sessions.has(session!.id)) { account.dispose(); failure('session_expired'); return; }
      for (const existing of store.sessions.values()) if (existing.account?.user?.id === user.id) store.remove(existing);
      const authenticated = store.create(response);
      store.remove(session!);
      authenticated.account = account;
      authenticated.realSummary = new SummaryBatcher('twitch', processingSettings);
      authenticated.chat = new EventSubClient(user.id, sessionId => account.subscribe(sessionId), options.sockets, () => {
        authenticated.error = 'Twitch authorization was revoked or rejected. Please connect again.';
        authenticated.chat?.clearMessages(); account.dispose(); authenticated.account = undefined;
        authenticated.realSummary?.dispose(); authenticated.realSummary = undefined;
      }, message => { authenticated.realSummary?.ingest(message); });
      authenticated.chat.start();
      response.redirect(`${config.frontendUrl}/`);
    } catch (error) {
      account.dispose();
      if (store.sessions.has(session!.id)) session!.error = error instanceof TwitchError ? error.message : 'Twitch login failed. Please try again.';
      failure('login_failed');
    }
  });

  app.post('/api/twitch/disconnect', (request, response) => {
    if (request.get('Origin') !== configuration.frontendUrl || request.get('X-StreamSense-Request') !== '1') {
      response.status(403).json({ error: 'Disconnect must be requested from the StreamSense dashboard.' }); return;
    }
    const session = store.read(request);
    if (session) store.remove(session);
    store.clearCookie(response);
    response.json({ disconnected: true });
  });

  if (frontendDirectory !== undefined) {
    const serveFrontend = express.static(frontendDirectory, { dotfiles: 'ignore', cacheControl: false });
    app.use((request, response, next) => {
      if (/^\/(api|auth)(\/|$)/.test(request.path)) { next(); return; }
      serveFrontend(request, response, next);
    });
  }
  app.use((_request, response) => { response.status(404).json({ error: 'Not found' }); });
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const status = typeof error === 'object' && error !== null && 'status' in error && (error.status === 400 || error.status === 413) ? error.status : 500;
    response.status(status).json({ error: status === 500 ? 'StreamSense could not complete the request. Please try again.' : 'The request must contain a small, valid JSON body.' });
  });
  return { app, store, close: () => store.close() };
}
