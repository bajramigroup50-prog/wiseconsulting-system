import { describe, expect, it } from 'vitest';
import { loanInstalment } from './payroll-loans';

describe('loanInstalment', () => {
  const loans = [{ id: 'a', kind: 'Кредит', creditor: 'НЛБ', total: 2500, monthly: 1000, from: '2026-01-15' }];
  it('monthly rate, the last one only the rest, then nothing', () => {
    expect(loanInstalment(loans, new Map(), '2026-01')).toBe(1000);
    expect(loanInstalment(loans, new Map([['2026-01', 1000], ['2026-02', 1000]]), '2026-03')).toBe(500);
    expect(loanInstalment(loans, new Map([['2026-01', 1000], ['2026-02', 1000], ['2026-03', 500]]), '2026-04')).toBe(0);
  });
  it('not before the loan starts; later deductions are ignored', () => {
    expect(loanInstalment(loans, new Map(), '2025-12')).toBe(0);
    expect(loanInstalment(loans, new Map([['2026-05', 2500]]), '2026-02')).toBe(1000);
  });
});
