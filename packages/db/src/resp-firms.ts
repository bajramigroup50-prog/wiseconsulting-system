/**
 * Which colleague follows which firms (Известувања → „👥 Распределба на фирми“) and the „📨 Прати на колегите“ notice.
 * Only a work list: it does not limit access (a colleague with all firms keeps all firms). Stored in app settings:
 * `respFirms` = { [userId]: firmId[] } and `alSent:<userId>` = { at, by, n } (the last notifications sent to them).
 */
import { eq, like } from 'drizzle-orm';
import { audit, type Tx } from './audit';
import { appSettings } from './schema/index';

type Q = Pick<Tx, 'select' | 'insert' | 'update' | 'delete'>;
const KEY = 'respFirms';
const sentKey = (userId: string) => `alSent:${userId}`;

export type RespMap = Record<string, string[]>;
export interface AlSent { at: string; by: string; n: number; bad: number }

export async function respFirms(tx: Pick<Tx, 'select'>): Promise<RespMap> {
  const [r] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
  const v = (r?.v ?? {}) as Record<string, unknown>;
  const out: RespMap = {};
  for (const [k, ids] of Object.entries(v)) if (Array.isArray(ids)) out[k] = ids.filter((x): x is string => typeof x === 'string');
  return out;
}

/** The firms of one colleague (replaces their list); a firm stays with one colleague only (moved from another). */
export async function saveRespFirms(tx: Tx, a: { userId: string; firmIds: string[]; by: string | null }): Promise<RespMap> {
  const M = await respFirms(tx);
  const mine = [...new Set(a.firmIds)];
  const set = new Set(mine);
  for (const k of Object.keys(M)) if (k !== a.userId) M[k] = M[k]!.filter((f) => !set.has(f));
  M[a.userId] = mine;
  for (const k of Object.keys(M)) if (!M[k]!.length) delete M[k];
  await tx.insert(appSettings).values({ key: KEY, value: M, updatedBy: a.by })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: M, updatedAt: new Date(), updatedBy: a.by } });
  await audit(tx, { userId: a.by, action: 'respFirms', entityType: 'app_settings', entityId: KEY, data: { user: a.userId, n: mine.length } });
  return M;
}

export async function markAlSent(tx: Tx, a: { userId: string; by: string; byId: string | null; n: number; bad: number }): Promise<void> {
  const v: AlSent = { at: new Date().toISOString(), by: a.by, n: a.n, bad: a.bad };
  await tx.insert(appSettings).values({ key: sentKey(a.userId), value: v, updatedBy: a.byId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedAt: new Date(), updatedBy: a.byId } });
  await audit(tx, { userId: a.byId, action: 'alSentColleague', entityType: 'user', entityId: a.userId, data: { n: a.n, bad: a.bad } });
}

export async function alSentFor(tx: Pick<Tx, 'select'>, userId: string): Promise<AlSent | null> {
  const [r] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, sentKey(userId))).limit(1);
  const v = r?.v as Partial<AlSent> | undefined;
  return v?.at ? { at: v.at, by: String(v.by ?? ''), n: Number(v.n) || 0, bad: Number(v.bad) || 0 } : null;
}

/** For tests / cleanup: every `alSent:*` key. */
export async function alSentKeys(tx: Pick<Tx, 'select'>): Promise<string[]> {
  return (await tx.select({ k: appSettings.key }).from(appSettings).where(like(appSettings.key, 'alSent:%'))).map((r) => r.k);
}
