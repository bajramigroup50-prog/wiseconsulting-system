/**
 * A firm's own mailbox for its invoices (Фирми → ✉ Е-пошта на фирмата): the invoices it issues are sent from its own
 * address (its Gmail / Outlook / hosting mailbox with an app password), not from the office's. The password is sealed
 * (AES-GCM, `sealSecret`) in app setting `firmMail:<firmId>` and never shown back.
 */
import { eq } from 'drizzle-orm';
import { audit, type Tx } from './audit';
import { appSettings } from './schema/index';
import { openSecret, sealSecret } from './social';

type Q = Pick<Tx, 'select' | 'insert' | 'update' | 'delete'>;

export interface FirmMailbox { user: string; host: string; port: number; pass: string }
export interface FirmMailboxInfo { user: string; host: string; port: number; at?: string; by?: string }

const keyOf = (firmId: string) => `firmMail:${firmId}`;

/** SMTP server of the well-known providers (by the address's domain); anything else needs host / port typed in. */
export function smtpOfAddress(user: string): { host: string; port: number } | null {
  const d = user.split('@')[1]?.toLowerCase() ?? '';
  if (/^(gmail|googlemail)\.com$/.test(d)) return { host: 'smtp.gmail.com', port: 465 };
  if (/^(outlook|hotmail|live|msn)\.[a-z.]+$/.test(d)) return { host: 'smtp-mail.outlook.com', port: 587 };
  if (/^yahoo\.[a-z.]+$/.test(d)) return { host: 'smtp.mail.yahoo.com', port: 465 };
  if (/^(icloud|me)\.com$/.test(d)) return { host: 'smtp.mail.me.com', port: 587 };
  return null;
}

export async function firmMailboxInfo(tx: Q, firmId: string): Promise<FirmMailboxInfo | null> {
  const [r] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, keyOf(firmId))).limit(1);
  const v = r?.v as Partial<FirmMailboxInfo> & { pass?: string } | undefined;
  return v?.user && v.host ? { user: v.user, host: v.host, port: Number(v.port) || 465, ...(v.at ? { at: v.at } : {}), ...(v.by ? { by: v.by } : {}) } : null;
}

/** The mailbox with its opened password (worker only); null when none is set or the password cannot be opened. */
export async function firmMailbox(tx: Q, firmId: string): Promise<FirmMailbox | null> {
  const [r] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, keyOf(firmId))).limit(1);
  const v = r?.v as { user?: string; host?: string; port?: number; pass?: string } | undefined;
  if (!v?.user || !v.host || !v.pass) return null;
  let pass: string | null = null;
  try { pass = openSecret(v.pass); } catch { pass = null; }
  return pass ? { user: v.user, host: v.host, port: Number(v.port) || 465, pass } : null;
}

export class FirmMailError extends Error {
  constructor(m: string) { super(m); this.name = 'FirmMailError'; }
}

export async function saveFirmMailbox(tx: Tx, a: { firmId: string; userId: string | null; by?: string; user: string; pass: string; host?: string; port?: number }): Promise<void> {
  const user = a.user.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(user)) throw new FirmMailError('Внесете ја е-поштата на фирмата (на пр. firma@gmail.com).');
  const known = smtpOfAddress(user);
  const host = (a.host?.trim() || known?.host || '').toLowerCase();
  const port = Number(a.port) || known?.port || 465;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) throw new FirmMailError('Внесете го SMTP серверот на е-поштата (на пр. mail.firma.mk).');
  if (![465, 587, 25, 2525].includes(port)) throw new FirmMailError('Порта: 465 или 587.');
  const pass = a.pass.trim();
  const old = await firmMailbox(tx, a.firmId);
  // an empty password keeps the saved one (changing only the server / port)
  const sealed = pass ? sealSecret(pass) : old && old.user === user ? sealSecret(old.pass) : null;
  if (!sealed) throw new FirmMailError('Внесете ја лозинката за апликација.');
  const v = { user, host, port, pass: sealed, at: new Date().toISOString(), ...(a.by ? { by: a.by } : {}) };
  await tx.insert(appSettings).values({ key: keyOf(a.firmId), value: v, updatedBy: a.userId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedAt: new Date(), updatedBy: a.userId } });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'firmMailSave', entityType: 'app_settings', entityId: keyOf(a.firmId), data: { user, host, port } });
}

export async function clearFirmMailbox(tx: Tx, a: { firmId: string; userId: string | null }): Promise<void> {
  await tx.delete(appSettings).where(eq(appSettings.key, keyOf(a.firmId)));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'firmMailDel', entityType: 'app_settings', entityId: keyOf(a.firmId), data: {} });
}
