import { describe, expect, it } from 'vitest';
import { loadConfiguration } from './config.js';

const env = { PORT: '3001', TWITCH_CLIENT_ID: 'test-client', TWITCH_CLIENT_SECRET: 'test-secret', TWITCH_REDIRECT_URI: 'http://localhost:3001/auth/twitch/callback', FRONTEND_URL: 'http://localhost:5173' };
describe('local configuration', () => {
  it('recognizes the documented localhost URLs', () => {
    expect(loadConfiguration(env)).toMatchObject({ missing: [], frontendUrl: env.FRONTEND_URL, twitch: { redirectUri: env.TWITCH_REDIRECT_URI } });
  });
  it('reports missing and placeholder credentials without revealing values', () => {
    const result = loadConfiguration({ ...env, TWITCH_CLIENT_ID: 'replace_with_client_id', TWITCH_CLIENT_SECRET: '' });
    expect(result.twitch).toBeUndefined(); expect(result.missing).toEqual(['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']);
  });
  it.each([
    { FRONTEND_URL: 'http://attacker.example' }, { TWITCH_REDIRECT_URI: 'http://localhost:3001/wrong' },
    { FRONTEND_URL: 'http://127.0.0.1:5173' }, { PORT: '4000' }, { FRONTEND_URL: 'http://localhost:5173/?redirect=bad' },
  ])('rejects inconsistent or non-local URLs', override => {
    expect(loadConfiguration({ ...env, ...override }).twitch).toBeUndefined();
  });
});

describe('single-origin HTTPS deployment configuration', () => {
  const hosted = { NODE_ENV: 'production', PORT: '10000', RENDER_EXTERNAL_URL: 'https://streamsense-test.onrender.com', TWITCH_CLIENT_ID: 'test-client', TWITCH_CLIENT_SECRET: 'test-secret' };
  it('derives the public origin/callback independently of the internal service port', () => {
    expect(loadConfiguration(hosted)).toEqual({ production: true, missing: [], frontendUrl: hosted.RENDER_EXTERNAL_URL, twitch: { clientId: 'test-client', clientSecret: 'test-secret', frontendUrl: hosted.RENDER_EXTERNAL_URL, redirectUri: `${hosted.RENDER_EXTERNAL_URL}/auth/twitch/callback` } });
  });
  it('supports an explicitly configured HTTPS custom domain', () => {
    expect(loadConfiguration({ ...hosted, FRONTEND_URL: 'https://chat.example.com/', TWITCH_REDIRECT_URI: 'https://chat.example.com/auth/twitch/callback' }).frontendUrl).toBe('https://chat.example.com');
  });
  it('supports a Cloudflare public origin while retaining only the actual Render backend hostname for proxy routing', () => {
    expect(loadConfiguration({ ...hosted, FRONTEND_URL: 'https://streamsense.example.workers.dev' })).toMatchObject({ frontendUrl: 'https://streamsense.example.workers.dev', proxyHostname: 'streamsense-test.onrender.com', twitch: { redirectUri: 'https://streamsense.example.workers.dev/auth/twitch/callback' } });
  });
  it('allows credential-free public Demo Mode without falling back to localhost', () => {
    expect(loadConfiguration({ ...hosted, TWITCH_CLIENT_ID: '', TWITCH_CLIENT_SECRET: '' })).toEqual({ production: true, missing: ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'], frontendUrl: hosted.RENDER_EXTERNAL_URL });
  });
  it.each([
    { RENDER_EXTERNAL_URL: '' }, { FRONTEND_URL: 'http://chat.example.com' }, { FRONTEND_URL: 'https://localhost' },
    { FRONTEND_URL: 'https://127.0.0.1' }, { FRONTEND_URL: 'https://[::1]' }, { FRONTEND_URL: 'https://user:password@chat.example.com' },
    { FRONTEND_URL: 'https://chat.example.com/path' }, { FRONTEND_URL: 'https://chat.example.com/?x=1' }, { FRONTEND_URL: 'https://chat.example.com/#fragment' },
    { TWITCH_REDIRECT_URI: 'https://other.example.com/auth/twitch/callback' }, { TWITCH_REDIRECT_URI: 'http://streamsense-test.onrender.com/auth/twitch/callback' },
    { TWITCH_REDIRECT_URI: 'https://streamsense-test.onrender.com/wrong' }, { TWITCH_REDIRECT_URI: 'https://streamsense-test.onrender.com:8443/auth/twitch/callback' },
  ])('fails closed for unsafe or mismatched production URLs', override => {
    expect(() => loadConfiguration({ ...hosted, ...override })).toThrow('Production requires');
  });
});
