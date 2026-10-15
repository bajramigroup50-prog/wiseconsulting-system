import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { runRobotTool } from './robot/tools';
import { markRok, syncRokovi } from './rokovi';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
let a = '', b = '', c = '', userId = '';
const W = { from: '2026-10-01', to: '2026-10-31' };

async function statement(firmId: string, date: string, number: string, lines: Partial<typeof schema.bankLines.$inferInsert>[]) {
  const [acc] = await db.insert(schema.bankAccounts).values({ firmId, name: 'Жиро', account: '300000000000001', konto: '1000' }).returning();
  const [st] = await db.insert(schema.bankStatements).values({ firmId, bankAccountId: acc!.id, date, number }).returning();
  await db.insert(schema.bankLines).values(lines.map((l, i) => ({
    firmId, statementId: st!.id, bankAccountId: acc!.id, lineNo: i + 1, date, amount: '-1000.00', dupKey: `${number}:${i}`, ...l,
  })));
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [fa] = await db.insert(schema.firms).values({ name: 'Алфа ДООЕЛ', edb: '4030000000012', vatRegistered: false }).returning();
  const [fb] = await db.insert(schema.firms).values({ name: 'Бета ДООЕЛ', edb: '4030000000013', vatRegistered: false }).returning();
  const [fc] = await db.insert(schema.firms).values({ name: 'Гама ДООЕЛ', edb: '4030000000014', vatRegistered: false }).returning();
  a = fa!.id; b = fb!.id; c = fc!.id;
  const [u] = await db.insert(schema.users).values({ username: 'kol', name: 'Колега', role: 'admin', passwordHash: 'x' }).returning();
  userId = u!.id;
  // Алфа: the advance for 09/2026 paid to the Treasury with the revenue code
  await statement(a, '2026-10-14', '94', [{ amount: '-12500.00', name: 'Буџет на Република Северна Македонија', counterAccount: '100000000063095', purpose: 'Аконтација данок на добивка 711212 00 01092026-30092026' }]);
  // Бета: only VAT paid to the Treasury
  await statement(b, '2026-10-14', '51', [{ amount: '-30000.00', name: 'Буџет на Република Северна Македонија', counterAccount: '100000000063095', purpose: 'ДДВ за 09/2026 714116 00' }]);
  // Гама: paid, but a colleague already marked it by hand
  await statement(c, '2026-10-13', '7', [{ amount: '-9000.00', counterAccount: '100000000063095', purpose: 'Аконтација данок на добивка за 09/2026' }]);
}, 120_000);

const rok = async (firmId: string, key: string) => (await db.select().from(schema.rokovi).where(and(eq(schema.rokovi.firmId, firmId), eq(schema.rokovi.key, key))))[0];

describe('📅 advance / МПИН marked done from the bank statements', () => {
  it('a Treasury line with the advance code marks the advance done (auto, with the evidence); another tax does not; a manual ✓ is untouched', async () => {
    // first sync creates the rows; Гама is marked by hand before the payment rule sees it
    await db.insert(schema.rokovi).values({ firmId: c, key: 'akont:2026-09', type: 'akont', title: 'x', period: '2026-09', due: '2026-10-15', legalDue: '2026-10-15', link: 'ppNal' });
    const g = await rok(c, 'akont:2026-09');
    await db.transaction((tx) => markRok(tx, { id: g!.id, done: true, userId, firmAllowed: () => true }));

    const r = await syncRokovi(db, W);
    expect(r.autoDone).toBe(1);
    expect(await rok(a, 'akont:2026-09')).toMatchObject({ done: true, auto: true, note: '✓ платено (извод бр. 94 од 14.10.2026, 12.500,00 ден.)' });
    expect(await rok(b, 'akont:2026-09')).toMatchObject({ done: false, auto: false, note: null });
    expect(await rok(c, 'akont:2026-09')).toMatchObject({ done: true, auto: false, doneBy: userId, note: null });

    // a second sync keeps everything (the evidence note survives the upsert)
    const r2 = await syncRokovi(db, W);
    expect([r2.autoDone, r2.autoUndone]).toEqual([0, 0]);
    expect(await rok(a, 'akont:2026-09')).toMatchObject({ done: true, auto: true, note: expect.stringContaining('✓ платено (извод бр. 94') });

    // the robot's deadlines answer shows the evidence (the row is due tomorrow)
    const [fa] = await db.select().from(schema.firms).where(eq(schema.firms.id, a));
    const out = await runRobotTool({ db, firm: fa!, year: 2026, userId, today: '2026-10-14', owner: false } as never, 'deadlines', { days: 7 });
    expect(out.summary).toContain('Аконтација данок на добивка за 09.2026 ✓ платено (извод бр. 94 од 14.10.2026, 12.500,00 ден.)');

    // the line is removed → the automatic „done“ is withdrawn with its evidence; the manual one stays
    await db.delete(schema.bankLines).where(eq(schema.bankLines.firmId, a));
    expect((await syncRokovi(db, W)).autoUndone).toBe(1);
    expect(await rok(a, 'akont:2026-09')).toMatchObject({ done: false, auto: false, note: null });
    expect(await rok(c, 'akont:2026-09')).toMatchObject({ done: true, auto: false });
  });
});
