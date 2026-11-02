// Thin Cloudflare Worker proxy. All Twitch/session/summary processing stays in Node.
// No API keys or Twitch credentials belong in this Worker.
export interface ProxyEnvironment { BACKEND_ORIGIN: string }
export default {
  async fetch(request: Request, env: ProxyEnvironment): Promise<Response> {
    let backend: URL;
    try {
      backend = new URL(env.BACKEND_ORIGIN);
      if (backend.protocol !== 'https:' || !backend.hostname.endsWith('.onrender.com') || backend.hostname.startsWith('replace-') || backend.port || backend.username || backend.password || backend.pathname !== '/' || backend.search || backend.hash) throw new Error();
    } catch { return Response.json({ error: 'The hosting backend is not configured.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
    const target = new URL(request.url);
    target.protocol = backend.protocol; target.host = backend.host;
    const headers = new Headers(request.headers);
    // Use the real backend Host; never trust client-supplied routing headers.
    for (const name of ['host', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded']) headers.delete(name);
    const outgoing = new Request(target, { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body, redirect: 'manual', ...(request.body ? { duplex: 'half' } : {}) });
    try {
      // Never follow OAuth redirects here or forward the session cookie to Twitch.
      const response = await fetch(outgoing);
      const privateHeaders = new Headers(response.headers);
      privateHeaders.set('Cache-Control', 'no-store');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: privateHeaders });
    } catch { return Response.json({ error: 'StreamSense backend is temporarily unavailable. Please try again shortly.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
  },
};
