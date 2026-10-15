/**
 * „Конта за изводи“ on PGlite: the own-transfer konto 10091 (default from the chart, 1009 fallback, per-firm override),
 * transfers between the main account and branch sub-accounts on both sides, the move 1009 → 10091 (open periods
 * only, daily turnover untouched), the statement journal with the bank konto once at the top (збирно) or per line,
 * FX aggregation, the bank konto of an account by its bank and „Примени и прекнижи“.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Statement, StatementLine } from '@wise/core';
import {
  bankAccountKontos, deleteStatement, loadBankEnv, moveTransitLines, repostStatementsLayout, saveBankAccount, saveBankKonta, saveImport,
  setBankAccountKonto, transitResidues, unregisteredOwnAccounts,
} from './bank/index';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
const T = <R>(f: (tx: typeof db) => Promise<R>) => db.transaction((tx) => f(tx as unknown as typeof db));
const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected an error'); };

const MAIN = '270000000000101', KUM = '270000000000202', GOS = '270000000000303', CEN = '270000000000404';
const ln = (date: string, amount: number, counterparty: string, desc: string, iban?: string): StatementLine =>
  ({ date, amount, counterparty, ref: '', purpose: desc, desc: `${counterparty} – ${desc}`, ...(iban ? { iban } : {}) });
const st = (account: string, date: string, no: string, lines: StatementLine[], extra: Partial<Statement> = {}): Statement =>
  ({ format: 'halk-xml', account, no, date, currency: 'MKD', opening: null, closing: null, debit: null, credit: null, lines, ...extra });

const firmOf = async (name: string, edb?: string) => (await db.insert(schema.firms).values({ name, ...(edb ? { edb } : {}) }).returning())[0]!.id;
const statements = (firmId: string) => db.select().from(schema.bankStatements).where(eq(schema.bankStatements.firmId, firmId)).orderBy(asc(schema.bankStatements.date));
const linesOfSt = (id: string) => db.select().from(schema.bankLines).where(eq(schema.bankLines.statementId, id)).orderBy(asc(schema.bankLines.lineNo));
const journalOf = async (stId: string) => {
  const [j] = await db.select().from(schema.journals).where(and(eq(schema.journals.sourceType, 'bank_statement'), eq(schema.journals.sourceId, stId)));
  if (!j) return null;
  const L = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j.id)).orderBy(asc(schema.journalLines.lineNo));
  return { ...j, lines: L };
};
const cents = (v: unknown) => Math.round(Number(v) * 100);
const kontoBalance = async (firmId: string, konto: string) => {
  const L = await db.select().from(schema.journalLines).where(and(eq(schema.journalLines.firmId, firmId), eq(schema.journalLines.account, konto)));
  return L.reduce((s, l) => s + cents(l.debit) - cents(l.credit), 0);
};
const accountOf = async (firmId: string, account: string) =>
  (await db.select().from(schema.bankAccounts).where(and(eq(schema.bankAccounts.firmId, firmId), eq(schema.bankAccounts.account, account))))[0]!;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
}, 60_000);

describe('own-transfer konto: default, fallback, override', () => {
  it('10091 when the chart has it; 1009 when the firm\'s chart hides it; a per-firm setting wins', async () => {
    const a = await firmOf('Прва ДООЕЛ');
    expect((await T((tx) => loadBankEnv(tx, a))).konta).toMatchObject({ transit: '10091', transitFx: '1039', dailyTurnover: '1009', cashWithdraw: '1020', customer: '1200', supplier: '2200', pos: '1200001' });
    const b = await firmOf('Втора ДООЕЛ');
    await db.insert(schema.accounts).values({ firmId: b, code: '10091', name: 'Пренос', hidden: true });
    expect((await T((tx) => loadBankEnv(tx, b))).konta.transit).toBe('1009');
    await T((tx) => saveBankKonta(tx, { firmId: a, userId: null, input: { transit: '10092', cashWithdraw: '1020' } }));
    expect((await T((tx) => loadBankEnv(tx, a))).konta).toMatchObject({ transit: '10092', cashWithdraw: '1020' });
    expect((await err(T((tx) => saveBankKonta(tx, { firmId: a, userId: null, input: { transit: '99999' } })))).message).toMatch(/99999 го нема во контниот план/);
    await T((tx) => saveBankKonta(tx, { firmId: a, userId: null, input: {} })); // empty = back to the default
    expect((await T((tx) => loadBankEnv(tx, a))).konta.transit).toBe('10091');
    const [au] = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.firmId, a), eq(schema.auditLog.action, 'bankKontaSet')));
    expect(au).toBeTruthy();
  });
});

describe('ФУЛЛАМ: transfers from three branch sub-accounts to the main account', () => {
  let firmId = '';
  beforeAll(async () => {
    firmId = await firmOf('ФУЛЛАМ ДООЕЛ СКОПЈЕ', '4030000000001');
    // an empty konto: picked by the bank — the first Halk account 100005, the next ones the „Под сметка“ analytics
    for (const [name, acc] of [['Халк главна', MAIN], ['Халк Куманово', KUM], ['Халк Гостивар', GOS], ['Халк Скопје-Центар', CEN]] as const) {
      await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name, account: acc, cur: 'MKD', konto: '' } }));
    }
    await T((tx) => saveImport(tx, { firmId, userId: null, statements: [
      st(MAIN, '2026-03-10', '201', [
        ln('2026-03-10', 100_000_00, 'ФУЛЛАМ ДООЕЛ Скопје-КУМАНОВО', 'Пренос на средства', KUM),
        ln('2026-03-10', 50_000_00, 'ФУЛЛАМ ДООЕЛ ГОСТИВАР', 'Пренос на средства'),
        ln('2026-03-10', 30_000_00, 'ФУЛЛАМ ДООЕЛ СКОПЈЕ - ЦЕНТАР', 'Пренос на средства', CEN),
        ln('2026-03-10', 20_000_00, 'ФУЛЛАМ ДООЕЛ СКОПЈЕ', 'Уплата на пазар'),
      ]),
      st(KUM, '2026-03-10', '45', [ln('2026-03-10', -100_000_00, 'ФУЛЛАМ ДООЕЛ СКОПЈЕ', 'Пренос на средства', MAIN)]),
      st(GOS, '2026-03-10', '33', [ln('2026-03-10', -50_000_00, 'Главна сметка', 'Пренос на средства ЕДБ 4030000000001')]),
      st(CEN, '2026-03-10', '12', [ln('2026-03-10', -30_000_00, 'ФУЛЛАМ ДООЕЛ СКОПЈЕ', 'Пренос на средства', MAIN)]),
    ] }));
  });

  it('each account got its own analytic konto by the bank', async () => {
    expect([(await accountOf(firmId, MAIN)).konto, (await accountOf(firmId, KUM)).konto, (await accountOf(firmId, GOS)).konto, (await accountOf(firmId, CEN)).konto])
      .toEqual(['100005', '1000051', '1000052', '1000053']);
  });

  it('every transfer line is on 10091 on both sides; the cash deposit of the takings stays on 1009', async () => {
    const S = await statements(firmId);
    const all = (await Promise.all(S.map((s) => linesOfSt(s.id)))).flat();
    expect(all.filter((l) => l.konto === '10091')).toHaveLength(6);
    expect(all.filter((l) => l.konto === '1009').map((l) => [l.name, l.auto])).toEqual([['ФУЛЛАМ ДООЕЛ СКОПЈЕ', 'turnover']]);
    expect(S.every((s) => s.status === 'posted')).toBe(true);
    expect(await kontoBalance(firmId, '10091')).toBe(0); // the transit nets to zero
    expect(await kontoBalance(firmId, '1009')).toBe(-20_000_00); // credited by the deposit
    expect(await T((tx) => transitResidues(tx, firmId, 2026))).toEqual([]);
  });

  it('each statement journal starts with ITS account konto once (Σ приливи / Σ одливи), then the counter lines', async () => {
    const S = await statements(firmId);
    const byAcc = new Map(await Promise.all(S.map(async (s) => [s.bankAccountId, await journalOf(s.id)] as const)));
    const main = byAcc.get((await accountOf(firmId, MAIN)).id)!;
    expect(main.lines.map((l) => [l.lineNo, l.account, l.debit, l.credit])).toEqual([
      [1, '100005', '200000.00', '0.00'],
      [2, '10091', '0.00', '100000.00'], [3, '10091', '0.00', '50000.00'], [4, '10091', '0.00', '30000.00'], [5, '1009', '0.00', '20000.00'],
    ]);
    expect(main.lines[0]!.note).toBe('Извод бр. 201 од 10.03.2026');
    const kum = byAcc.get((await accountOf(firmId, KUM)).id)!;
    expect(kum.lines.map((l) => [l.account, l.debit, l.credit])).toEqual([['1000051', '0.00', '100000.00'], ['10091', '100000.00', '0.00']]);
  });

  it('the transit residue check uses 10091', async () => {
    await T((tx) => saveImport(tx, { firmId, userId: null, statements: [
      st(MAIN, '2026-03-20', '210', [ln('2026-03-20', 10_000_00, 'ФУЛЛАМ ДООЕЛ Скопје-КУМАНОВО', 'Пренос на средства', KUM)]),
      st(KUM, '2026-03-20', '46', [ln('2026-03-20', -10_000_50, 'ФУЛЛАМ ДООЕЛ СКОПЈЕ', 'Пренос на средства', MAIN)]),
    ] }));
    expect(await T((tx) => transitResidues(tx, firmId, 2026))).toEqual([{ konto: '10091', date: '2026-03-20', residue: 0.5 }]);
  });

  it('an own account not registered (recognised by name) is offered for registration', async () => {
    await T((tx) => saveImport(tx, { firmId, userId: null, statements: [st(MAIN, '2026-03-25', '215', [ln('2026-03-25', 5_000_00, 'ФУЛЛАМ ДООЕЛ ТЕТОВО', 'Пренос на средства', '270000000000909')])] }));
    expect(await T((tx) => unregisteredOwnAccounts(tx, firmId))).toEqual([{ account: '270000000000909', lines: 1, name: 'ФУЛЛАМ ДООЕЛ ТЕТОВО' }]);
  });
});

describe('„↻ Префрли постоечки ставки 1009 → 10091“', () => {
  it('moves only own-transfer lines, re-posts only open periods, leaves the daily turnover on 1009', async () => {
    const firmId = await firmOf('МОВЕ ДООЕЛ');
    await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Халк', account: MAIN, cur: 'MKD', konto: '100005' } }));
    await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Халк подсметка', account: KUM, cur: 'MKD', konto: '1000051' } }));
    // as before the change: transfers on 1009
    await T((tx) => saveBankKonta(tx, { firmId, userId: null, input: { transit: '1009' } }));
    await T((tx) => saveImport(tx, { firmId, userId: null, statements: [
      st(MAIN, '2026-01-15', '5', [ln('2026-01-15', 1_000_00, 'МОВЕ ДООЕЛ КУМАНОВО', 'Пренос', KUM)]),
      st(MAIN, '2026-02-10', '9', [ln('2026-02-10', 2_000_00, 'МОВЕ ДООЕЛ КУМАНОВО', 'Пренос', KUM), ln('2026-02-10', 3_000_00, 'МОВЕ ДООЕЛ', 'Уплата на пазар')]),
      st(KUM, '2026-02-10', '3', [ln('2026-02-10', -2_000_00, 'МОВЕ ДООЕЛ', 'Пренос', MAIN)]),
    ] }));
    const all0 = (await Promise.all((await statements(firmId)).map((s) => linesOfSt(s.id)))).flat();
    expect(all0.filter((l) => l.konto === '1009')).toHaveLength(4);
    await T((tx) => saveBankKonta(tx, { firmId, userId: null, input: {} })); // back to the default 10091
    await db.update(schema.firms).set({ lockDate: '2026-01-31' }).where(eq(schema.firms.id, firmId));
    const dry = await T((tx) => moveTransitLines(tx, { firmId, userId: null, year: 2026, dry: true }));
    expect(dry).toMatchObject({ from: '1009', to: '10091', lines: 2, statements: 2 });
    expect(dry.items.map((i) => [i.date, i.skipped])).toEqual([['2026-01-15', true], ['2026-02-10', false], ['2026-02-10', false]]);
    expect((await Promise.all((await statements(firmId)).map((s) => linesOfSt(s.id)))).flat().filter((l) => l.konto === '10091')).toHaveLength(0); // dry: nothing written
    const r = await T((tx) => moveTransitLines(tx, { firmId, userId: null, year: 2026 }));
    expect(r).toMatchObject({ lines: 2, statements: 2 });
    expect(r.skipped.map((s) => [s.number, s.date])).toEqual([['5', '2026-01-15']]);
    const S = await statements(firmId);
    const L = Object.fromEntries(await Promise.all(S.map(async (s) => [s.number!, (await linesOfSt(s.id)).map((l) => l.konto)] as const)));
    expect(L).toEqual({ 5: ['1009'], 9: ['10091', '1009'], 3: ['10091'] });
    // re-posted: the open statement's journal is on 10091, the locked one untouched
    expect((await journalOf(S.find((s) => s.number === '9')!.id))!.lines.map((l) => l.account)).toEqual(['100005', '10091', '1009']);
    expect((await journalOf(S.find((s) => s.number === '5')!.id))!.lines.map((l) => l.account)).toEqual(['100005', '1009']);
    expect(await kontoBalance(firmId, '10091')).toBe(0);
    const [au] = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.firmId, firmId), eq(schema.auditLog.action, 'bankTransitMove')));
    expect(au!.data).toMatchObject({ from: '1009', to: '10091', lines: 2, skipped: 1 });
  });
});

describe('statement journal layout', () => {
  let firmId = '';
  let stId = '';
  beforeAll(async () => {
    firmId = await firmOf('ЛЕЈАУТ ДООЕЛ');
    await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Комерцијална', account: '300000000123420', cur: 'MKD', konto: '' } }));
    await T((tx) => saveImport(tx, { firmId, userId: null, statements: [st('300000000123420', '2026-04-02', '17', [
      ln('2026-04-02', 1_500_00, 'ЛЕЈАУТ ДООЕЛ', 'Уплата на пазар'),
      ln('2026-04-02', 700_00, 'ЛЕЈАУТ ДООЕЛ', 'Уплата дневен промет'),
      ln('2026-04-02', -300_00, 'ЛЕЈАУТ ДООЕЛ', 'Подигање готовина'),
      ln('2026-04-02', -45_50, 'ЛЕЈАУТ ДООЕЛ', 'Подигнување на готовина за материјални трошоци'),
    ])] }));
    stId = (await statements(firmId))[0]!.id;
  });

  it('„збирно“ (default): line 1 bank D = Σ приливи, line 2 bank P = Σ одливи, then every counter line', async () => {
    expect((await accountOf(firmId, '300000000123420')).konto).toBe('100002'); // 300 → Комерцијална
    const j = (await journalOf(stId))!;
    expect(j.lines.map((l) => [l.lineNo, l.account, l.debit, l.credit])).toEqual([
      [1, '100002', '2200.00', '0.00'], [2, '100002', '0.00', '345.50'],
      [3, '1009', '0.00', '1500.00'], [4, '1009', '0.00', '700.00'], [5, '1020', '300.00', '0.00'], [6, '1020', '45.50', '0.00'],
    ]);
    expect(await kontoBalance(firmId, '100002')).toBe(2200_00 - 345_50);
  });

  it('„по ставка“ gives the old layout with the same bank konto balance; back to „збирно“ by the re-post button', async () => {
    const before = await kontoBalance(firmId, '100002');
    await T((tx) => saveBankKonta(tx, { firmId, userId: null, input: {}, layout: 'line' }));
    const r = await T((tx) => repostStatementsLayout(tx, { firmId, userId: null, year: 2026 }));
    expect(r).toMatchObject({ layout: 'line', statements: 1, linesBefore: 6, linesAfter: 8, skipped: [] });
    const j = (await journalOf(stId))!;
    expect(j.lines.map((l) => l.account)).toEqual(['100002', '1009', '100002', '1009', '1020', '100002', '1020', '100002']);
    expect(await kontoBalance(firmId, '100002')).toBe(before);
    await T((tx) => saveBankKonta(tx, { firmId, userId: null, input: {}, layout: 'sum' }));
    expect(await T((tx) => repostStatementsLayout(tx, { firmId, userId: null, year: 2026 }))).toMatchObject({ layout: 'sum', linesBefore: 8, linesAfter: 6 });
    expect(await kontoBalance(firmId, '100002')).toBe(before);
    expect((await journalOf(stId))!.number).toBe(j.number); // same nalog number, same link to the statement
  });

  it('the re-post skips a locked period and reports it', async () => {
    await db.update(schema.firms).set({ lockDate: '2026-04-30' }).where(eq(schema.firms.id, firmId));
    const r = await T((tx) => repostStatementsLayout(tx, { firmId, userId: null, year: 2026 }));
    expect(r).toMatchObject({ statements: 0, skipped: [{ number: '17', date: '2026-04-02' }] });
    await db.update(schema.firms).set({ lockDate: null }).where(eq(schema.firms.id, firmId));
  });

  it('deleting the statement removes the whole journal', async () => {
    await T((tx) => deleteStatement(tx, { firmId, userId: null, statementId: stId }));
    expect(await journalOf(stId)).toBeNull();
    expect(await kontoBalance(firmId, '100002')).toBe(0);
  });

  it('FX: the bank konto per currency, Σ amount_cur and Σ of the lines\' MKD amounts — exactly balanced', async () => {
    const f = await firmOf('ДЕВИЗИ ДООЕЛ');
    await T((tx) => saveBankAccount(tx, { firmId: f, userId: null, input: { name: 'Халк EUR', iban: 'MK07270000000999999', cur: 'EUR', konto: '1030' } }));
    await T((tx) => saveImport(tx, { firmId: f, userId: null, statements: [st('', '2026-05-05', '4', [
      ln('2026-05-05', 33_33, 'ДЕВИЗИ ДООЕЛ', 'Пренос'), ln('2026-05-05', 33_33, 'ДЕВИЗИ ДООЕЛ', 'Пренос'), ln('2026-05-05', 33_33, 'ДЕВИЗИ ДООЕЛ', 'Пренос'),
      ln('2026-05-05', -10_01, 'ДЕВИЗИ ДООЕЛ', 'Пренос'),
    ], { iban: 'MK07270000000999999', currency: 'EUR', rate: 61.4953 })] }));
    const [s] = await statements(f);
    const L = await linesOfSt(s!.id);
    const j = (await journalOf(s!.id))!;
    const bank = j.lines.filter((l) => l.account === '1030');
    expect(bank.map((l) => [l.lineNo, l.currency])).toEqual([[1, 'EUR'], [2, 'EUR']]);
    expect(cents(bank[0]!.amountCur)).toBe(99_99);
    expect(cents(bank[1]!.amountCur)).toBe(10_01);
    expect(cents(bank[0]!.debit)).toBe(L.filter((l) => Number(l.amount) > 0).reduce((x, l) => x + cents(l.amount), 0));
    expect(cents(bank[1]!.credit)).toBe(-L.filter((l) => Number(l.amount) < 0).reduce((x, l) => x + cents(l.amount), 0));
    expect(j.lines.reduce((x, l) => x + cents(l.debit) - cents(l.credit), 0)).toBe(0);
  });
});

describe('bank konto of each account', () => {
  it('an unknown bank code gets 1000', async () => {
    const f = await firmOf('НЕПОЗНАТА БАНКА ДООЕЛ');
    await T((tx) => saveBankAccount(tx, { firmId: f, userId: null, input: { name: 'Непозната', account: '999000000000123', cur: 'MKD', konto: '' } }));
    expect((await accountOf(f, '999000000000123')).konto).toBe('1000');
  });

  it('import: an auto-created Halk account gets 100005, the next one 1000051', async () => {
    const f = await firmOf('АВТО ДООЕЛ');
    await T((tx) => saveImport(tx, { firmId: f, userId: null, statements: [
      st('270077299520174', '2026-02-02', '1', [ln('2026-02-02', -100_00, 'Халкбанк', 'Подигање готовина')]),
      st('270077299520271', '2026-02-02', '1', [ln('2026-02-02', -100_00, 'Халкбанк', 'Подигање готовина')]),
    ] }));
    expect([(await accountOf(f, '270077299520174')).konto, (await accountOf(f, '270077299520271')).konto]).toEqual(['100005', '1000051']);
  });

  it('a generic 1000 gets a suggestion; „Примени и прекнижи“ sets it as manual and re-posts only open periods', async () => {
    const f = await firmOf('ПРОД ДООЕЛ');
    // as in production: an account auto-created earlier on 1000
    const [a] = await db.insert(schema.bankAccounts).values({ firmId: f, name: 'Банка 270077299520174', account: '270077299520174', cur: 'MKD', konto: '1000' }).returning();
    await T((tx) => saveImport(tx, { firmId: f, userId: null, statements: [
      st('270077299520174', '2026-01-20', '3', [ln('2026-01-20', -100_00, 'Халкбанк', 'Подигање готовина')]),
      st('270077299520174', '2026-02-20', '7', [ln('2026-02-20', -200_00, 'Халкбанк', 'Подигање готовина')]),
    ] }));
    const K0 = await T((tx) => bankAccountKontos(tx, f));
    expect(K0[0]).toMatchObject({ konto: '1000', manual: false, suggest: { konto: '100005', name: 'Жиро сметка халк банка' } });
    await db.update(schema.firms).set({ lockDate: '2026-01-31' }).where(eq(schema.firms.id, f));
    const r = await T((tx) => setBankAccountKonto(tx, { firmId: f, userId: null, accountId: a!.id, konto: '100005' }));
    expect(r).toMatchObject({ from: '1000', to: '100005', statements: 1, skipped: [{ number: '3', date: '2026-01-20' }] });
    const S = await statements(f);
    expect((await journalOf(S[0]!.id))!.lines.map((l) => l.account)).toEqual(['1000', '1020']); // locked: untouched
    expect((await journalOf(S[1]!.id))!.lines.map((l) => l.account)).toEqual(['100005', '1020']);
    // manual from now on: no suggestion, never changed automatically
    expect((await T((tx) => bankAccountKontos(tx, f)))[0]).toMatchObject({ konto: '100005', manual: true });
    expect((await T((tx) => bankAccountKontos(tx, f)))[0]!.suggest).toBeUndefined();
    expect((await err(T((tx) => setBankAccountKonto(tx, { firmId: f, userId: null, accountId: a!.id, konto: '99999' })))).message).toMatch(/го нема во контниот план/);
  });

  it('a konto typed by hand on the bank account list is manual and re-posts the account\'s statements (open periods)', async () => {
    const f = await firmOf('РАЧНО ДООЕЛ');
    const id = await T((tx) => saveBankAccount(tx, { firmId: f, userId: null, input: { name: 'Халк', account: '270077299520174', cur: 'MKD', konto: '' } }));
    expect((await T((tx) => bankAccountKontos(tx, f)))[0]).toMatchObject({ konto: '100005', manual: false });
    await T((tx) => saveImport(tx, { firmId: f, userId: null, statements: [st('270077299520174', '2026-02-20', '7', [ln('2026-02-20', -200_00, 'Халкбанк', 'Подигање готовина')])] }));
    const report: { repost?: { statements: number } } = {};
    await T((tx) => saveBankAccount(tx, { firmId: f, userId: null, report: report as never, input: { id, name: 'Халк', account: '270077299520174', cur: 'MKD', konto: '1000052' } }));
    expect(report.repost).toMatchObject({ statements: 1 });
    expect((await T((tx) => bankAccountKontos(tx, f)))[0]).toMatchObject({ konto: '1000052', manual: true });
    const [s] = await statements(f);
    expect((await journalOf(s!.id))!.lines[0]!.account).toBe('1000052');
  });
});
