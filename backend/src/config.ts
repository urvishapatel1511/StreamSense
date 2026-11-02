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
}

export function loadConfiguration(env: NodeJS.ProcessEnv = process.env): Configuration {
  const names = ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'TWITCH_REDIRECT_URI', 'FRONTEND_URL'] as const;
  const missing = names.filter(name => !env[name]?.trim() || /^(replace_|your_)/i.test(env[name]!.trim()));
  const fallback = 'http://localhost:5173';
  if (missing.length) return { missing, frontendUrl: fallback };
  try {
    const callback = new URL(env.TWITCH_REDIRECT_URI!);
    const frontend = new URL(env.FRONTEND_URL!);
    // This server is deliberately local-only; do not silently accept a deployment configuration.
    for (const url of [callback, frontend]) {
      if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error();
    }
    if (callback.pathname !== '/auth/twitch/callback' || !['', '/'].includes(frontend.pathname) || callback.hostname !== frontend.hostname || Number(callback.port || (callback.protocol === 'https:' ? 443 : 80)) !== Number(env.PORT || 3001)) throw new Error();
    return { missing: [], frontendUrl: frontend.origin, twitch: {
      clientId: env.TWITCH_CLIENT_ID!.trim(), clientSecret: env.TWITCH_CLIENT_SECRET!.trim(),
      redirectUri: callback.href, frontendUrl: frontend.origin,
    } };
  } catch {
    return { missing: ['Valid matching local TWITCH_REDIRECT_URI, FRONTEND_URL and PORT'], frontendUrl: fallback };
  }
}
