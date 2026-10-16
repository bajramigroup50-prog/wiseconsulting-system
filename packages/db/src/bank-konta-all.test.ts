/**
 * „🏦 Примени за сите фирми“ on PGlite: the preview for three firms (a moved bank konto + own transfers + a statement
 * still per line; a manual konto left alone; a locked period), apply only the ticked firms / steps, a forced failure
 * and a broken total roll back only that firm, the trial balance unchanged except the intended moves, the worker run
 * with progress, demo firms excluded, and a second run that does nothing.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, asc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Statement, StatementLine } from '@wise/core';
import {
  applyFirmBankKontaAll, bankKontaAllPlan, bankKontaAllRun, planFirmBankKonta, putBankKontaAllRun, runBankKontaAllJob, saveBankAccount, saveBankKonta,
  saveImport, setBankAccountKonto,
} from './bank/index';
import type { Tx } from './audit';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
const X = db as unknown as Tx;
const T = <R>(f: (tx: typeof db) => Promise<R>) => db.transaction((tx) => f(tx as unknown as typeof db));

const HALK = '270077299520174', KOM = '300000000123420';
const ln = (date: string, amount: number, counterparty: string, desc: string): StatementLine =>
  ({ date, amount, counterparty, ref: '', purpose: desc, desc: `${counterparty} – ${desc}` });
const st = (account: string, date: string, no: string, lines: StatementLine[]): Statement =>
  ({ format: 'halk-xml', account, no, date, currency: 'MKD', opening: null, closing: null, debit: null, credit: null, lines });
const firmOf = async (name: string, settings?: Record<string, unknown>) => (await db.insert(schema.firms).values({ name, ...(settings ? { settings } : {}) }).returning())[0]!.id;
const genericAccount = async (firmId: string, name: string, account: string) =>
  (await db.insert(schema.bankAccounts).values({ firmId, name, account, cur: 'MKD', konto: '1000' }).returning())[0]!.id;
const acc = async (id: string) => (await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, id)))[0]!;
const cents = (v: unknown) => Math.round(Number(v) * 100);
/** Trial balance of a firm: konto → [debit, credit] in cents. */
const tb = async (firmId: string) => {
  const R = await db.select({ a: schema.journalLines.account, d: sql<string>`sum(${schema.journalLines.debit})`, c: sql<string>`sum(${schema.journalLines.credit})` })
    .from(schema.journalLines).where(eq(schema.journalLines.firmId, firmId)).groupBy(schema.journalLines.account);
  return Object.fromEntries(R.map((r) => [r.a, [cents(r.d), cents(r.c)]])) as Record<string, [number, number]>;
};
/** Every journal line of a firm (to prove „untouched“). */
const dump = async (firmId: string) => (await db.select().from(schema.journalLines).where(eq(schema.journalLines.firmId, firmId)).orderBy(asc(schema.journalLines.id)))
  .map((l) => `${l.id}|${l.account}|${l.debit}|${l.credit}`);
const auditN = async (firmId: string, action = 'bankKontaAll') =>
  (await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.firmId, firmId), eq(schema.auditLog.action, action)))).length;

