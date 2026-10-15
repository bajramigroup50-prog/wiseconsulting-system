import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_FIRM_NAMES, DEMO_OFFICE_NAME } from '@wise/core/demo';
import { schema, seedReference, type DB } from '@wise/db';
import { demoReset, runDemoReset } from './demo-reset';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as DB;
let realFirm = '';

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  await seedReference(pg);
  const [f] = await pg.insert(schema.firms).values({ name: 'Вистински Клиент ДООЕЛ' }).returning();
  realFirm = f!.id;
}, 120_000);

const names = async () => (await pg.select({ n: schema.firms.name }).from(schema.firms)).map((r) => r.n).sort();

describe('demo.reset', () => {
  it('runs nightly at 03:30', () => expect(demoReset.cron).toBe('30 3 * * *'));

  it('does nothing unless the owner turned the nightly reset on', async () => {
    expect(await runDemoReset(db)).toEqual({ ran: false, reason: 'off' });
    await pg.insert(schema.appSettings).values({ key: 'demoSettings', value: { ai: false, aiLimitUsd: 5, nightly: false } });
    expect(await runDemoReset(db)).toEqual({ ran: false, reason: 'off' });
  });

  it('skips without a demo admin', async () => {
    await pg.update(schema.appSettings).set({ value: { ai: false, aiLimitUsd: 5, nightly: true } }).where(eq(schema.appSettings.key, 'demoSettings'));
    await pg.insert(schema.users).values({ username: 'owner', name: 'Сопственик', role: 'admin', passwordHash: 'x' });
    expect(await runDemoReset(db)).toEqual({ ran: false, reason: 'no-admin' });
    expect(await names()).toEqual(['Вистински Клиент ДООЕЛ']);
  });

  it('resets the demo data and keeps every demo admin and the real firm', async () => {
    const A = await pg.insert(schema.users).values([
      { username: 'demo', name: 'Демо', role: 'admin', demo: true, passwordHash: 'x' },
      { username: 'demo2', name: 'Демо 2', role: 'admin', demo: true, passwordHash: 'x' },
    ]).returning();
    for (let i = 0; i < 2; i++) expect(await runDemoReset(db)).toEqual({ ran: true, firms: 3 });
    expect(await names()).toEqual(['Вистински Клиент ДООЕЛ', ...DEMO_FIRM_NAMES, DEMO_OFFICE_NAME].sort());
    const U = await pg.select().from(schema.users);
    for (const a of A) expect(U.some((u) => u.id === a.id)).toBe(true);
    expect(U.some((u) => u.username === 'owner')).toBe(true);
    expect(U.filter((u) => u.demo && u.role !== 'admin')).toHaveLength(3);
    expect((await pg.select().from(schema.firms).where(eq(schema.firms.id, realFirm))).length).toBe(1);
  }, 300_000);
});
