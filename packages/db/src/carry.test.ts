/**
 * Year transfer on PGlite: a year with sales, purchases, bank, cash, payroll, fixed assets, loans and advances across
 * several partners → close → the next year's opening equals the closing balances konto by konto and partner by
 * partner (and per document when enabled); classes 4/7 are not carried, the result goes to 950; the evidence lists
 * the rows that are not carried with the reason; re-running is idempotent; a later change + re-close updates it.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { trialBalance } from '@wise/core';
import { loadLedgerLines } from './ledger-queries';
import { postJournal, type PostJournalInput } from './posting';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { carryStatPrefixesFor, carryState, closeYear, openNextYear, prevYearCarry, YE_SOURCE } from './yearend';

const db = drizzle(new PGlite(), { schema });
const act = { userId: null, today: '2027-02-15' };
let firmId = '';
const p: Record<string, string> = {};
let loc = '';

const P = (date: string, kind: string, lines: PostJournalInput['lines']) =>
  db.transaction((tx) => postJournal(tx, { firmId, date, kind, userId: null, lines }));

/** debit − credit per account|partner|location of a set of lines, classes 0,1,2,3,6,9 without the result accounts */
const balancesOf = (L: { account: string; debit: number; credit: number; partnerId?: string | null; locationId?: string | null }[]) => {
  const m = new Map<string, number>();
  for (const l of L) {
    if (!/^[012369]/.test(l.account) || /^9[56]/.test(l.account) || /^99[49]/.test(l.account)) continue;
    const k = [l.account, l.partnerId ?? '', l.locationId ?? ''].join('|');
    m.set(k, Math.round(((m.get(k) ?? 0) + l.debit - l.credit) * 100) / 100);
  }
  for (const [k, v] of m) if (!v) m.delete(k);
  return m;
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Пренос ДОО', legalForm: 'doo', embs: '7000009', activity: '46.90' }).returning();
  firmId = f!.id;
  for (const [k, name, active] of [['K1', 'Купувач 1', true], ['K2', 'Купувач 2', true], ['S1', 'Добавувач 1', true], ['S2', 'Стар добавувач', false], ['BANK', 'Банка', true]] as const) {
    const [r] = await db.insert(schema.partners).values({ firmId, name, active }).returning();
    p[k] = r!.id;
  }
  const [c] = await db.insert(schema.codes).values({ firmId, cb: 'location', code: 'M1', name: 'Магацин 1' }).returning();
  loc = c!.id;
  await db.transaction((tx) => postJournal(tx, {
    firmId, date: '2026-01-01', kind: 'open', userId: null, sourceType: YE_SOURCE.open.type, sourceId: YE_SOURCE.open.id(2026),
    lines: [{ account: '100005', debit: 100_000 }, { account: '9000', credit: 90_000 }, { account: '950', credit: 10_000 }],
  }));
  // sales
  await P('2026-02-10', 'izlez', [
    { account: '1200', debit: 118_000, partnerId: p.K1, doc: 'F-1' }, { account: '7400', credit: 100_000 }, { account: '230018', credit: 18_000 },
    // the VAT-base memo lines of the invoice (class 9 statistical accounts, posted by the VAT scheme)
    { account: '994018', debit: 100_000 }, { account: '999018', credit: 100_000 },
  ]);
  await P('2026-02-12', 'izlez', [{ account: '1200', debit: 59_000, partnerId: p.K2, doc: 'F-2' }, { account: '7400', credit: 50_000 }, { account: '230018', credit: 9_000 }]);
  // bank: K2 pays in full, K1 partly
  await P('2026-03-01', 'bank', [{ account: '100005', debit: 59_000 }, { account: '1200', credit: 59_000, partnerId: p.K2, doc: 'F-2' }]);
  await P('2026-03-02', 'bank', [{ account: '100005', debit: 18_000 }, { account: '1200', credit: 18_000, partnerId: p.K1, doc: 'F-1' }]);
  // purchase, material used
  await P('2026-03-05', 'vlez', [{ account: '3100', debit: 40_000 }, { account: '1300', debit: 7_200 }, { account: '2200', credit: 47_200, partnerId: p.S1, doc: 'В-1' }]);
  await P('2026-04-01', 'manual', [{ account: '4000', debit: 30_000 }, { account: '3100', credit: 30_000 }]);
  // cash
  await P('2026-04-02', 'kasa', [{ account: '1020', debit: 5_000 }, { account: '100005', credit: 5_000 }]);
  // payroll and its payment
  await P('2026-04-30', 'plati', [{ account: '4200', debit: 30_000 }, { account: '2400', credit: 30_000 }]);
  await P('2026-05-05', 'bank', [{ account: '2400', debit: 30_000 }, { account: '100005', credit: 30_000 }]);
  // fixed asset at a location + depreciation
  await P('2026-05-10', 'vlez', [{ account: '0134', debit: 60_000, locationId: loc }, { account: '2200', credit: 60_000, partnerId: p.S1, doc: 'В-2' }]);
  await P('2026-12-31', 'manual', [{ account: '4302', debit: 6_000 }, { account: '0193', credit: 6_000, locationId: loc }]);
  // loans (received from the bank, given to K1) and an advance received from K2
  await P('2026-06-01', 'bank', [{ account: '100005', debit: 200_000 }, { account: '2630', credit: 200_000, partnerId: p.BANK }]);
  await P('2026-06-02', 'bank', [{ account: '0330', debit: 20_000, partnerId: p.K1 }, { account: '100005', credit: 20_000 }]);
  await P('2026-06-03', 'bank', [{ account: '100005', debit: 10_000 }, { account: '2270', credit: 10_000, partnerId: p.K2 }]);
  // an inactive supplier still owed
  await P('2026-07-01', 'vlez', [{ account: '4400', debit: 1_000 }, { account: '2200', credit: 1_000, partnerId: p.S2 }]);
}, 120_000);

