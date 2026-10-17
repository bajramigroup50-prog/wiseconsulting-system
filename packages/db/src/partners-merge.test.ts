/**
 * Duplicate partners and merging on PGlite: the production groups (synthetic rows mirroring the names), every reference
 * moved, the konto totals unchanged and the partner card summing both, locked period refused, other firms never merged,
 * the merged names used by later matching.
 */
import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { findPartnerMatch } from '@wise/core/partners/match';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { mergePartners, partnerDupGroups, PartnerMergeError } from './partners-merge';
import { ensurePartner } from './sales/partners-auto';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
const tx = <T>(f: (t: DB) => Promise<T>) => db.transaction((t) => f(t as unknown as DB));
let firmId = '', other = '';
const P: Record<string, string> = {};

const NAMES: [string, string, string | null][] = [
  ['0116', 'ЈУ ОД ОБЛАСТА НА ЗДРАВ.ЗА ПОТРЕБА НА ЈЗУ', null],
  ['0220', 'ЈУ ОД О. НА ЗДРАВ.ЗА ПОТ. НА ЈЗУ УКЦ', null],
  ['0320', 'ЈУ од Областа на Здр. за потрбите на ЈЗУ УК завод и Ургентен Центар', '6259960'],
  ['0194', 'ЗДРАВСТВЕН ДОМ СКОПЈЕ', null],
  ['0322', 'ЈЗУ Здравствен дом на Скопје ЦО Скопје', '4063589'],
  ['0206', 'ЦЕНТАР ЗА ЈАВНО ЗДРАВЈЕ СКОПЈЕ', null],
  ['0332', 'ЦЕНТАР ЗА ЈАВНО ЗДРАВЈЕ-Скопје', '4708032'],
  ['0001', 'Алфа ДООЕЛ Скопје', null],
  ['0002', 'Бета ДООЕЛ Скопје', null],
];

async function journal(date: string, number: string, lines: { account: string; partner?: string; debit?: number; credit?: number }[], kind = 'manual') {
  const [j] = await db.insert(schema.journals).values({ firmId, date, kind, number }).returning();
  await db.insert(schema.journalLines).values(lines.map((l, i) => ({ journalId: j!.id, firmId, lineNo: i + 1, account: l.account, partnerId: l.partner ?? null, debit: String(l.debit ?? 0), credit: String(l.credit ?? 0) })));
  return j!.id;
}
const card = async (pid: string) => {
  const [r] = await db.select({ s: sql<string>`coalesce(sum(${schema.journalLines.debit} - ${schema.journalLines.credit}), 0)::text` }).from(schema.journalLines).where(eq(schema.journalLines.partnerId, pid));
  return Number(r!.s);
};
const totals = async () => JSON.stringify(await db.select({ a: schema.journalLines.account, d: sql<string>`sum(${schema.journalLines.debit})::text`, c: sql<string>`sum(${schema.journalLines.credit})::text` })
  .from(schema.journalLines).where(eq(schema.journalLines.firmId, firmId)).groupBy(schema.journalLines.account).orderBy(schema.journalLines.account));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  firmId = (await db.insert(schema.firms).values({ name: 'Трули ДООЕЛ' }).returning())[0]!.id;
  other = (await db.insert(schema.firms).values({ name: 'Друга ДООЕЛ' }).returning())[0]!.id;
  for (const [code, name, embs] of NAMES) P[code] = (await db.insert(schema.partners).values({ firmId, code, name, embs }).returning())[0]!.id;
  P.foreign = (await db.insert(schema.partners).values({ firmId: other, code: '0116', name: NAMES[0]![1] }).returning())[0]!.id;
  // opening balance on 0116, invoices booked on 0220 and 0320, a payment on 0320
  await journal('2026-01-01', '0', [{ account: '1200', partner: P['0116'], debit: 1000 }, { account: '9000', credit: 1000 }], 'open');
  await journal('2026-02-10', '1', [{ account: '1200', partner: P['0220'], debit: 500 }, { account: '7600', credit: 500 }]);
  await journal('2026-03-10', '2', [{ account: '1200', partner: P['0320'], debit: 300 }, { account: '7600', credit: 300 }]);
  await journal('2026-03-20', '3', [{ account: '1000', debit: 200 }, { account: '1200', partner: P['0320'], credit: 200 }]);
  await db.insert(schema.invoices).values([{ firmId, kind: 'invoice', number: '10', date: '2026-02-10', partnerId: P['0220'] }, { firmId, kind: 'invoice', number: '11', date: '2026-03-10', partnerId: P['0320'] }]);
  await db.insert(schema.dunningLetters).values({ firmId, partnerId: P['0220'], partnerName: 'x', level: 1, channel: 'PDF', total: '500', date: '2026-04-01' });
  await db.insert(schema.compensations).values({ firmId, date: '2026-04-02', number: 'K-1/2026', total: '100', rows: [{ side: 'rec', partnerId: P['0220']!, konto: '1200', amt: 100, refId: `L|1200|${P['0220']}|10` }] });
}, 120_000);