let A = '', B = '', C = '', D = '';
let aHalk = '', bHalk = '', cHalk = '', aKom = '';

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);

  // A: Halk still on 1000 with an own transfer and a takings deposit on 1009 (as before 10091); Комерцијална posted per line
  A = await firmOf('АЛФА ДООЕЛ');
  aHalk = await genericAccount(A, 'Халк', HALK);
  aKom = await T((tx) => saveBankAccount(tx, { firmId: A, userId: null, input: { name: 'Комерцијална', account: KOM, cur: 'MKD', konto: '' } }));
  await T((tx) => saveBankKonta(tx, { firmId: A, userId: null, input: { transit: '1009' }, layout: 'line' }));
  await T((tx) => saveImport(tx, { firmId: A, userId: null, statements: [
    st(HALK, '2026-03-02', '11', [ln('2026-03-02', 5_000_00, 'АЛФА ДООЕЛ КУМАНОВО', 'Пренос на средства'), ln('2026-03-02', 2_000_00, 'АЛФА ДООЕЛ', 'Уплата на пазар')]),
    st(KOM, '2026-03-03', '4', [ln('2026-03-03', 3_000_00, 'АЛФА ДООЕЛ', 'Уплата на пазар'), ln('2026-03-03', -1_000_00, 'АЛФА ДООЕЛ', 'Подигање готовина')]),
  ] }));
  await T((tx) => saveBankKonta(tx, { firmId: A, userId: null, input: {}, layout: 'sum' })); // back to 10091 / збирно, not re-posted

  // B: the Halk konto confirmed BY HAND on 1000 (manual: never changed)
  B = await firmOf('БЕТА ДООЕЛ');
  bHalk = await genericAccount(B, 'Халк', HALK);
  await T((tx) => saveImport(tx, { firmId: B, userId: null, statements: [st(HALK, '2026-03-05', '1', [ln('2026-03-05', -400_00, 'Халкбанк', 'Подигање готовина')])] }));
  await T((tx) => setBankAccountKonto(tx, { firmId: B, userId: null, accountId: bHalk, konto: '1000' }));

  // C: Halk on 1000, January locked
  C = await firmOf('ГАМА ДООЕЛ');
  cHalk = await genericAccount(C, 'Халк', HALK);
  await T((tx) => saveImport(tx, { firmId: C, userId: null, statements: [
    st(HALK, '2026-01-20', '3', [ln('2026-01-20', -100_00, 'Халкбанк', 'Подигање готовина')]),
    st(HALK, '2026-02-20', '7', [ln('2026-02-20', -200_00, 'Халкбанк', 'Подигање готовина')]),
  ] }));
  await db.update(schema.firms).set({ lockDate: '2026-01-31' }).where(eq(schema.firms.id, C));

  // D: a demo firm with the same situation — never listed, never touched
  D = await firmOf('ДЕМО ТРГОВИЈА ДООЕЛ', { demo: true });
  await genericAccount(D, 'Халк', HALK);
  await T((tx) => saveImport(tx, { firmId: D, userId: null, statements: [st(HALK, '2026-03-05', '1', [ln('2026-03-05', -400_00, 'Халкбанк', 'Подигање готовина')])] }));
}, 120_000);

describe('preview (nothing written)', () => {
  it('lists the right changes for the three firms; the demo firm is not listed', async () => {
    const before = await Promise.all([A, B, C, D].map(dump));
    const P = await bankKontaAllPlan(X, { year: 2026 });
    expect(P.map((p) => p.name)).toEqual(['АЛФА ДООЕЛ', 'БЕТА ДООЕЛ', 'ГАМА ДООЕЛ']);
    const [a, b, c] = P;
    expect(a!.accounts).toEqual([expect.objectContaining({ id: aHalk, from: '1000', to: '100005', toName: 'Жиро сметка халк банка', statements: 1 })]);
    expect(a!.transit).toEqual({ from: '1009', to: '10091', lines: 1, statements: 1 });
    expect(a!.layout).toMatchObject({ layout: 'sum', statements: 2 }); // both statements were posted per line
    expect(a!.locked).toEqual({ konto: [], transit: [], layout: [] });
    // B: the manual konto stays (no move); its statement is already „збирно“
    expect(b).toMatchObject({ accounts: [], manual: 1, transit: { lines: 0 }, layout: { statements: 0 } });
    // C: the move is listed with the open statement; the January one is skipped (locked)
    expect(c!.accounts).toEqual([expect.objectContaining({ from: '1000', to: '100005', statements: 1 })]);
    expect(c!.locked.konto).toHaveLength(1);
    expect(c!.lockedWhy[0]).toMatch(/заклучен/);
    expect(await Promise.all([A, B, C, D].map(dump))).toEqual(before);
  });
});

