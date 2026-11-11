/**
 * 🔐 Хyрjа во 2 чекори (TOTP, RFC 6238 – Google / Microsoft Authenticator): after the password, a 6-digit code from the
 * phone. Per user in app setting `mfa:<userId>` = { secret (sealed), on, at, codes: sha256 of the unused recovery codes }.
 * The office-wide rule `mfaRequired` makes it obligatory for the office users (not for clients).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { audit, type Tx } from './audit';
import { appSettings } from './schema/index';
import { openSecret, sealSecret } from './social';

type Q = Pick<Tx, 'select' | 'insert' | 'update' | 'delete'>;
const key = (userId: string) => `mfa:${userId}`;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buf: Uint8Array): string {
  let bits = 0, v = 0, out = '';
  for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(v << (5 - bits)) & 31];
  return out;
}
export function unbase32(s: string): Buffer {
  const c = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, v = 0; const out: number[] = [];
  for (const ch of c) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}

/** The 6-digit code of a base32 secret at a time (30-second steps). */
export function totpCode(secret: string, at = Date.now(), step = 0): string {
  const ctr = Math.floor(at / 1000 / 30) + step;
  const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(ctr));
  const h = createHmac('sha1', unbase32(secret)).update(b).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}
/** Accepts the current code and one step either side (clock drift of the phone). */
export function totpOk(secret: string, code: string, at = Date.now()): boolean {
  const c = code.replace(/\D/g, '');
  if (c.length !== 6) return false;
  return [-1, 0, 1].some((s) => { const x = Buffer.from(totpCode(secret, at, s)); return timingSafeEqual(x, Buffer.from(c)); });
}
export const otpauthUri = (issuer: string, account: string, secret: string) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

const sha = (s: string) => createHash('sha256').update(s.replace(/[^A-Z0-9]/gi, '').toUpperCase()).digest('hex');
interface MfaRow { secret?: string; pending?: string; on?: boolean; at?: string; codes?: string[] }

async function row(tx: Pick<Tx, 'select'>, userId: string): Promise<MfaRow> {
  const [r] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, key(userId))).limit(1);
  return (r?.v ?? {}) as MfaRow;
}
async function put(tx: Q, userId: string, v: MfaRow, by: string | null) {
  await tx.insert(appSettings).values({ key: key(userId), value: v, updatedBy: by })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedAt: new Date(), updatedBy: by } });
}

export interface MfaState { on: boolean; at: string | null; codesLeft: number }
export async function mfaState(tx: Pick<Tx, 'select'>, userId: string): Promise<MfaState> {
  const r = await row(tx, userId);
  return { on: !!r.on && !!r.secret, at: r.at ?? null, codesLeft: r.codes?.length ?? 0 };
}

/** Step 1 of the setup: a new secret kept as „pending“ until a code from the phone confirms it. */
export async function mfaBegin(tx: Tx, userId: string): Promise<string> {
  const r = await row(tx, userId);
  const secret = base32(randomBytes(20));
  await put(tx, userId, { ...r, pending: sealSecret(secret) }, userId);
  return secret;
}

/** Step 2: the code confirms the pending secret → on; returns the 8 recovery codes (shown once). */
export async function mfaConfirm(tx: Tx, userId: string, code: string): Promise<string[] | null> {
  const r = await row(tx, userId);
  let secret = ''; try { secret = (r.pending ? openSecret(r.pending) : '') ?? ''; } catch { secret = ''; }
  if (!secret || !totpOk(secret, code)) return null;
  const codes = Array.from({ length: 8 }, () => { const x = base32(randomBytes(5)); return `${x.slice(0, 4)}-${x.slice(4, 8)}`; });
  await put(tx, userId, { secret: r.pending, on: true, at: new Date().toISOString(), codes: codes.map(sha) }, userId);
  await audit(tx, { userId, action: 'mfaOn', entityType: 'user', entityId: userId });
  return codes;
}

/** Login: a code from the phone or one unused recovery code (used up). */
export async function mfaCheck(tx: Tx, userId: string, code: string): Promise<'ok' | 'recovery' | false> {
  const r = await row(tx, userId);
  if (!r.on || !r.secret) return 'ok';
  let secret = ''; try { secret = openSecret(r.secret) ?? ''; } catch { secret = ''; }
  if (secret && totpOk(secret, code)) return 'ok';
  const h = sha(code);
  if (code.replace(/[^A-Z0-9]/gi, '').length === 8 && r.codes?.includes(h)) {
    await put(tx, userId, { ...r, codes: r.codes.filter((x) => x !== h) }, userId);
    await audit(tx, { userId, action: 'mfaRecovery', entityType: 'user', entityId: userId, data: { left: r.codes.length - 1 } });
    return 'recovery';
  }
  return false;
}

/** Turn off (the user themself, or the administrator for a lost phone). */
export async function mfaOff(tx: Tx, userId: string, by: string | null): Promise<void> {
  await tx.delete(appSettings).where(eq(appSettings.key, key(userId)));
  await audit(tx, { userId: by, action: 'mfaOff', entityType: 'user', entityId: userId });
}

export async function mfaRequired(tx: Pick<Tx, 'select'>): Promise<boolean> {
  const [r] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, 'mfaRequired')).limit(1);
  return r?.v === true;
}
export async function setMfaRequired(tx: Q, on: boolean, by: string | null): Promise<void> {
  await tx.insert(appSettings).values({ key: 'mfaRequired', value: on, updatedBy: by })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: on, updatedAt: new Date(), updatedBy: by } });
}