describe('year transfer (close → Почетна состојба of the next year)', () => {
  it('before the close: the next year reports the previous year as not closed', async () => {
    expect(await db.transaction((tx) => prevYearCarry(tx, firmId, 2027))).toEqual({ prevHasData: true, prevClosed: false, opened: false });
    const s = await db.transaction((tx) => carryState(tx, firmId, 2026));
    expect(s.evidence.rows.filter((r) => r.carried).every((r) => r.status === 'missing')).toBe(true);
  });

  it('closing the year carries every konto and partner into 01.01.2027', async () => {
    const r = await db.transaction((tx) => closeYear(tx, { firmId, year: 2026, ...act }));
    expect(r.carryError).toBeNull();
    expect(r.carry?.journal.number).toBe('0');
    const old = await loadLedgerLines(db, firmId, '2026-01-01', '2026-12-31');
    const neu = await loadLedgerLines(db, firmId, '2027-01-01', '2027-12-31');
    expect(neu.every((l) => l.kind === 'open' && l.date === '2027-01-01')).toBe(true);
    // konto + partner + location identical, result accounts aside
    expect(balancesOf(neu)).toEqual(balancesOf(old));
    const line = (a: string, pid?: string) => neu.filter((l) => l.account === a && (pid === undefined || l.partnerId === pid));
    expect(line('1200', p.K1).map((l) => l.debit)).toEqual([100_000]);
    expect(line('1200', p.K2)).toEqual([]);
    expect(line('2200', p.S1).map((l) => l.credit)).toEqual([107_200]);
    expect(line('2630', p.BANK).map((l) => l.credit)).toEqual([200_000]); // loan per partner
    expect(line('0330', p.K1).map((l) => l.debit)).toEqual([20_000]); // loan given per partner
    expect(line('2270', p.K2).map((l) => l.credit)).toEqual([10_000]); // advance per partner
    expect(line('0134').map((l) => l.locationId)).toEqual([loc]);
    expect(neu.some((l) => /^[4578]/.test(l.account))).toBe(false);
    expect(neu.some((l) => /^99[49]/.test(l.account))).toBe(false); // statistical VAT bases are not balances
    expect(line('951')).toEqual([]);
    // 950 = 10 000 retained + the 2026 net result
    const net = Number(r.plan.net);
    expect(line('950').reduce((s, l) => s + l.credit - l.debit, 0)).toBeCloseTo(10_000 + net, 2);
    const tb = trialBalance(neu, { level: 'a', from: '2027-01-01', to: '2027-12-31' });
    expect(tb.balanced).toBe(true);
    expect(await db.transaction((tx) => prevYearCarry(tx, firmId, 2027))).toMatchObject({ prevClosed: true, opened: true });
  });

  it('the evidence: closing = opening, assets = liabilities, non-carried rows with the reason', async () => {
    const s = await db.transaction((tx) => carryState(tx, firmId, 2026));
    const E = s.evidence;
    expect(E.totals.ok).toBe(true);
    expect(E.totals.closingDebit).toBe(E.totals.openingDebit);
    expect(E.totals.openingAssets).toBe(E.totals.openingLiabilities);
    expect(E.missing).toBe(0);
    const why = (a: string, pid?: string) => E.rows.find((r) => r.account === a && (pid === undefined || r.partnerId === pid))?.reason ?? '';
    expect(why('7400')).toMatch(/класа 7/);
    expect(why('4000')).toMatch(/класа 4/);
    expect(why('8000')).toMatch(/класа 8/);
    expect(why('1200', p.K2)).toMatch(/нулто салдо/);
    expect(why('994018')).toBe('статистичка сметка (основица за ДДВ) – не се пренесува');
    const rule = (a: string, pid?: string) => E.rows.find((r) => r.account === a && (pid === undefined || r.partnerId === pid))?.rule;
    expect([rule('994018'), rule('999018'), rule('7400'), rule('1200', p.K2), rule('1200', p.K1)]).toEqual(['stat', 'stat', 'class', 'zero', null]);
    expect(s.statPrefixes).toEqual(['994', '999']);
    expect(why('2200', p.S2)).toMatch(/неактивен/);
    expect(E.rows.find((r) => r.account === '950')?.sources).toEqual(['950', '951']);
  });

  it('„Пренеси повторно“ is idempotent and audited', async () => {
    const before = await loadLedgerLines(db, firmId, '2027-01-01', '2027-12-31');
    const a = await db.transaction((tx) => openNextYear(tx, { firmId, year: 2026, ...act }));
    expect(a.replaced).toBe(true);
    const after = await loadLedgerLines(db, firmId, '2027-01-01', '2027-12-31');
    expect(after.map((l) => [l.account, l.partnerId, l.debit, l.credit])).toEqual(before.map((l) => [l.account, l.partnerId, l.debit, l.credit]));
    const opens = await db.select().from(schema.journals).where(and(eq(schema.journals.firmId, firmId), eq(schema.journals.kind, 'open')));
    expect(opens.filter((j) => j.date === '2027-01-01')).toHaveLength(1);
    const au = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.firmId, firmId), eq(schema.auditLog.action, 'carryOver')));
    expect(au).toHaveLength(2);
  });

  it('a change in the old year shows as not carried; closing again updates the opening', async () => {
    await P('2026-12-20', 'izlez', [{ account: '1200', debit: 11_800, partnerId: p.K2, doc: 'F-3' }, { account: '7400', credit: 10_000 }, { account: '230018', credit: 1_800 }]);
    const s = await db.transaction((tx) => carryState(tx, firmId, 2026));
    expect(s.evidence.totals.ok).toBe(false);
    const k2 = s.evidence.rows.find((r) => r.account === '1200' && r.partnerId === p.K2);
    expect(k2?.status).toBe('missing');
    expect(k2?.planned).toBe(11_800);
    await db.transaction((tx) => closeYear(tx, { firmId, year: 2026, ...act }));
    const s2 = await db.transaction((tx) => carryState(tx, firmId, 2026));
    expect(s2.evidence.totals.ok).toBe(true);
    expect(s2.evidence.missing).toBe(0);
    const old = await loadLedgerLines(db, firmId, '2026-01-01', '2026-12-31');
    const neu = await loadLedgerLines(db, firmId, '2027-01-01', '2027-12-31');
    expect(balancesOf(neu)).toEqual(balancesOf(old));
  });

  it('per open document on 12x/22x when the firm enables it', async () => {
    const [f] = await db.select().from(schema.firms).where(eq(schema.firms.id, firmId));
    await db.update(schema.firms).set({ settings: { ...(f!.settings as object), carryByDoc: true } }).where(eq(schema.firms.id, firmId));
    await db.transaction((tx) => openNextYear(tx, { firmId, year: 2026, ...act }));
    const neu = await loadLedgerLines(db, firmId, '2027-01-01', '2027-12-31');
    const s1 = neu.filter((l) => l.account === '2200' && l.partnerId === p.S1).map((l) => [l.doc, l.credit]);
    expect(s1).toEqual([['В-1', 47_200], ['В-2', 60_000]]);
    expect(neu.filter((l) => l.account === '1200' && l.partnerId === p.K1).map((l) => [l.doc, l.debit])).toEqual([['F-1', 100_000]]);
    const s = await db.transaction((tx) => carryState(tx, firmId, 2026));
    expect(s.evidence.totals.ok).toBe(true);
  });

  it('statistical accounts: the firm list (setting) plus the VAT-base kontos of its posting scheme', async () => {
    const [f] = await db.select().from(schema.firms).where(eq(schema.firms.id, firmId));
    const base = f!.settings as Record<string, unknown>;
    expect(await db.transaction((tx) => carryStatPrefixesFor(tx, f!))).toEqual(['994', '999']);
    // a firm scheme with its own VAT-base konto outside 994 / 999, and a custom list
    const g = { ...f!, settings: { ...base, carryStatPrefixes: ['994'], sch: { vbout18d: '98018', vbout18p: '98118' } } };
    expect(await db.transaction((tx) => carryStatPrefixesFor(tx, g))).toEqual(['98018', '98118', '994', '9990018', '99900', '99902', '99905', '999010', '999018'].sort());
    // the setting is used by the plan: with only 994 listed, 999018 (a default scheme konto) is still excluded
    await db.update(schema.firms).set({ settings: { ...base, carryStatPrefixes: ['994'] } }).where(eq(schema.firms.id, firmId));
    const s = await db.transaction((tx) => carryState(tx, firmId, 2026));
    expect(s.statPrefixes).toEqual(['994']);
    expect(s.plan.lines.some((l) => /^99[49]/.test(l.account))).toBe(false);
    await db.update(schema.firms).set({ settings: base }).where(eq(schema.firms.id, firmId));
  });
});
