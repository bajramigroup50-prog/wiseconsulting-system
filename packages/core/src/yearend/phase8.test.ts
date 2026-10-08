import { describe, expect, it } from 'vitest';
import {
  belResolve, obRebuild, parseTurnoverTb, yeBalanceSet, yeClosePlan, yeComputeYear, yeEntityOf, yeInputsFromLedger, yeMergePayroll,
  yeOpenPlan, yePayrollFromLedger, yeViewFor, type YeLedgerLine,
} from '../yearend';
import { lineTotals } from '../ledger';

const L = (date: string, account: string, debit: number, credit: number, extra: Partial<YeLedgerLine> = {}): YeLedgerLine =>
  ({ date, account, debit, credit, kind: 'manual', ...extra });

/** A small company year: opening 9000 capital, sales 100 000, expenses 60 000, one customer. */
const year: YeLedgerLine[] = [
  L('2026-01-01', '1000', 50_000, 0, { kind: 'open' }),
  L('2026-01-01', '9000', 0, 50_000, { kind: 'open' }),
  L('2026-03-10', '1200', 118_000, 0, { kind: 'izlez', partnerId: 'p1' }),
  L('2026-03-10', '7400', 0, 100_000, { kind: 'izlez' }),
  L('2026-03-10', '230018', 0, 18_000, { kind: 'izlez' }),
  L('2026-05-02', '4400', 60_000, 0),
  L('2026-05-02', '1000', 0, 60_000),
];

describe('entity (one discriminator, FIX P8 #12)', () => {
  it('explicit entity → legal form → name guess', () => {
    expect(yeEntityOf({ ent: 'npo', legalForm: 'doo' })).toBe('npo');
    expect(yeEntityOf({ legalForm: 'TP' })).toBe('tp');
    expect(yeEntityOf({ legalForm: 'zdr' })).toBe('npo');
    expect(yeEntityOf({ name: 'Здружение на граѓани Еко' })).toBe('npo');
    expect(yeEntityOf({ name: 'Адвокат Петров' })).toBe('sd');
    expect(yeEntityOf({ name: 'БАЈРАМИ ГРОУП ДООЕЛ' })).toBe('co');
  });
  it('views per entity', () => {
    expect(yeViewFor('zs_db', 'co')).toBe(true);
    expect(yeViewFor('zs_db', 'npo')).toBe(false);
    expect(yeViewFor('zsNPO', 'npo')).toBe(true);
    expect(yeViewFor('mbyllja', 'tp')).toBe(true);
  });
});

describe('inputs from the ledger', () => {
  it('splits opening and turnover, keeps the close apart, tracks partners and the first month', () => {
    const I = yeInputsFromLedger([...year, L('2026-12-31', '7400', 100_000, 0, { kind: 'close' }), L('2026-12-31', '8000', 0, 100_000, { kind: 'close' })]);
    expect(I.tb.find((r) => r.account === '1000')).toEqual({ account: '1000', debit: 0, credit: 60_000, openingDebit: 50_000, openingCredit: 0 });
    expect(I.closeLines).toHaveLength(2);
    expect(I.partnerBalances).toEqual([{ account: '1200', partner: 'p1', balance: 118_000 }]);
    expect(I.hasOpening).toBe(true);
    expect(I.hasImportedTb).toBe(false);
    expect(I.firstPostingMonth).toBe('2026-03');
  });
  it('payroll totals from plati journals; the payroll module wins per month', () => {
    const P = yePayrollFromLedger([
      L('2026-01-31', '4210', 60_000, 0, { kind: 'plati' }), L('2026-01-31', '2340', 0, 4_000, { kind: 'plati' }),
      L('2026-01-31', '2341', 0, 11_000, { kind: 'plati' }), L('2026-01-31', '2342', 0, 4_500, { kind: 'plati' }),
      L('2026-02-28', '2340', 0, 4_100, { kind: 'plati' }), L('2026-02-28', '2340', 300, 0, { kind: 'manual' }),
    ]);
    expect(P).toEqual([{ month: '2026-01', employees: 0, tax: 4_000, contrib: 15_500 }, { month: '2026-02', employees: 0, tax: 4_100, contrib: 0 }]);
    const M = yeMergePayroll([{ month: '2026-02', employees: 3, tax: 4_100, contrib: 15_000 }], P);
    expect(M.map((r) => [r.month, r.employees])).toEqual([['2026-01', 0], ['2026-02', 3]]);
  });
});

