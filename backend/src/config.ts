export interface TwitchConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  frontendUrl: string;
}

export interface Configuration {
  twitch?: TwitchConfig;
  missing: string[];
  frontendUrl: string;
  production?: boolean;
  proxyHostname?: string;
}

export function loadConfiguration(env: NodeJS.ProcessEnv = process.env): Configuration {
  const production = env.NODE_ENV === 'production';
  const fallback = 'http://localhost:5173';
  const frontendInput = env.FRONTEND_URL?.trim() || (production ? env.RENDER_EXTERNAL_URL?.trim() : '') || (production ? '' : fallback);
  try {
    const frontend = new URL(frontendInput);
    const callbackInput = env.TWITCH_REDIRECT_URI?.trim() || (production ? new URL('/auth/twitch/callback', frontend.origin).href : '');
    const callback = new URL(callbackInput || 'http://localhost:3001/auth/twitch/callback');
    const backend = production && env.RENDER_EXTERNAL_URL?.trim() ? new URL(env.RENDER_EXTERNAL_URL.trim()) : undefined;
    if (backend && (backend.protocol !== 'https:' || backend.username || backend.password || backend.search || backend.hash || backend.pathname !== '/')) throw new Error();
    const deployment = production ? { production: true, ...(backend && backend.origin !== frontend.origin ? { proxyHostname: backend.hostname } : {}) } : {};
    for (const url of [callback, frontend]) {
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (url.username || url.password || url.search || url.hash || (production ? url.protocol !== 'https:' || local : !['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error();
    }
    if (callback.pathname !== '/auth/twitch/callback' || !['', '/'].includes(frontend.pathname) || (production ? callback.origin !== frontend.origin : callback.hostname !== frontend.hostname || Number(callback.port || (callback.protocol === 'https:' ? 443 : 80)) !== Number(env.PORT || 3001))) throw new Error();
    const names = production ? ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'] as const : ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'TWITCH_REDIRECT_URI', 'FRONTEND_URL'] as const;
    const missing = names.filter(name => !env[name]?.trim() || /^(replace_|your_)/i.test(env[name]!.trim()));
    if (missing.length) return { missing, frontendUrl: frontend.origin, ...deployment };
    return { missing: [], frontendUrl: frontend.origin, ...deployment, twitch: {
      clientId: env.TWITCH_CLIENT_ID!.trim(), clientSecret: env.TWITCH_CLIENT_SECRET!.trim(),
      redirectUri: callback.href, frontendUrl: frontend.origin,
    } };
  } catch {
    if (production) throw new Error('Production requires FRONTEND_URL (or RENDER_EXTERNAL_URL) to be a public HTTPS origin and TWITCH_REDIRECT_URI, if set, to be its /auth/twitch/callback URL.');
    return { missing: ['Valid matching local TWITCH_REDIRECT_URI, FRONTEND_URL and PORT'], frontendUrl: fallback };
  }
}
