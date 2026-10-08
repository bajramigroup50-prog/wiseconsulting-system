/**
 * Password hashing: argon2id for new hashes. Legacy hashes from the claude.ai app are accepted
 * at login and flagged for re-hashing:
 *   - `p2$<iterations>$<hex>` — PBKDF2-SHA256, salt `wc|<userSalt>`, 32 bytes (legacy `pwHash`, v467)
 *   - bare hex — sha256(`<userSalt>|<password>`) (pre-v467 `sha`)
 */
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { createHash, pbkdf2Sync, timingSafeEqual } from 'node:crypto';

export const hashPassword = (pw: string): Promise<string> => argonHash(pw);

const eqHex = (a: string, b: string): boolean => {
  const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

export function legacyPbkdf2(salt: string, pw: string, iterations = 150_000): string {
  const b = pbkdf2Sync(Buffer.from(String(pw), 'utf8'), Buffer.from('wc|' + String(salt), 'utf8'), iterations, 32, 'sha256');
  return `p2$${iterations}$${b.toString('hex')}`;
}

export interface VerifyResult {
  ok: boolean;
  /** True when the stored hash is legacy and should be replaced with `hashPassword(pw)`. */
  rehash: boolean;
}

export async function verifyPassword(stored: string, pw: string, legacySalt?: string | null): Promise<VerifyResult> {
  if (stored.startsWith('$argon2')) {
    try { return { ok: await argonVerify(stored, pw), rehash: false }; } catch { return { ok: false, rehash: false }; }
  }
  if (legacySalt == null) return { ok: false, rehash: false };
  if (stored.startsWith('p2$')) {
    const [, it, hex] = stored.split('$');
    const iterations = Number(it);
    if (!Number.isInteger(iterations) || iterations < 1 || !hex) return { ok: false, rehash: false };
    const ok = eqHex(hex, legacyPbkdf2(legacySalt, pw, iterations).split('$')[2]!);
    return { ok, rehash: ok };
  }
  const ok = eqHex(stored, createHash('sha256').update(`${legacySalt}|${pw}`, 'utf8').digest('hex'));
  return { ok, rehash: ok };
}
