/**
 * 💬 WhatsApp webhook security: Meta signs every POST with the app secret (`X-Hub-Signature-256: sha256=<hex HMAC of
 * the raw body>`), and the GET handshake echoes `hub.challenge` only for our own verify token. Server only (node:crypto).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** True only for a well-formed header whose HMAC-SHA256 of the exact raw body matches (constant-time compare). */
export function waSignatureOk(rawBody: string | Uint8Array, header: string | null | undefined, appSecret: string | null | undefined): boolean {
  if (!appSecret || !header) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const want = createHmac('sha256', appSecret).update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : Buffer.from(rawBody)).digest();
  const got = Buffer.from(m[1]!.toLowerCase(), 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

/** The header Meta would send (tests, the mock). */
export const waSign = (rawBody: string, appSecret: string) => 'sha256=' + createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');

/** GET handshake: the challenge to echo, or null (wrong mode / token). */
export function waHandshake(q: URLSearchParams, verifyToken: string | null | undefined): string | null {
  if (!verifyToken || q.get('hub.mode') !== 'subscribe') return null;
  const t = q.get('hub.verify_token') ?? '';
  const a = Buffer.from(t), b = Buffer.from(verifyToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const c = q.get('hub.challenge') ?? '';
  return /^[\w.-]{1,200}$/.test(c) ? c : null;
}

export const waNewVerifyToken = () => 'wise-' + randomBytes(18).toString('base64url');
