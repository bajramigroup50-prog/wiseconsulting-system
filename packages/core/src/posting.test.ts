import { describe, expect, it } from 'vitest';
import {
  cashExpenseAccount, isBalanced, journalDifference, kompEntries, kompTot, locationAccounts, migrateLegacyScheme, PostingError,
  purchaseEntries, revByRate, schemeOn, schemeValue, vatAccountSet, vatCloseEntries, type PostingContext,
} from './posting';

const ctx = (firm: PostingContext['firm'] = { ddv: true }, global: PostingContext['global'] = null): PostingContext => ({ firm, global });

describe('scheme resolution', () => {
  it('firm → global → defaults (SCH0 + rebuild extras)', () => {
    const c = ctx({ sch: { customer: '1201', supplier: '' } }, { sch: { supplier: '2201', customer: '1209' } });
    expect(schemeValue(c, 'customer')).toBe('1201');
    expect(schemeValue(c, 'supplier')).toBe('2201');
    expect(schemeValue(c, 'advance')).toBe('2220');
    expect(schemeValue(c, 'fxGain')).toBe('7810');
    expect(schemeValue(c, 'unknownKey')).toBe('');
  });
  it("'-' switches a role off; boolean flags", () => {
    expect(schemeOn(ctx(), 'vatNoDed')).toBe(false);
    expect(schemeOn(ctx({ sch: { vatNoDed: '4999' } }), 'vatNoDed')).toBe(true);
    expect(schemeOn(ctx(), 'retailMethod')).toBe(false);
    expect(schemeOn(ctx({ sch: { retailMethod: false } }, { sch: { retailMethod: true } }), 'retailMethod')).toBe(false);
    expect(schemeOn(ctx({}, { sch: { retailMethod: true } }), 'retailMethod')).toBe(true);
  });
  it('FIX: explicit values equal to old defaults are honoured; migration drops stale ones', () => {
    expect(schemeValue(ctx({ sch: { ddvPay: '2300' } }), 'ddvPay')).toBe('2300');
    expect(migrateLegacyScheme({ ddvPay: '2300', advance: '2220', retailMarg: '6690' })).toEqual({ advance: '2220' });
  });
  it('revenue per-rate sub-kontos', () => {
    expect(revByRate(ctx(), '7400', 18)).toBe('740018');
    expect(revByRate(ctx(), '7411', 5)).toBe('74115');
    expect(revByRate(ctx(), '7499', 18)).toBe('7499');
    expect(revByRate(ctx(), '7400', 0)).toBe('7400');
    expect(revByRate(ctx({ sch: { revService_18: '-' } }), '7400', 18)).toBe('7400');
  });
  it('VAT konto set includes art. 32-a kontos', () => {
    const s = vatAccountSet(ctx());
    expect(s.has('1309') && s.has('2309') && s.has('230018')).toBe(true);
  });
  it('location kontos', () => {
    expect(locationAccounts(ctx())).toEqual({ retail: false, stock: '660', marg: '6690', vat: '6640', goodsStock: '6600' });
    expect(locationAccounts(ctx({ sch: { retailMethod: true } }), { kind: 'store', kMarg: '66941' }))
      .toEqual({ retail: true, stock: '6630', marg: '66941', vat: '6640', goodsStock: '6600' });
    expect(locationAccounts(ctx(), { kind: 'warehouse', konto: ' 66001 ' }).goodsStock).toBe('66001');
  });
});

describe('posting helpers', () => {
  it('balance check', () => {
    const L = [{ account: '1', debit: 10.1, credit: 0 }, { account: '2', debit: 0, credit: 10.1 }];
    expect(isBalanced(L)).toBe(true);
    expect(journalDifference([...L, { account: '3', debit: 0.01, credit: 0 }])).toBe(0.01);
  });
  it('compensation totals and lines', () => {
    const d = { number: 'К-1', rows: [{ side: 'rec' as const, amt: 100.1, partner: 'P' }, { side: 'pay' as const, amt: '100.10', partner: 'P', docNo: 'Ф-1' }] };
    expect(kompTot(d)).toEqual({ rec: 100.1, pay: 100.1 });
    const L = kompEntries(d, ctx());
    expect(L).toEqual([
      { account: '1200', partnerId: 'P', debit: 0, credit: 100.1, note: 'Компензација К-1' },
      { account: '2200', partnerId: 'P', debit: 100.1, credit: 0, note: 'Компензација К-1', doc: 'Ф-1' },
    ]);
  });
  it('cash expense konto: first existing candidate, abroad variants', () => {
    expect(cashExpenseAccount('fuel', false)).toBe('4033');
    expect(cashExpenseAccount('accommodation', true)).toBe('44011');
    expect(cashExpenseAccount('accommodation', false)).toBe('44010');
    expect(cashExpenseAccount('nope', false, (k) => k === '4190')).toBe('4190');
    expect(cashExpenseAccount('post', false, () => false)).toBe('411');
  });
  it('retail purchase needs the margin from the calculation', () => {
    const p = { date: '2026-01-01', partner: 'P', groups: [{ konto: '6600', rate: 18, base: 100, vat: 18 }], stock: [{ qty: 1, price: 100 }] };
    expect(() => purchaseEntries(p, ctx({ ddv: true, sch: { retailMethod: true } }), { kind: 'store' })).toThrow(PostingError);
  });
});

describe('VAT period close', () => {
  it('reverses VAT balances and books the net payable', () => {
    const ledger = [
      { account: '230018', date: '2026-01-10', debit: 0, credit: 1800 },
      { account: '23005', date: '2026-02-10', debit: 0, credit: 50.5 },
      { account: '130018', date: '2026-02-11', debit: 900, credit: 0 },
      { account: '1309', date: '2026-02-12', debit: 180, credit: 0 },
      { account: '2309', date: '2026-02-12', debit: 0, credit: 180 },
      { account: '1200', date: '2026-02-12', debit: 99, credit: 0 },
      { account: '230018', date: '2026-04-01', debit: 0, credit: 999 },
    ];
    const { lines, diff } = vatCloseEntries(ledger, '2026-01-01', '2026-03-31', ctx());
    expect(diff).toBe(950.5);
    expect(lines.map((l) => [l.account, l.debit, l.credit])).toEqual([
      ['230018', 1800, 0], ['23005', 50.5, 0], ['2309', 180, 0], ['130018', 0, 900], ['1309', 0, 180], ['23008', 0, 950.5],
    ]);
    expect(isBalanced(lines)).toBe(true);
  });
  it('refund claim when input VAT exceeds output', () => {
    const { lines, diff } = vatCloseEntries([{ account: '130018', date: '2026-01-10', debit: 500, credit: 0 }], '2026-01-01', '2026-03-31', ctx());
    expect(diff).toBe(-500);
    expect(lines.at(-1)).toEqual({ account: '1308', debit: 500, credit: 0, note: 'Побарување за ДДВ (поврат/пребивање)' });
  });
});