describe('apply', () => {
  it('a forced failure in one firm leaves the others applied and that firm untouched', async () => {
    const c0 = await dump(C);
    const ra = await applyFirmBankKontaAll(X, { firmId: A, userId: null, year: 2026, steps: ['konto', 'transit'] });
    const rc = await applyFirmBankKontaAll(X, { firmId: C, userId: null, year: 2026, steps: ['konto', 'transit'], hook: async () => { throw new Error('намерна грешка'); } });
    expect(ra).toMatchObject({ status: 'done', accounts: [{ from: '1000', to: '100005' }], transitLines: 1 });
    expect(rc).toMatchObject({ status: 'error', reason: 'намерна грешка' });
    expect(await dump(C)).toEqual(c0);
    expect((await acc(cHalk)).konto).toBe('1000');
    expect(await auditN(C)).toBe(1); // the error is audited too
  });

  it('a total that changes unexpectedly rolls the firm back with an error', async () => {
    const c0 = await dump(C);
    const r = await applyFirmBankKontaAll(X, { firmId: C, userId: null, year: 2026, steps: ['konto'], hook: async (tx, firmId) => {
      await tx.update(schema.journalLines).set({ debit: '999.00' }).where(and(eq(schema.journalLines.firmId, firmId), eq(schema.journalLines.account, '1020')));
    } });
    expect(r.status).toBe('error');
    expect(r.reason).toMatch(/Збировите не се исти.*1020/);
    expect(await dump(C)).toEqual(c0);
  });

  it('only the ticked firms and steps changed; the trial balance moved only 1000 → 100005 and 1009 → 10091', async () => {
    // B was not ticked: untouched; A: the per-line Комерцијална statement is still to re-post (step 3 not ticked)
    expect((await acc(bHalk)).konto).toBe('1000');
    const pa = await T((tx) => planFirmBankKonta(tx as unknown as Tx, A, 2026));
    expect(pa).toMatchObject({ accounts: [], transit: { lines: 0 }, layout: { statements: 1 } });
    expect((await acc(aHalk)).konto).toBe('100005');
    expect((await acc(aKom)).konto).toBe('100002');
    const t = await tb(A);
    expect(t['1000']).toBeUndefined();
    expect(t['100005']).toEqual([7_000_00, 0]);
    expect(t['10091']).toEqual([0, 5_000_00]);
    expect(t['1009']).toEqual([0, 5_000_00]); // the two takings deposits (2 000 + 3 000) stay on 1009
  });

  it('step 3 alone re-posts the per-line statement „збирно“ with the same trial balance', async () => {
    const t0 = await tb(A);
    const r = await applyFirmBankKontaAll(X, { firmId: A, userId: null, year: 2026, steps: ['layout'] });
    expect(r).toMatchObject({ status: 'done', layoutStatements: 1, accounts: [], transitLines: 0 });
    expect(await tb(A)).toEqual(t0);
    const [s] = await db.select().from(schema.bankStatements).where(and(eq(schema.bankStatements.firmId, A), eq(schema.bankStatements.number, '4')));
    const [j] = await db.select().from(schema.journals).where(eq(schema.journals.sourceId, s!.id));
    const L = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j!.id)).orderBy(asc(schema.journalLines.lineNo));
    expect(L.map((l) => l.account)).toEqual(['100002', '100002', '1009', '1020']);
  });
});

describe('the worker run (progress, demo excluded) and a second run', () => {
  it('runs firm by firm with progress; demo firm skipped; locked statements reported', async () => {
    const d0 = await dump(D);
    const c0 = await tb(C);
    const runId = 'r1';
    await putBankKontaAllRun(X, { runId, status: 'queued', userId: null, year: 2026, steps: ['konto', 'transit', 'layout'], firmIds: [A, B, C, D], total: 4, done: 0, results: [], at: new Date().toISOString() });
    expect(await runBankKontaAllJob(X, runId)).toBe(true);
    const s = (await bankKontaAllRun(X))!;
    expect(s).toMatchObject({ status: 'done', done: 4, total: 4 });
    expect(s.results.map((r) => [r.name || r.firmId, r.status])).toEqual([['АЛФА ДООЕЛ', 'skipped'], ['БЕТА ДООЕЛ', 'skipped'], ['ГАМА ДООЕЛ', 'done'], [D, 'skipped']]);
    expect(s.results[2]).toMatchObject({ accounts: [{ from: '1000', to: '100005' }], locked: 1 });
    expect(s.results[3]!.reason).toMatch(/демо/);
    expect(await dump(D)).toEqual(d0);
    // C: the open statement moved to 100005, the locked January one stays on 1000 — the sum is the same
    const c1 = await tb(C);
    expect(c1['1000']).toEqual([0, 100_00]);
    expect(c1['100005']).toEqual([0, 200_00]);
    expect(c1['1020']).toEqual(c0['1020']);
    // the same job id again: nothing
    expect(await runBankKontaAllJob(X, runId)).toBe(false);
  });

  it('running it twice does nothing the second time', async () => {
    const before = await Promise.all([A, B, C].map(dump));
    const audits = await Promise.all([A, B, C].map((f) => auditN(f)));
    for (const f of [A, B, C]) {
      const r = await applyFirmBankKontaAll(X, { firmId: f, userId: null, year: 2026, steps: ['konto', 'transit', 'layout'] });
      expect(r.status).toBe('skipped');
    }
    expect(await Promise.all([A, B, C].map(dump))).toEqual(before);
    expect(await Promise.all([A, B, C].map((f) => auditN(f)))).toEqual(audits);
    const P = await bankKontaAllPlan(X, { year: 2026 });
    expect(P.every((p) => !p.accounts.length && !p.transit.lines && !p.layout.statements)).toBe(true);
  });

  it('a demo firm asked directly is refused', async () => {
    expect(await applyFirmBankKontaAll(X, { firmId: D, userId: null, year: 2026, steps: ['konto'] })).toMatchObject({ status: 'skipped', reason: 'демо фирма' });
  });
});