describe('year by entity and the close plan', () => {
  it('company: the close books the ДБ tax, bu252 and the ДБ return agree before and after the close', () => {
    const inputs = yeInputsFromLedger(year);
    const plan = yeClosePlan({ year: 2026, ent: 'co', inputs, settings: {} });
    expect(plan.taxSource).toBe('db');
    expect([plan.profit, plan.tax, plan.net]).toEqual([40_000, 4_000, 36_000]);
    expect(plan.before.co.zs.V.bu252).toBe(4_000);
    expect(lineTotals(plan.lines).balanced).toBe(true);
    const closed = yeInputsFromLedger([...year, ...plan.lines.map((l) => L('2026-12-31', l.account, l.debit, l.credit, { kind: 'close' }))]);
    const after = yeComputeYear({ year: 2026, ent: 'co', inputs: closed, settings: {} });
    expect(after.closed).toBe(true);
    expect(after.co.zs.V.bu252).toBe(4_000);
    expect(after.co.zs.V.bs077).toBe(plan.before.co.zs.V.bs077);
    expect(after.co.zs.V.bs063).toBe(after.co.zs.V.bs111);
  });
  it('non-deductible expenses in the ДБ raise the closing tax', () => {
    const plan = yeClosePlan({ year: 2026, ent: 'co', inputs: yeInputsFromLedger(year), settings: { dbAdj: { '03': 10_000 } } });
    expect(plan.tax).toBe(5_000);
  });
  it('company on ДБ-ВП: 1 % of total income', () => {
    const big: YeLedgerLine[] = [L('2026-02-01', '1000', 4_000_000, 0), L('2026-02-01', '7400', 0, 4_000_000)];
    const plan = yeClosePlan({ year: 2026, ent: 'co', inputs: yeInputsFromLedger(big), settings: { vpAdj: { on: true } } });
    expect([plan.taxSource, plan.tax]).toEqual(['vp', 40_000]);
  });
  it('sole trader closes with the ДЛД-ДБ tax; NPO with the NPO scheme and a net', () => {
    const tp = yeClosePlan({ year: 2026, ent: 'tp', inputs: yeInputsFromLedger(year), settings: { dldAdj: { red: 0 } } });
    expect([tp.taxSource, tp.tax, tp.net]).toEqual(['dld', 4_000, 36_000]);
    const npo = yeClosePlan({ year: 2026, ent: 'npo', inputs: yeInputsFromLedger(year), settings: {} });
    expect(npo.taxSource).toBe('npo');
    expect(npo.net).toBe(40_000);
    expect(lineTotals(npo.lines).balanced).toBe(true);
    expect(npo.lines.some((l) => l.account === '951')).toBe(true); // company chart → company result accounts
    expect(npo.lines.some((l) => l.account === '8000')).toBe(true); // FIX P8 #3: not 800 on the company chart
    expect(npo.lines.some((l) => l.account === '800')).toBe(false);
    const closed = yeInputsFromLedger([...year, ...npo.lines.map((l) => L('2026-12-31', l.account, l.debit, l.credit, { kind: 'close' }))]);
    const after = yeComputeYear({ year: 2026, ent: 'npo', inputs: closed, settings: {} });
    expect([after.closed, after.npo!.tax]).toEqual([true, npo.tax]);
  });
  it('open plan carries 951 → 950 and the customer per partner', () => {
    const plan = yeClosePlan({ year: 2026, ent: 'co', inputs: yeInputsFromLedger(year), settings: {} });
    const closed = yeInputsFromLedger([...year, ...plan.lines.map((l) => L('2026-12-31', l.account, l.debit, l.credit, { kind: 'close' }))]);
    const open = yeOpenPlan(closed);
    expect(lineTotals(open).balanced).toBe(true);
    expect(open).toContainEqual({ account: '1200', debit: 118_000, credit: 0, partner: 'p1' });
    expect(open.find((l) => l.account === '950')!.credit).toBe(36_000);
    expect(open.some((l) => /^[478]/.test(l.account) || l.account === '951')).toBe(false);
  });
});

