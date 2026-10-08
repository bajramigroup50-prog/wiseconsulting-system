import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPassword, legacyPbkdf2, verifyPassword } from './password';

describe('password', () => {
  it('argon2 round-trip', async () => {
    const h = await hashPassword('tajna-123');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'tajna-123')).toEqual({ ok: true, rehash: false });
    expect((await verifyPassword(h, 'wrong')).ok).toBe(false);
  });

  it('accepts legacy PBKDF2 (p2$) hashes and asks for a rehash', async () => {
    const stored = legacyPbkdf2('s4lt', 'lozinka', 1000);
    expect(stored).toMatch(/^p2\$1000\$[0-9a-f]{64}$/);
    expect(await verifyPassword(stored, 'lozinka', 's4lt')).toEqual({ ok: true, rehash: true });
    expect((await verifyPassword(stored, 'lozinka', 'other')).ok).toBe(false);
  });

  it('matches the WebCrypto derivation used by legacy pwHash', async () => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('pw'), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode('wc|abc'), iterations: 2000 }, key, 256);
    const legacy = 'p2$2000$' + Buffer.from(bits).toString('hex');
    expect(legacyPbkdf2('abc', 'pw', 2000)).toBe(legacy);
  });

  it('accepts pre-v467 sha256(salt|pw) hashes', async () => {
    const stored = createHash('sha256').update('xy|pw').digest('hex');
    expect(await verifyPassword(stored, 'pw', 'xy')).toEqual({ ok: true, rehash: true });
    expect((await verifyPassword(stored, 'pw', null)).ok).toBe(false);
  });
});
