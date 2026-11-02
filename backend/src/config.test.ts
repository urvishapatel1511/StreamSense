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
