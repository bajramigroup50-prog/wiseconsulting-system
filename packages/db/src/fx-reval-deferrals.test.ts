/** 💱 Курсни разлики на девизни сметки и 📆 временски разграничувања — on PGlite. */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { saveBankAccount, saveFxList } from './bank/index';
import { postJournal } from './posting';
import { fxRevalList, fxRevalPreview, postFxReval, undoFxReval } from './fx-reval';
import { deferralStates, deleteDeferral, postDeferralsDue, saveDeferral, stopDeferral, undoDeferralMonth } from './deferrals';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
let firmId = '';
let eur = '';
const T = <R>(f: (tx: typeof db) => Promise<R>) => db.transaction((tx) => f(tx as unknown as typeof db));

const linesOf = async (sourceType: string, sourceId: string) => {
  const [j] = await db.select().from(schema.journals).where(and(eq(schema.journals.firmId, firmId), eq(schema.journals.sourceType, sourceType), eq(schema.journals.sourceId, sourceId)));
  if (!j) return null;
  const L = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j.id)).orderBy(schema.journalLines.lineNo);
  return { j, L: L.map((l) => [l.account, Number(l.debit), Number(l.credit)]) };
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Девизна ДООЕЛ' }).returning();
  firmId = f!.id;
  eur = await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Халк EUR', account: 'MK07250000000222222', cur: 'EUR', konto: '103077' } }));
  // 1.000 EUR received on 03.10 at 61,50 = 61.500 ден.; statement opening 0, line +1.000 EUR
  const [st] = await db.insert(schema.bankStatements).values({ firmId, bankAccountId: eur, date: '2026-10-03', number: '1', opening: '0', closing: '1000' }).returning();
  await db.insert(schema.bankLines).values({ firmId, statementId: st!.id, bankAccountId: eur, lineNo: 1, date: '2026-10-03', amount: '61500', amountCur: '1000', cur: 'EUR', description: 'уплата', dupKey: 'fx-t1' } as never);
  await T((tx) => postJournal(tx, { firmId, date: '2026-10-03', kind: 'manual', userId: null, requirePartner: false, lines: [{ account: '103077', debit: 61500, currency: 'EUR', amountCur: 1000 }, { account: '7400', credit: 61500 }] }));
  await T((tx) => saveFxList(tx, { userId: null, date: '2026-10-31', rows: [{ cur: 'EUR', rate: 61.7 }] }));
}, 60_000);

describe('fxReval', () => {
  it('previews the difference to the НБРМ middle rate and books Д девизна / П 7810', async () => {
    const p = await T((tx) => fxRevalPreview(tx, firmId, '2026-10-31'));
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({ konto: '103077', cur: 'EUR', balCur: 1000, balMkd: 61500, rate: 61.7, target: 61700, diff: 200 });
    await T((tx) => postFxReval(tx, { firmId, date: '2026-10-31', userId: null }));
    expect((await linesOf('fxReval', '2026-10-31'))!.L).toEqual([['103077', 200, 0], ['7810', 0, 200]]);
  });

  it('re-posting the same date replaces the journal (its own amount is left out of the balance)', async () => {
    const before = (await linesOf('fxReval', '2026-10-31'))!.j;
    const p = await T((tx) => fxRevalPreview(tx, firmId, '2026-10-31'));
    expect(p.rows[0]!.balMkd).toBe(61500);
    expect(p.posted?.number).toBe(before.number);
    await T((tx) => postFxReval(tx, { firmId, date: '2026-10-31', userId: null }));
    const after = (await linesOf('fxReval', '2026-10-31'))!;
    expect(after.j.id).toBe(before.id);
    expect(after.L).toEqual([['103077', 200, 0], ['7810', 0, 200]]);
  });

  it('the next month starts from the revalued balance: a lower rate is a loss on 4810', async () => {
    await T((tx) => saveFxList(tx, { userId: null, date: '2026-11-30', rows: [{ cur: 'EUR', rate: 61.6 }] }));
    const p = await T((tx) => fxRevalPreview(tx, firmId, '2026-11-30'));
    expect(p.rows[0]).toMatchObject({ balMkd: 61700, target: 61600, diff: -100 });
    await T((tx) => postFxReval(tx, { firmId, date: '2026-11-30', userId: null }));
    expect((await linesOf('fxReval', '2026-11-30'))!.L).toEqual([['4810', 100, 0], ['103077', 0, 100]]);
    expect((await T((tx) => fxRevalList(tx, firmId, 2026))).map((r) => [r.date, r.gain, r.loss])).toEqual([['2026-11-30', 0, 100], ['2026-10-31', 200, 0]]);
  });

  it('undo removes the journal', async () => {
    expect(await T((tx) => undoFxReval(tx, { firmId, date: '2026-11-30', userId: null }))).toBe(1);
    expect(await linesOf('fxReval', '2026-11-30')).toBeNull();
  });

  it('nothing to book when already at the middle rate', async () => {
    await expect(T((tx) => postFxReval(tx, { firmId, date: '2026-10-31', userId: null }).then(() => postFxReval(tx, { firmId, date: '2026-11-01', userId: null })))).rejects.toThrow(/Нема курсни разлики/);
  });
});

