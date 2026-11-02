import { describe, expect, it } from 'vitest';
import { consumeState, generateState, type Session } from './sessions.js';

function pending(): Session { return { id: generateState(), expiresAt: Date.now() + 10000, oauth: { value: generateState(), expiresAt: Date.now() + 1000 } }; }
describe('OAuth state', () => {
  it('uses unpredictable 32-byte values', () => {
    const first = generateState(); expect(first).toMatch(/^[a-f0-9]{64}$/); expect(generateState()).not.toBe(first);
  });
  it('accepts the correct state only once', () => {
    const session = pending(); const value = session.oauth!.value;
    expect(consumeState(session, value)).toBe(true); expect(consumeState(session, value)).toBe(false);
  });
  it('rejects missing, malformed, expired, and another session state', () => {
    expect(consumeState(undefined, generateState())).toBe(false);
    expect(consumeState(pending(), ['bad', 'state'])).toBe(false);
    expect(consumeState(pending(), generateState())).toBe(false);
    const expired = pending(); const value = expired.oauth!.value; expired.oauth!.expiresAt = Date.now() - 1;
    expect(consumeState(expired, value)).toBe(false);
  });
});
