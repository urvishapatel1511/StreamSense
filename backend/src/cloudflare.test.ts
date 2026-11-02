import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './cloudflare.js';
const env = { BACKEND_ORIGIN: 'https://streamsense-fixture.onrender.com' };
afterEach(() => { vi.unstubAllGlobals(); });
describe('Cloudflare free Worker reverse proxy', () => {
  it('preserves callback path/query, cookies and public Origin without following OAuth redirects', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'https://id.twitch.tv/oauth2/authorize', 'Set-Cookie': 'fixture=session; HttpOnly; Secure; SameSite=Lax' } }));
    vi.stubGlobal('fetch', upstream);
    const response = await worker.fetch(new Request('https://streamsense.example.workers.dev/auth/twitch/callback?code=fixture&state=fixture', { headers: { Cookie: 'fixture=old-session', Origin: 'https://streamsense.example.workers.dev', 'X-Forwarded-Host': 'attacker.example' } }), env);
    const request = upstream.mock.calls[0]![0] as Request;
    expect(request.url).toBe(`${env.BACKEND_ORIGIN}/auth/twitch/callback?code=fixture&state=fixture`); expect(request.redirect).toBe('manual');
    expect(request.headers.get('Cookie')).toBe('fixture=old-session'); expect(request.headers.get('Origin')).toBe('https://streamsense.example.workers.dev');
    expect(request.headers.has('X-Forwarded-Host')).toBe(false); expect(request.headers.has('Host')).toBe(false);
    expect(response.status).toBe(302); expect(response.headers.get('Location')).toBe('https://id.twitch.tv/oauth2/authorize'); expect(response.headers.get('Set-Cookie')).toContain('HttpOnly'); expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(upstream).toHaveBeenCalledOnce();
  });
  it('streams POST controls to the backend with their original method/body and intent header', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true })); vi.stubGlobal('fetch', upstream);
    await worker.fetch(new Request('https://streamsense.example.workers.dev/api/summaries/control', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-StreamSense-Request': '1' }, body: '{"action":"demo_batch"}' }), env);
    const request = upstream.mock.calls[0]![0] as Request;
    expect(request.method).toBe('POST'); expect(await request.json()).toEqual({ action: 'demo_batch' }); expect(request.headers.get('X-StreamSense-Request')).toBe('1');
  });
  it.each(['', 'http://streamsense-fixture.onrender.com', 'https://attacker.example', 'https://streamsense-fixture.onrender.com.evil.example', 'https://replace-with-your-service.onrender.com', 'https://user:secret@streamsense-fixture.onrender.com', 'https://streamsense-fixture.onrender.com/path', 'https://streamsense-fixture.onrender.com/?x=1'])('rejects an invalid upstream configuration without a request', async backend => {
    const upstream = vi.fn(); vi.stubGlobal('fetch', upstream);
    expect((await worker.fetch(new Request('https://streamsense.example.workers.dev'), { BACKEND_ORIGIN: backend })).status).toBe(503); expect(upstream).not.toHaveBeenCalled();
  });
  it('preserves genuine backend errors and handles connection failures without exposing details', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'Not found' }, { status: 404 })); vi.stubGlobal('fetch', upstream);
    expect((await worker.fetch(new Request('https://streamsense.example.workers.dev/api/missing'), env)).status).toBe(404);
    upstream.mockRejectedValue(new Error('private upstream detail')); const response = await worker.fetch(new Request('https://streamsense.example.workers.dev'), env);
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('private upstream detail');
  });
});