describe('deferrals', () => {
  let id = '';
  it('saves a schedule and books the months due, one journal per month on the month end', async () => {
    const d = await T((tx) => saveDeferral(tx, { firmId, userId: null, d: { name: 'Осигурување возила', kind: 'cost', amount: 1200, from: '2026-10', months: 12, konto: '4490', defKonto: '1909' } }));
    id = d.id;
    const r = await T((tx) => postDeferralsDue(tx, { firmId, userId: null, uptoYm: '2026-11' }));
    expect(r).toMatchObject({ n: 2, total: 200, skipped: [] });
    const m = (await linesOf('deferral', `${id}:2026-11`))!;
    expect(m.j.date).toBe('2026-11-30');
    expect(m.L).toEqual([['4490', 100, 0], ['1909', 0, 100]]);
    // booking again books nothing new
    expect((await T((tx) => postDeferralsDue(tx, { firmId, userId: null, uptoYm: '2026-11' }))).n).toBe(0);
    const [s] = await T((tx) => deferralStates(tx, firmId, '2026-12'));
    expect(s).toMatchObject({ posted: 200, remaining: 1000 });
    expect(s!.due.map((p) => p.ym)).toEqual(['2026-12']);
  });

  it('a schedule with booked months cannot change its amount and cannot be deleted; undo a month', async () => {
    await expect(T((tx) => saveDeferral(tx, { firmId, userId: null, id, d: { name: 'x', kind: 'cost', amount: 2400, from: '2026-10', months: 12, konto: '4490', defKonto: '1909' } }))).rejects.toThrow(/книжени месеци/);
    await T((tx) => saveDeferral(tx, { firmId, userId: null, id, d: { name: 'Осигурување возила 2026/27', kind: 'cost', amount: 1200, from: '2026-10', months: 12, konto: '4490', defKonto: '1909' } }));
    await expect(T((tx) => deleteDeferral(tx, { firmId, userId: null, id }))).rejects.toThrow(/поништете/);
    expect(await T((tx) => undoDeferralMonth(tx, { firmId, userId: null, id, ym: '2026-11' }))).toBe(1);
    const [s] = await T((tx) => deferralStates(tx, firmId, '2026-11'));
    expect(s!.d.name).toBe('Осигурување возила 2026/27');
    expect(s!.due.map((p) => p.ym)).toEqual(['2026-11']);
  });

  it('a stopped schedule books nothing; an income schedule books Д 2930 / П 7400', async () => {
    await T((tx) => stopDeferral(tx, { firmId, userId: null, id, stopped: true }));
    expect((await T((tx) => postDeferralsDue(tx, { firmId, userId: null, uptoYm: '2027-03' }))).n).toBe(0);
    const inc = await T((tx) => saveDeferral(tx, { firmId, userId: null, d: { name: 'Годишна претплата', kind: 'income', amount: 600, from: '2026-11', months: 6, konto: '7400', defKonto: '2930' } }));
    await T((tx) => postDeferralsDue(tx, { firmId, userId: null, uptoYm: '2026-11', id: inc.id }));
    expect((await linesOf('deferral', `${inc.id}:2026-11`))!.L).toEqual([['2930', 100, 0], ['7400', 0, 100]]);
  });

  it('months in a locked period are skipped, the rest are booked', async () => {
    const d = await T((tx) => saveDeferral(tx, { firmId, userId: null, d: { name: 'Закуп', kind: 'cost', amount: 300, from: '2026-09', months: 3, konto: '4490', defKonto: '1909' } }));
    await db.update(schema.firms).set({ lockDate: '2026-09-30' }).where(eq(schema.firms.id, firmId));
    const r = await T((tx) => postDeferralsDue(tx, { firmId, userId: null, uptoYm: '2026-11', id: d.id }));
    expect(r.n).toBe(2);
    expect(r.skipped).toEqual(['Закуп 09.2026']);
    await db.update(schema.firms).set({ lockDate: null }).where(eq(schema.firms.id, firmId));
  });
});
