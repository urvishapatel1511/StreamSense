import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { request, type Server, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createApp } from './app.js';
import { loadConfiguration } from './config.js';
import { FakeSocket, json, subscription, tokens, validation, welcome } from './testing.js';

let runtime: ReturnType<typeof createApp>;
let server: Server;
let directory: string;
let base: string;
const origin = 'https://streamsense-test.onrender.com';
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'streamsense-deployment-'));
  await mkdir(join(directory, 'assets'));
  await writeFile(join(directory, 'index.html'), '<!doctype html><title>StreamSense production fixture</title>');
  await writeFile(join(directory, 'assets', 'app.js'), '/* static asset fixture */');
  runtime = createApp({ configuration: loadConfiguration({ NODE_ENV: 'production', RENDER_EXTERNAL_URL: origin }), frontendDirectory: directory });
  await new Promise<void>((resolve, reject) => { server = runtime.app.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  runtime?.close();
  if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  // Remove only the unique test directory created under the verified OS temp root.
  expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true);
  expect(directory).toContain('streamsense-deployment-');
  await rm(directory, { recursive: true, force: true });
});

describe('hosted single-domain HTTP routes', () => {
  it('serves frontend HTML and assets alongside API health', async () => {
    const page = await fetch(base); expect(page.status).toBe(200); expect(page.headers.get('content-type')).toContain('text/html'); expect(await page.text()).toContain('StreamSense production fixture');
    const asset = await fetch(`${base}/assets/app.js`); expect(asset.status).toBe(200); expect(await asset.text()).toContain('static asset fixture');
    expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({ status: 'ok', service: 'streamsense-backend' });
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(page.headers.get('strict-transport-security')).toContain('max-age='); expect(page.headers.get('cache-control')).toBe('no-store');
  });
  it.each(['/.env', '/package.json', '/api/missing', '/auth/missing', '/assets/missing.js'])('does not serve private files or fake successful HTML for %s', async path => {
    const response = await fetch(base + path); expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: 'Not found' });
  });
  it('uses Secure HttpOnly cookies in public Demo Mode and enforces the public Origin', async () => {
    const initial = await fetch(`${base}/api/twitch/status`);
    const cookie = initial.headers.get('set-cookie')!; expect(cookie).toContain('Secure'); expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Lax');
    expect(await initial.json()).toMatchObject({ configured: false, demoMode: true });
    const control = (requestOrigin: string) => fetch(`${base}/api/summaries/control`, { method: 'POST', headers: { Cookie: cookie.split(';')[0]!, Origin: requestOrigin, 'X-StreamSense-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'demo_batch' }) });
    expect((await control('http://localhost:5173')).status).toBe(403);
    const loaded = await control(origin); expect(loaded.status).toBe(200); expect(await loaded.json()).toMatchObject({ demoMode: true, totalMessages: 28, summary: { pendingMessages: 28 } });
  });
  it('does not trust spoofed forwarded hosts when choosing OAuth redirects', async () => {
    runtime.close(); await new Promise<void>(resolve => server.close(() => resolve()));
    runtime = createApp({ configuration: loadConfiguration({ NODE_ENV: 'production', RENDER_EXTERNAL_URL: origin, TWITCH_CLIENT_ID: 'test-client', TWITCH_CLIENT_SECRET: 'test-secret' }), frontendDirectory: directory });
    await new Promise<void>((resolve, reject) => { server = runtime.app.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const response = await fetch(`${base}/auth/twitch`, { redirect: 'manual', headers: { 'X-Forwarded-Host': 'attacker.example', 'X-Forwarded-Proto': 'https' } });
    expect(response.headers.get('location')).toBe(`${origin}/auth/twitch`);
  });
  it('fails startup if the frontend production build is missing', () => {
    expect(() => createApp({ configuration: loadConfiguration({ NODE_ENV: 'production', RENDER_EXTERNAL_URL: origin }), frontendDirectory: join(directory, 'missing') })).toThrow('Frontend production files are missing');
  });
  it('completes mocked OAuth using the configured public Host and HTTPS callback behind a proxy', async () => {
    runtime.close(); await new Promise<void>(resolve => server.close(() => resolve()));
    const socket = new FakeSocket();
    const http = vi.fn<typeof fetch>().mockImplementation(async input => String(input).endsWith('/token') ? json(tokens) : String(input).endsWith('/validate') ? json(validation) : json(subscription(), 202));
    const publicSite = 'https://streamsense.example.workers.dev';
    runtime = createApp({ configuration: loadConfiguration({ NODE_ENV: 'production', RENDER_EXTERNAL_URL: origin, FRONTEND_URL: publicSite, TWITCH_CLIENT_ID: 'test-client', TWITCH_CLIENT_SECRET: 'test-secret' }), frontendDirectory: directory, http, sockets: () => socket.asSocket() });
    await new Promise<void>((resolve, reject) => { server = runtime.app.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // Native HTTP lets the test reproduce the Host forwarded by the TLS edge.
    const hosted = (path: string, cookie?: string) => new Promise<{ status: number; headers: IncomingHttpHeaders; text: string }>((resolve, reject) => {
      const outgoing = request(base + path, { headers: { Host: new URL(origin).host, ...(cookie ? { Cookie: cookie } : {}) } }, incoming => {
        let text = ''; incoming.setEncoding('utf8'); incoming.on('data', chunk => { text += chunk; });
        incoming.on('end', () => resolve({ status: incoming.statusCode!, headers: incoming.headers, text }));
      }); outgoing.on('error', reject); outgoing.end();
    });
    const begin = await hosted('/auth/twitch'); expect(begin.status).toBe(302);
    const authorize = new URL(begin.headers.location!); expect(authorize.origin).toBe('https://id.twitch.tv');
    expect(authorize.searchParams.get('redirect_uri')).toBe(`${publicSite}/auth/twitch/callback`);
    const originalCookie = begin.headers['set-cookie']![0]!.split(';')[0]!;
    const callback = await hosted(`/auth/twitch/callback?code=synthetic-code&state=${authorize.searchParams.get('state')}`, originalCookie);
    expect(callback.headers.location).toBe(`${publicSite}/`); expect(callback.headers['set-cookie']![0]).toContain('Secure');
    const cookie = callback.headers['set-cookie']![0]!.split(';')[0]!; expect(cookie).not.toBe(originalCookie);
    socket.receive(welcome());
    await vi.waitFor(async () => expect(JSON.parse((await hosted('/api/twitch/status', cookie)).text)).toMatchObject({ state: 'listening', user: { id: '42' }, demoMode: false }));
    expect(http).toHaveBeenCalledTimes(3);
  });
});
