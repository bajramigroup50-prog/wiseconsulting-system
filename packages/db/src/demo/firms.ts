/**
 * 🎭 A firm created by a DEMO user (a buyer in a sales presentation types their real client): always a demo firm —
 * `settings.demo = true` and the name „ДЕМО – …“ (`demoFirmName`), so the flag + prefix safety of `isDemoFirm` / the
 * reset holds — and at most `DEMO_MAX_FIRMS` demo firms in total (seeded ones included). Nothing is ever looked up by
 * ЕДБ / ЕМБС: a real firm with the same numbers is never linked, merged, changed or named.
 */
import { sql } from 'drizzle-orm';
import { DEMO_LIMIT_MSG, DEMO_MAX_FIRMS, demoFirmName, isDemoFirm } from '@wise/core/demo';
import { audit, type Tx } from '../audit';
import { firms, type Firm, type NewFirm } from '../schema/index';
import { demoFirmSql } from './filters';

export class DemoFirmError extends Error {}

/** Number of demo firms (flag + prefix; archived ones and the demo office firm included). */
export async function demoFirmCount(tx: Pick<Tx, 'select'>): Promise<number> {
  const R = await tx.select({ name: firms.name, settings: firms.settings }).from(firms).where(demoFirmSql);
  return R.filter(isDemoFirm).length;
}

export type DemoFirmInput = Omit<NewFirm, 'settings' | 'name' | 'ownerId' | 'id'> & { name: string; settings?: Record<string, unknown> };

/** Create a demo firm for a demo user (run inside a transaction). Throws `DemoFirmError` past the limit. */
export async function createDemoFirm(tx: Tx, o: { values: DemoFirmInput; userId: string }): Promise<Firm> {
  // one creator at a time: the count and the insert must not race past the limit
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('wise.demoFirms'))`);
  if ((await demoFirmCount(tx)) >= DEMO_MAX_FIRMS) throw new DemoFirmError(DEMO_LIMIT_MSG);
  const name = demoFirmName(o.values.name);
  const settings: Record<string, unknown> = { ...(o.values.settings ?? {}), demo: true, demoCreated: true };
  delete settings.officeFirm;
  delete settings.demoOffice;
  const [f] = await tx.insert(firms).values({ ...o.values, name, ownerId: o.userId, settings }).returning();
  if (!isDemoFirm(f)) throw new DemoFirmError('Демо фирмата не е креирана.');
  await audit(tx, { userId: o.userId, firmId: f!.id, action: 'newFirm', entityType: 'firm', entityId: f!.id, data: { name, demo: true } });
  return f!;
}