describe('obRebuild — trial balance imported after the close', () => {
  const rows = parseTurnoverTb([
    ['Конто', 'Назив', 'Промет Д', 'Промет П', 'Салдо Д', 'Салдо П'],
    ['1000', 'Банка', '150.000,00', '60.000,00', '90.000,00', '0'],
    ['7400', 'Приходи', '100.000,00', '100.000,00', '0', '0'],
    ['4400', 'Расходи', '60.000,00', '60.000,00', '0', '0'],
    ['8100', 'Данок', '4.000,00', '4.000,00', '0', '0'],
    ['2330', 'Данок обврска', '0', '4.000,00', '0', '4.000,00'],
    ['9000', 'Капитал', '0', '50.000,00', '0', '50.000,00'],
    ['951', 'Добивка', '0', '36.000,00', '0', '36.000,00'],
    ['', 'Вкупно', '1', '1', '1', '1'],
  ]);
  it('parses the pasted grid', () => {
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({ account: '1000', debit: 90_000, turnoverDebit: 150_000 });
  });
  it('rebuilds classes 4/7 from turnover and a balanced close on 8000 (FIX P8 #3)', () => {
    const X = obRebuild(rows)!;
    expect(X.close).toMatchObject({ profit: 40_000, tax: 4_000, net: 36_000, n: 2, ok: true });
    expect(X.rows.some((r) => r.account === '8100')).toBe(false);
    expect(X.rows.find((r) => r.account === '8000')).toMatchObject({ debit: 40_000, credit: 0 });
    expect(X.close.lines.every((l) => l.account !== '800')).toBe(true);
    expect(lineTotals(X.rows).balanced).toBe(true);
    expect(lineTotals(X.close.lines).balanced).toBe(true);
    // bbimp + imported close = the imported (post-close) balances
    const B = yeBalanceSet(X.rows.map((r) => ({ account: r.account, debit: r.debit, credit: r.credit })), X.close.lines).all;
    expect(B['7400']!.s).toBe(0);
    expect(B['8000']!.s).toBe(0);
    expect(B['951']!.s).toBe(-36_000);
  });
  it('returns null for a trial balance before the close', () => {
    expect(obRebuild([{ account: '7400', debit: 0, credit: 100, turnoverDebit: 0, turnoverCredit: 100 }])).toBeNull();
  });
});

describe('explanatory notes', () => {
  it('saved text, then last year (not for gen/osn), then automatic; rows filtered by amount', () => {
    const N = belResolve({ name: 'Фирма ДООЕЛ', legalForm: 'dooel', edb: '4030000000000' }, 2026, { bs002: 0, bs009: 1000, bs010: 0 }, { bs010: 5 },
      { pol: 'Наши политики' }, { gen: 'стар', nd: 'лани' });
    const g = N.find((x) => x.id === 'gen')!;
    expect(g.text).toContain('Фирма ДООЕЛ (ДООЕЛ');
    expect(g.text).toContain('МК4030000000000');
    expect(N.find((x) => x.id === 'pol')!).toMatchObject({ text: 'Наши политики', saved: true });
    expect(N.find((x) => x.id === 'nd')!.text).toBe('лани');
    expect(N.find((x) => x.id === 'ms')!.rows.map((r) => r.aop)).toEqual(['009', '010']);
    expect(N.find((x) => x.id === 'nm')!.rows).toHaveLength(1);
  });
});
