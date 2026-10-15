import { and, asc, eq } from 'drizzle-orm';
import { appSettings, resetDemo, users, type DB, type Tx } from '@wise/db';
import { DEMO_SETTINGS_KEY } from '@wise/core/demo';
import { defineJob } from '../job';

/**
 * 🎭 Nightly demo reset (optional): only when the owner turned it on (`app_settings.demoSettings.nightly === true`).
 * Deletes the demo firms / demo colleagues and seeds them again (`resetDemo`, one transaction). Every demo user with
 * role `admin` is kept (the oldest one is the actor of the new data); without a demo admin nothing happens.
 */
export async function runDemoReset(db: DB, log: (m: string) => void = () => {}): Promise<{ ran: boolean; reason?: string; firms?: number }> {
  const [s] = await db.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, DEMO_SETTINGS_KEY)).limit(1);
  if ((s?.v as { nightly?: boolean } | undefined)?.nightly !== true) return { ran: false, reason: 'off' };
  const admins = await db.select({ id: users.id }).from(users).where(and(eq(users.demo, true), eq(users.role, 'admin'))).orderBy(asc(users.createdAt));
  if (!admins.length) { log('no demo admin – skipped'); return { ran: false, reason: 'no-admin' }; }
  const r = await resetDemo(db as unknown as Tx, { adminUserId: admins[0]!.id, keepUserIds: admins.map((a) => a.id) });
  log(`deleted ${r.deleted.firmIds.length} demo firms / ${r.deleted.userIds.length} demo users; seeded ${r.firmIds.length} firms + office, ${r.userIds.length} colleagues`);
  return { ran: true, firms: r.firmIds.length };
}

export const demoReset = defineJob({
  name: 'demo.reset',
  cron: '30 3 * * *',
  queue: { retryLimit: 0, expireInSeconds: 1800 },
  async run(_data, { db, log }) {
    await runDemoReset(db, log);
  },
});
