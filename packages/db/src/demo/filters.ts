/**
 * 🎭 Demo mode — SQL side of `@wise/core/demo`. A demo firm is `settings.demo = true` AND `name like 'ДЕМО%'`
 * (both, the same test as `isDemoFirm`); everything else is a real firm. A demo user is `users.demo = true`.
 */
import { and, eq, inArray, not, sql, type SQL } from 'drizzle-orm';
import { DEMO_PREFIX, DEMO_SETTINGS_KEY, demoSettingsClean, isDemoFirm, type DemoSettings } from '@wise/core/demo';
import { appSettings, firms, users } from '../schema/index';
import type { Tx } from '../audit';

type Q = Pick<Tx, 'select' | 'insert' | 'update'>;

/** `firms` row is a demo firm (flag AND prefix). */
export const demoFirmSql: SQL = sql`(coalesce((${firms.settings} -> 'demo') = 'true'::jsonb, false) and ${firms.name} like ${DEMO_PREFIX + '%'})`;
/** `firms` row is a real firm (not demo) — for the office's own lists, reports, reminders, fees. */
export const realFirmSql: SQL = sql`not ${demoFirmSql}`;

/** Ids of the demo firms (active only unless `all`). Re-checked in JS (`isDemoFirm`) on top of the SQL. */
export async function demoFirmIds(tx: Pick<Tx, 'select'>, o: { all?: boolean } = {}): Promise<string[]> {
  const R = await tx.select({ id: firms.id, name: firms.name, settings: firms.settings }).from(firms)
    .where(o.all ? demoFirmSql : and(demoFirmSql, eq(firms.active, true)));
  return R.filter(isDemoFirm).map((r) => r.id);
}

/** Is this firm id a demo firm? */
export async function isDemoFirmId(tx: Pick<Tx, 'select'>, firmId: string | null | undefined): Promise<boolean> {
  if (!firmId) return false;
  const [f] = await tx.select({ name: firms.name, settings: firms.settings }).from(firms).where(eq(firms.id, firmId)).limit(1);
  return isDemoFirm(f);
}

/** Ids of demo users (`users.demo`). */
export async function demoUserIds(tx: Pick<Tx, 'select'>): Promise<string[]> {
  return (await tx.select({ id: users.id }).from(users).where(eq(users.demo, true))).map((r) => r.id);
}

export async function isDemoUserId(tx: Pick<Tx, 'select'>, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const [u] = await tx.select({ d: users.demo }).from(users).where(eq(users.id, userId)).limit(1);
  return !!u?.d;
}

/** Real users only (for the office's lists). */
export const realUserSql: SQL = not(eq(users.demo, true));
export const userInSql = (ids: readonly string[]): SQL => (ids.length ? inArray(users.id, [...ids]) : sql`false`);

export async function getDemoSettings(tx: Pick<Tx, 'select'>): Promise<DemoSettings> {
  const [r] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, DEMO_SETTINGS_KEY)).limit(1);
  return demoSettingsClean(r?.v);
}

export async function putDemoSettings(tx: Q, p: Partial<DemoSettings>, userId: string | null): Promise<DemoSettings> {
  const value = demoSettingsClean({ ...(await getDemoSettings(tx)), ...p });
  await tx.insert(appSettings).values({ key: DEMO_SETTINGS_KEY, value, updatedBy: userId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: userId } });
  return value;
}
