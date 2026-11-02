import { describe, expect, it } from 'vitest';
import { empCalc, payCatOf, payrollEntries2, resolvePayParams, type PayEmp } from './payroll';

describe('non-taxable payroll payments (регрес, отпремнина…)', () => {
  const P = resolvePayParams({ hours: 168 }, '2026-06');
  const e: PayEmp = { empId: 'a', name: 'A', netBase: 30000, lines: [{ type: 'Редовно работење', hours: 168, cat: 'reg' }, { type: 'Регрес за годишен одмор', amt: 10000 }] };
  it('category nep, no contributions / tax, paid on top of the net', () => {
    expect(payCatOf('Регрес за годишен одмор')).toBe('nep');
    const c = empCalc(e, P), base = empCalc({ ...e, lines: e.lines!.slice(0, 1) }, P);
    expect(c.T.gross).toBe(base.T.gross);
    expect(c.T.net).toBe(base.T.net);
    expect(c.T.tax).toBe(base.T.tax);
    expect(c.T.nep).toBe(10000);
  });
  it('posted 4223 / 2420 and the entry balances', () => {
    const L = payrollEntries2({ month: '2026-06', params: { hours: 168 }, emps: [e] });
    expect(L.find((l) => l.account === '4223')?.debit).toBe(10000);
    expect(L.find((l) => l.account === '2420')?.credit).toBe(10000);
    const d = L.reduce((a, l) => a + l.debit, 0), p = L.reduce((a, l) => a + l.credit, 0);
    expect(Math.round(d * 100)).toBe(Math.round(p * 100));
  });
});

import { isLoanDeduction, payLoanStatus } from './payroll';
describe('payLoanStatus (кредити / задршки)', () => {
  it('deductions repay the loans in force, oldest first', () => {
    const loans = [{ id: 'b', kind: 'Кредит', creditor: 'НЛБ', total: 3000, monthly: 1000, from: '2026-03-01' }, { id: 'a', kind: 'Судска забрана', creditor: 'Извршител', total: 1500, monthly: 1000, from: '2026-01-01' }];
    const S = payLoanStatus(loans, new Map([['2026-01', 1000], ['2026-02', 1000], ['2026-03', 1000]]));
    expect(S.map((l) => [l.id, l.paid, l.rest])).toEqual([['a', 1500, 0], ['b', 1000, 2000]]);
    expect(isLoanDeduction('Кредит / судска забрана (задршка)')).toBe(true);
    expect(isLoanDeduction('Синдикална членарина')).toBe(false);
  });
});
