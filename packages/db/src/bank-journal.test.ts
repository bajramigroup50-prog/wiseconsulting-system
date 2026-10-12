/**
 * Bank statements booked into nalozi (production report: a Халкбанк statement of 01.06.2026 saved, every line
 * „непрокнижено“, an empty „6/10-12 ИЗВОДИ“ nalog dated 31.12): suggestions by payment code, per-line and
 * „Прокнижи ги сите“ posting, import inside a nalog with its period check, reconciliation block.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { statementProblems, type Statement } from '@wise/core';
import {
  bookStatementLines, lineKey, nalogPeriod, planImport, previewSuggestions, saveBankAccount, saveImport, setLineKonto, statementSuggestions,
} from './bank/index';
import { postJournal } from './posting';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
const T = <R>(f: (tx: typeof db) => Promise<R>) => db.transaction((tx) => f(tx as unknown as typeof db));
const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected an error'); };

/** Извод бр. 18 од 01.06.2026, Халкбанк 270077299520174: 8 outflows = 38.779, saldo 51.158 → 12.379. */
const halk = (): Statement => ({
  format: 'halk-xml', account: '270077299520174', no: '18', date: '2026-06-01', currency: 'MKD',
  opening: 5_115_800, closing: 1_237_900, debit: 3_877_900, credit: 0,
  lines: [
    { date: '2026-06-01', amount: -7_200, counterparty: 'Халкбанк АД Скопје', ref: '', purpose: 'Провизија за платен промет', desc: 'Провизија за платен промет', osnov: '666' },
    { date: '2026-06-01', amount: -19_300, counterparty: 'Буџет на РСМ', iban: '100000000063095', ref: '', purpose: 'Персонален данок од плата 05/2026', desc: 'Буџет на РСМ – Персонален данок 05/2026', osnov: '840' },
    { date: '2026-06-01', amount: -20_000, counterparty: 'Буџет на РСМ', iban: '100000000063095', ref: '', purpose: 'Придонес за вработување 05/2026', desc: 'Буџет на РСМ – Придонес за вработување', osnov: '843' },
    { date: '2026-06-01', amount: -46_200, counterparty: 'Буџет на РСМ', iban: '100000000063095', ref: '', purpose: 'ДДВ 714116 за 04/2026', desc: 'Буџет на РСМ – ДДВ 714116', osnov: '840' },
    { date: '2026-06-01', amount: -167_900, counterparty: 'Буџет на РСМ', iban: '100000000063095', ref: '', purpose: 'Придонес за здравствено осигурување', desc: 'Буџет на РСМ – здравствено', osnov: '843' },
    { date: '2026-06-01', amount: -288_800, counterparty: 'Алфа ДОО', ref: '', purpose: 'Плаќање по договор', desc: 'Алфа ДОО – плаќање по договор', osnov: '220' },
    { date: '2026-06-01', amount: -723_900, counterparty: 'Буџет на РСМ', iban: '100000000063095', ref: '', purpose: 'Придонес ПИО 05/2026', desc: 'Буџет на РСМ – ПИО', osnov: '843' },
    { date: '2026-06-01', amount: -2_604_600, counterparty: 'Нов Добавувач ДООЕЛ', ref: '', purpose: 'Набавка на стока', desc: 'Нов Добавувач ДООЕЛ – набавка на стока', osnov: '200' },
  ],
});

async function newFirm(name: string) {
  const [f] = await db.insert(schema.firms).values({ name }).returning();
  const firmId = f!.id;
  const alfa = (await db.insert(schema.partners).values({ firmId, name: 'Алфа ДОО', code: '1' }).returning())[0]!.id;
  const acct = await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Халкбанк', account: '270077299520174', cur: 'MKD', konto: '1000' } }));
  return { firmId, alfa, acct };
}
const journalsOf = (firmId: string) => db.select().from(schema.journals).where(eq(schema.journals.firmId, firmId)).orderBy(asc(schema.journals.date));
const linesOf = (journalId: string) => db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, journalId)).orderBy(asc(schema.journalLines.lineNo));
const stLines = (firmId: string) => db.select().from(schema.bankLines).where(eq(schema.bankLines.firmId, firmId)).orderBy(asc(schema.bankLines.lineNo));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
}, 60_000);

