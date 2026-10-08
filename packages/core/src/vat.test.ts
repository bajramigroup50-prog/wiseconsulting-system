import { describe, expect, it } from 'vitest';
import {
  calcLines, ddv04FromResult, ddvFor, isValidVatAccount, perRange, periodDue, periodOf, periodsOfYear, reverseChargeVat,
  travelMarginFor, validateVatAccountSettings, vatAccount, vatAccounts, vatFromGross, type VatContext,
} from './vat';

const ctx = (firm: VatContext['firm'] = { ddv: true }, global: VatContext['global'] = null): VatContext => ({ firm, global });

describe('VAT account resolution (one validated resolver)', () => {
  it('defaults per rate', () => {
    expect([18, 10, 5].map((r) => vatAccount(ctx(), 'out', r))).toEqual(['230018', '230010', '23005']);
    expect([18, 10, 5].map((r) => vatAccount(ctx(), 'in', r))).toEqual(['130018', '130010', '13005']);
    expect([18, 10, 5].map((r) => vatAccount(ctx(), 'imp', r))).toEqual(['13001811', '13001818', '130000511']);
    expect(vatAccount(ctx(), 'out', 0)).toBeUndefined();
    expect(vatAccount(ctx(), 'in', 7)).toBeUndefined();
    expect(vatAccount(ctx(), 'out', '18')).toBe('230018');
  });
  it('firm → (input) single konto → global → default', () => {
    const c = ctx({ vatIn: { 18: '130181' }, vatInKonto: '130099' }, { vatIn: { 10: '130101', 5: '130051' } });
    expect(vatAccount(c, 'in', 18)).toBe('130181');
    expect(vatAccount(c, 'in', 10)).toBe('130099');
    expect(vatAccount(ctx({}, { vatIn: { 10: '130101' } }), 'in', 10)).toBe('130101');
  });
  it('FIX: summary kontos are rejected for every kind, including import VAT', () => {
    const c = ctx({ vatImp: { 18: '1300' }, vatOut: { 18: ' 2300 ' }, vatInKonto: '130' });
    expect(vatAccount(c, 'imp', 18)).toBe('13001811'); // legacy VAT_IMP returned '1300'
    expect(vatAccount(c, 'out', 18)).toBe('230018');
    expect(vatAccount(c, 'in', 18)).toBe('130018');
    expect(isValidVatAccount('130018')).toBe(true);
    expect(isValidVatAccount('')).toBe(false);
  });
  it('vatAccounts lists every resolved konto', () => {
    expect(vatAccounts(ctx()).size).toBe(9);
  });
  it('validates overrides before saving', () => {
    expect(validateVatAccountSettings({ vatOut: { 18: '230018' }, vatIn: { 5: '13005' } })).toEqual([]);
    const errs = validateVatAccountSettings({ vatOut: { 18: '2300' }, vatIn: { 7: '130007' }, vatImp: { 10: 'abc' }, vatInKonto: '1301' });
    expect(errs).toHaveLength(4);
  });
});

describe('periods', () => {
  it('periodOf / perRange / periodDue', () => {
    expect(periodOf('2026-05-31', 'month')).toBe('2026-05');
    expect(periodOf('2026-05-31', 'quarter')).toBe('2026-Т2');
    expect(perRange('2026-Т1')).toEqual(['2026-01-01', '2026-03-31']);
    expect(perRange('2024-02')).toEqual(['2024-02-01', '2024-02-29']);
    expect(perRange('2026-Т4')).toEqual(['2026-10-01', '2026-12-31']);
    expect(periodDue('2026-Т4')).toBe('2027-01-25');
    expect(periodDue('2026-03')).toBe('2026-04-25');
    expect(periodsOfYear(2026, 'quarter')).toEqual(['2026-Т1', '2026-Т2', '2026-Т3', '2026-Т4']);
    expect(periodsOfYear(2026, 'month')).toHaveLength(12);
  });
});

describe('amount helpers', () => {
  it('reverse charge and VAT from gross', () => {
    expect(reverseChargeVat(1000.4)).toBe(180.07);
    expect(reverseChargeVat(1000, 5)).toBe(50);
    expect(vatFromGross(118, 18)).toBe(18);
    expect(vatFromGross(105, 5)).toBe(5);
  });
  it('exact half cents round away from zero (documented difference from legacy float r2)', () => {
    // 2561.50 × 5% = 128.075 exactly → 128.08 (legacy float r2 gives 128.07)
    expect(calcLines([{ qty: 1, price: 2561.5, rate: 5 }]).vat).toBe(128.08);
    expect(calcLines([{ qty: -1, price: 2561.5, rate: 5 }]).vat).toBe(-128.08);
  });
  it('calcLines groups by rate and konto, art. 32-a and non-VAT', () => {
    const c = calcLines([{ qty: 2, price: 100, rate: 18, konto: '7410' }, { qty: 1, price: 50, rate: 18, konto: '7410' }, { qty: 1, price: 10, rate: 5 }]);
    expect(c).toEqual({ by: [{ rate: 18, konto: '7410', base: 250, vat: 45 }, { rate: 5, konto: '7400', base: 10, vat: 0.5 }], base: 260, vat: 45.5, total: 305.5 });
    expect(calcLines([{ qty: 1, price: 100, rate: 5 }], true).by[0]).toEqual({ rate: 18, konto: '7400', base: 100, vat: 0 });
    expect(calcLines([{ qty: 1, price: 100, rate: 18 }], false, { nonVat: true }).vat).toBe(0);
  });
});

describe('travel margin (чл. 38)', () => {
  const inv = (id: string, price: number, arrangementId?: string, credit = false) =>
    ({ id, date: '2026-02-10', tourM: true, credit, arrangementId, items: [{ qty: 1, price, rate: 0, konto: '7400' }] });
  const arrangements = { A: { rev: 100000, cost: 70000, own: 5000 }, B: { rev: 10000, cost: 15000 } };
  it('period basis offsets negative arrangements', () => {
    const T = travelMarginFor([inv('1', 50000, 'A'), inv('2', 10000, 'B')], '2026-Т1', 'quarter', ctx(), { arrangements });
    // A: cost 35000, own 2500, margin 12500; B: margin −5000 → 7500 taxable
    expect([T.m, T.mt, T.vat, T.base, T.own, T.ownVat]).toEqual([7500, 7500, 1144.07, 6355.93, 2500, 381.36]);
  });
  it('arrangement basis drops negative margins', () => {
    const T = travelMarginFor([inv('1', 50000, 'A'), inv('2', 10000, 'B')], '2026-Т1', 'quarter', ctx(), { arrangements, agg: 'arr' });
    expect([T.m, T.mt, T.vat]).toEqual([7500, 12500, 1906.78]);
  });
  it('enters ДДВ-04 fields 01/02 for a VAT firm only', () => {
    const docs = { invoices: [inv('1', 50000, 'A')] };
    const F = ddv04FromResult(ddvFor(docs, '2026-Т1', 'quarter', ctx(), { travel: { arrangements } }));
    expect([F['01'], F['02'], F['08']]).toEqual([10593 + 2119, 1907 + 381, 0]);
    expect(ddvFor(docs, '2026-Т1', 'quarter', ctx({ ddv: false })).out).toEqual({});
  });
});
