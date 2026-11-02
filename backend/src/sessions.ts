import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { TwitchApi } from './twitch-api.js';
import type { EventSubClient } from './eventsub.js';
import type { SummaryBatcher } from './batcher.js';
import type { ProcessingMessage } from './processing.js';

export const COOKIE_NAME = 'streamsense_session';
export const SESSION_TTL = 8 * 60 * 60 * 1000;
export const STATE_TTL = 10 * 60 * 1000;
export interface Session {
  id: string; expiresAt: number; oauth?: { value: string; expiresAt: number };
  account?: TwitchApi; chat?: EventSubClient; error?: string; checking?: boolean;
  demoSummary?: SummaryBatcher; realSummary?: SummaryBatcher;
  demoMessages?: ProcessingMessage[]; demoTotal?: number;
  view?: 'demo' | 'twitch';
}

export function generateState(): string { return randomBytes(32).toString('hex'); }
export function consumeState(session: Session | undefined, received: unknown): boolean {
  const saved = session?.oauth;
  if (session) session.oauth = undefined;
  if (!saved || saved.expiresAt <= Date.now() || typeof received !== 'string' || !/^[a-f0-9]{64}$/.test(received)) return false;
  return timingSafeEqual(Buffer.from(saved.value, 'hex'), Buffer.from(received, 'hex'));
}

export class SessionStore {
  readonly sessions = new Map<string, Session>();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly secure: boolean) {
    this.timer = setInterval(() => this.maintain(), 60_000);
    this.timer.unref?.();
  }
  read(request: Request): Session | undefined {
    const part = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE_NAME}=`));
    const id = part?.slice(COOKIE_NAME.length + 1);
    if (!id || !/^[a-f0-9]{64}$/.test(id)) return;
    const session = this.sessions.get(id);
    if (session && session.expiresAt <= Date.now()) { this.remove(session); return; }
    return session;
  }
  create(response: Response): Session {
    // Bound this local development store; expire old entries before rejecting a full store.
    this.maintain();
    if (this.sessions.size >= 50) throw new Error('Session capacity reached. Restart the local server.');
    const session = { id: generateState(), expiresAt: Date.now() + SESSION_TTL };
    this.sessions.set(session.id, session);
    response.cookie(COOKIE_NAME, session.id, { httpOnly: true, secure: this.secure, sameSite: 'lax', path: '/', maxAge: SESSION_TTL });
    return session;
  }
  clearCookie(response: Response) { response.clearCookie(COOKIE_NAME, { httpOnly: true, secure: this.secure, sameSite: 'lax', path: '/' }); }
  remove(session: Session) {
    this.sessions.delete(session.id); session.oauth = undefined;
    session.chat?.stop(); session.chat?.clearMessages(); session.account?.dispose();
    session.demoSummary?.dispose(); session.realSummary?.dispose(); session.demoMessages = [];
    session.chat = undefined; session.account = undefined;
  }
  maintain() {
    for (const session of this.sessions.values()) {
      if (session.expiresAt <= Date.now()) { this.remove(session); continue; }
      if (session.oauth && session.oauth.expiresAt <= Date.now()) session.oauth = undefined;
      if (session.account && !session.checking) {
        session.checking = true;
        void session.account.maintain().catch(() => {
          if (!this.sessions.has(session.id)) return;
          session.chat?.stop(); session.chat?.clearMessages(); session.account?.dispose();
          session.realSummary?.dispose(); session.realSummary = undefined;
          session.chat = undefined; session.account = undefined;
          session.error = 'Twitch authorization could not be renewed or validated. Please connect again.';
        }).finally(() => { session.checking = false; });
      }
    }
  }
  close() { clearInterval(this.timer); for (const session of this.sessions.values()) this.remove(session); }
}