describe('nalog period', () => {
  it('from the nalog number or its own period', () => {
    expect(nalogPeriod('6/10-12', 2026)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(nalogPeriod('6/4-6', 2026)).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(nalogPeriod('6/2-2', 2028)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(nalogPeriod('123', 2026, { from: '2026-06-01', to: '2026-06-30' })).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    expect(nalogPeriod('ИЗВОДИ', 2026)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
});

describe('reconciliation', () => {
  it('the statement reconciles; a wrong closing balance is a blocking problem', () => {
    expect(statementProblems(halk())).toEqual([]);
    expect(statementProblems({ ...halk(), closing: 1_237_000 })[0]).toMatch(/Салдата не се совпаѓаат/);
  });
});

describe('statement from /banka: suggestions, per-line and all posting', () => {
  let F: Awaited<ReturnType<typeof newFirm>>;
  let stId = '';
  beforeAll(async () => { F = await newFirm('Тест Изводи ДООЕЛ'); });

  it('import leaves a draft without a journal', async () => {
    const r = await T((tx) => saveImport(tx, { firmId: F.firmId, userId: null, statements: [halk()], format: 'halk-xml' }));
    expect(r).toMatchObject({ statements: 1, lines: 8, posted: 0, drafts: 1 });
    stId = r.statementIds![0]!;
    expect(await journalsOf(F.firmId)).toEqual([]);
  });

  it('suggests counter kontos from the payment code, the Treasury and the counterparty', async () => {
    const S = await T((tx) => statementSuggestions(tx, F.firmId, [stId]));
    const L = await stLines(F.firmId);
    const k = L.map((l) => [S.get(l.id)!.konto, S.get(l.id)!.partnerId ? 'P' : S.get(l.id)!.newPartner ?? '']);
    expect(k).toEqual([
      ['4460', ''], // 666 провизија
      ['2340', ''], // 840 персонален данок
      ['2349', ''], // 843 придонеси
      ['23008', ''], // ДДВ
      ['2349', ''],
      ['2200', 'P'], // Алфа ДОО
      ['2349', ''],
      ['2200', 'Нов Добавувач ДООЕЛ'],
    ]);
    expect(S.get(L[1]!.id)!.why).toMatch(/840/);
    expect([...S.values()].some((s) => s.missing)).toBe(false);
  });

  it('a missing konto is reported with the reason, not posted', async () => {
    await db.update(schema.firms).set({ settings: { bankKonta: { fee: '44699' } } }).where(eq(schema.firms.id, F.firmId));
    const S = await T((tx) => statementSuggestions(tx, F.firmId, [stId]));
    const fee = [...S.values()].find((s) => s.konto === '44699')!;
    expect(fee).toMatchObject({ missing: true });
    expect(fee.why).toMatch(/44699 не постои во контниот план/);
    await db.update(schema.firms).set({ settings: {} }).where(eq(schema.firms.id, F.firmId));
  });

  it('„Прокнижи…“ on one line posts it at once: a journal dated on the statement, in the June series', async () => {
    const L = await stLines(F.firmId);
    await T((tx) => setLineKonto(tx, { firmId: F.firmId, userId: null, lineId: L[0]!.id, konto: '4460', learn: false }));
    const [j] = await journalsOf(F.firmId);
    expect(j).toMatchObject({ date: '2026-06-01', kind: 'bank', number: '6/4-6' });
    expect((await linesOf(j!.id)).map((l) => [l.account, l.debit, l.credit])).toEqual([['4460', '72.00', '0.00'], ['1000', '0.00', '72.00']]);
    const [st] = await db.select().from(schema.bankStatements).where(eq(schema.bankStatements.id, stId));
    expect(st!.status).toBe('draft');
  });

  it('„Прокнижи ги сите“ books every line on its suggestion; the nalog balances on 1000', async () => {
    const r = await T((tx) => bookStatementLines(tx, { firmId: F.firmId, userId: null, statementIds: [stId] }));
    expect(r.skipped).toEqual([]);
    expect(r.booked).toBe(7);
    expect(r.posted.get(stId)).toMatchObject({ status: 'posted', number: '6/4-6', booked: 8 });
    const J = await journalsOf(F.firmId);
    expect(J).toHaveLength(1);
    expect(J[0]).toMatchObject({ date: '2026-06-01', number: '6/4-6' });
    const JL = await linesOf(J[0]!.id);
    const sum = (k: 'debit' | 'credit') => JL.reduce((s, l) => s + Math.round(Number(l[k]) * 100), 0);
    expect(sum('debit')).toBe(sum('credit'));
    expect(JL.filter((l) => l.account === '1000').reduce((s, l) => s + Math.round(Number(l.credit) * 100), 0)).toBe(3_877_900);
    expect(JL.filter((l) => l.account === '2200').every((l) => l.partnerId)).toBe(true);
    const L = await stLines(F.firmId);
    expect(L.every((l) => l.konto)).toBe(true);
    const [p] = await db.select().from(schema.partners).where(and(eq(schema.partners.firmId, F.firmId), eq(schema.partners.name, 'Нов Добавувач ДООЕЛ')));
    expect(p).toBeTruthy();
    const A = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.firmId, F.firmId), eq(schema.auditLog.action, 'bankBookAll')));
    expect(A).toHaveLength(1);
  });

  it('respects the period lock', async () => {
    await db.update(schema.firms).set({ lockDate: '2026-06-30' }).where(eq(schema.firms.id, F.firmId));
    const e = await err(T((tx) => bookStatementLines(tx, { firmId: F.firmId, userId: null, statementIds: [stId] })));
    expect(e.message).toMatch(/заклучен/);
    await db.update(schema.firms).set({ lockDate: null }).where(eq(schema.firms.id, F.firmId));
  });
});

describe('import inside a nalog (Налози → ИЗВОДИ → „📥 Увези извод“)', () => {
  let F: Awaited<ReturnType<typeof newFirm>>;
  beforeAll(async () => { F = await newFirm('Друга Фирма ДООЕЛ'); });

  it('a June statement is refused by the empty „6/10-12“ nalog (period 01.10 – 31.12)', async () => {
    await T((tx) => postJournal(tx, { firmId: F.firmId, date: '2026-12-31', kind: 'manual', number: '6/10-12', description: 'ИЗВОДИ',
      periodFrom: '2026-10-01', periodTo: '2026-12-31', lines: [], allowEmpty: true, userId: null }));
    const e = await err(T((tx) => saveImport(tx, { firmId: F.firmId, userId: null, statements: [halk()], book: true,
      nalog: { number: '6/10-12', from: '2026-10-01', to: '2026-12-31' } })));
    expect(e.message).toMatch(/не припаѓа во периодот на налогот 6\/10-12/);
    expect(await stLines(F.firmId)).toEqual([]);
  });

  it('preview suggestions are editable; saving posts every line into THAT nalog, dated on the statement', async () => {
    const plan = await T((tx) => planImport(tx, { firmId: F.firmId, userId: null, statements: [halk()] }));
    const S = await T((tx) => previewSuggestions(tx, F.firmId, plan));
    expect(S[lineKey(0, 0)]).toMatchObject({ konto: '4460' });
    expect(S[lineKey(0, 2)]).toMatchObject({ konto: '2349' });
    expect(S[lineKey(0, 5)]).toMatchObject({ konto: '2200', partnerId: F.alfa });
    // the user changes the contributions line to 2341 (ПИО) before saving
    const lineKonto = Object.fromEntries(Object.entries(S).map(([k, s]) => [k, { konto: s.konto, partnerId: s.partnerId ?? null, createPartner: s.newPartner ?? null }]));
    lineKonto[lineKey(0, 6)] = { konto: '2341', partnerId: null, createPartner: null };
    const r = await T((tx) => saveImport(tx, { firmId: F.firmId, userId: null, statements: [halk()], book: true, lineKonto,
      nalog: { number: '6/4-6', from: '2026-04-01', to: '2026-06-30' } }));
    expect(r.book!.skipped).toEqual([]);
    expect(r).toMatchObject({ posted: 1, drafts: 0, numbers: ['6/4-6'] });
    const [st] = await db.select().from(schema.bankStatements).where(eq(schema.bankStatements.firmId, F.firmId));
    expect(st!.meta).toMatchObject({ nalog: '6/4-6' });
    const J = (await journalsOf(F.firmId)).filter((j) => j.kind === 'bank');
    expect(J).toHaveLength(1);
    expect(J[0]).toMatchObject({ number: '6/4-6', date: '2026-06-01' });
    const JL = await linesOf(J[0]!.id);
    expect(JL).toHaveLength(16);
    expect(JL.some((l) => l.account === '2341' && l.debit === '7239.00')).toBe(true);
  });

  it('a custom nalog number is kept when the statement is re-posted', async () => {
    const F2 = await newFirm('Трета Фирма ДООЕЛ');
    const r = await T((tx) => saveImport(tx, { firmId: F2.firmId, userId: null, statements: [halk()], book: true, nalog: { number: '6-ИЗВОДИ-06', from: '2026-06-01', to: '2026-06-30' } }));
    expect(r.numbers).toEqual(['6-ИЗВОДИ-06']);
    const L = await stLines(F2.firmId);
    await T((tx) => setLineKonto(tx, { firmId: F2.firmId, userId: null, lineId: L[0]!.id, konto: '4400', learn: false }));
    const J = (await journalsOf(F2.firmId)).filter((j) => j.kind === 'bank');
    expect(J.map((j) => j.number)).toEqual(['6-ИЗВОДИ-06']);
  });
});