describe('partner duplicates', () => {
  it('finds the three production groups (main: the one with the ЕМБС)', async () => {
    const V = await partnerDupGroups(db, firmId);
    const sets = V.groups.map((g) => g.rows.map((r) => r.code).sort().join(',')).sort();
    expect(sets).toEqual(['0116,0220,0320', '0194,0322', '0206,0332']);
    expect(V.groups.find((g) => g.rows.length === 3)!.main).toBe(P['0320']);
  });

  it('never merges partners of another firm', async () => {
    const e = await tx((t) => mergePartners(t, { firmId, userId: null }, P['0320']!, [P.foreign!])).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PartnerMergeError);
    expect((await partnerDupGroups(db, other)).groups).toEqual([]);
  });

  it('refuses a merge touching a locked period, listing the nalog', async () => {
    await db.update(schema.firms).set({ lockDate: '2026-01-31' }).where(eq(schema.firms.id, firmId));
    const e = await tx((t) => mergePartners(t, { firmId, userId: null }, P['0320']!, [P['0116']!])).catch((x: unknown) => x as Error);
    expect(e).toBeInstanceOf(PartnerMergeError);
    expect((e as Error).message).toMatch(/налог 0 \(2026-01-01\)/);
    await db.update(schema.firms).set({ lockDate: null }).where(eq(schema.firms.id, firmId));
  });

  it('moves every reference, keeps the konto totals and sums the partner card', async () => {
    const before = await totals();
    const r = await tx((t) => mergePartners(t, { firmId, userId: null }, P['0320']!, [P['0116']!, P['0220']!]));
    expect(r.merged).toBe(2);
    expect(await totals()).toBe(before);
    expect(await card(P['0320']!)).toBe(1000 + 500 + 300 - 200);
    expect((await db.select().from(schema.invoices).where(eq(schema.invoices.firmId, firmId))).every((i) => i.partnerId === P['0320'])).toBe(true);
    expect((await db.select().from(schema.dunningLetters))[0]!.partnerId).toBe(P['0320']);
    const [k] = await db.select().from(schema.compensations);
    expect(k!.rows[0]).toMatchObject({ partnerId: P['0320'], refId: `L|1200|${P['0320']}|10` });
    const left = await db.select().from(schema.partners).where(eq(schema.partners.firmId, firmId));
    expect(left.map((p) => p.code).sort()).toEqual(['0001', '0002', '0194', '0206', '0320', '0322', '0332']);
    const [m] = await db.select().from(schema.partners).where(eq(schema.partners.id, P['0320']!));
    expect((m!.data as { aliases: string[] }).aliases).toEqual(expect.arrayContaining([NAMES[0]![1], NAMES[1]![1]]));
    const [a] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'partnerMerge'));
    expect(a!.data).toMatchObject({ refs: r.refs, main: { id: P['0320'] } });
    // the merged names are used by later matching (scans, imports, ensurePartner)
    const all = await db.select().from(schema.partners).where(eq(schema.partners.firmId, firmId));
    expect(findPartnerMatch(all, { name: NAMES[1]![1] })).toMatchObject({ by: 'alias', partner: { id: P['0320'] } });
    expect(await tx((t) => ensurePartner(t, firmId, { name: NAMES[0]![1] }))).toMatchObject({ id: P['0320'], created: false });
  });

  it('auto-created partners: ЕМБС in its own field, never a duplicate of the same ЕМБС', async () => {
    const r = await tx((t) => ensurePartner(t, firmId, { name: 'Гиро Мамас ДООЕЛ', edb: '6558500', type: 'customer' }));
    expect(r.created).toBe(true);
    const [p] = await db.select().from(schema.partners).where(eq(schema.partners.id, r.id));
    expect([p!.edb, p!.embs]).toEqual([null, '6558500']);
    expect(await tx((t) => ensurePartner(t, firmId, { name: 'GIRO MAMAS', edb: '6558500' }))).toMatchObject({ id: r.id, created: false });
  });
});
