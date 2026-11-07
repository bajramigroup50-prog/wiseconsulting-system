import { describe, expect, it } from 'vitest';
import { isLoanDeduction, loanCuts, loanLineType, loanOfLine, payLoanStatus, PSIF0, type PayLoan } from './calc';
import { absenceDays, absenceLines, isAbsenceLine } from './absence';

const L = (o: Partial<PayLoan> & { id: string; rest?: number }): PayLoan & { rest: number } => ({ kind: 'Судска забрана / извршител', creditor: 'Извршител', total: 100000, monthly: 0, from: '2026-01-01', rest: 100000, ...o });

describe('withholdings (ЗИ чл. 117)', () => {
  it('caps an executor order at 1/3 of the net before deductions', () => {
    const [c] = loanCuts([L({ id: 'a1', monthly: 20000 })], 30000, '2026-11');
    expect(c).toMatchObject({ amt: 10000, due: 20000, capped: true });
  });
  it('alimony up to 1/2; other orders share 1/3 and all together never more than 1/2', () => {
    const C = loanCuts([L({ id: 'a1', kind: 'Издршка (алиментација)', monthly: 8000, from: '2026-01-01' }), L({ id: 'b2', monthly: 9000, from: '2026-02-01' }), L({ id: 'c3', monthly: 5000, from: '2026-03-01' })], 30000, '2026-11');
    expect(C.map((c) => c.amt)).toEqual([8000, 7000, 0]);
  });
  it('a % instalment, the rest of the debt and a voluntary credit without cap', () => {
    expect(loanCuts([L({ id: 'a1', pct: 10, rest: 2500 })], 30000, '2026-11')[0]!.amt).toBe(2500);
    expect(loanCuts([L({ id: 'a1', pct: 10 })], 30000, '2026-11')[0]!.amt).toBe(3000);
    expect(loanCuts([L({ id: 'k1', kind: 'Друго', monthly: 25000 })], 30000, '2026-11')[0]!.amt).toBe(25000);
    expect(loanCuts([L({ id: 'z1', monthly: 5000, from: '2026-12-01' })], 30000, '2026-11')).toEqual([]);
    expect(loanCuts([L({ id: 'z1', monthly: 5000, closed: true })], 30000, '2026-11')).toEqual([]);
  });
  it('tags the line and credits it to its own order', () => {
    const a = L({ id: '1a2b3c4d-0000-0000-0000-000000000000', creditor: 'Извршител Петров', caseNo: 'И.бр. 12/26' });
    const t = loanLineType(a);
    expect(t).toBe('Задршка: Извршител Петров (И.бр. 12/26) #1a2b3c4d');
    expect(isLoanDeduction(t)).toBe(true);
    expect(loanOfLine(t, [a])?.id).toBe(a.id);
    const b = L({ id: '9f9f9f9f-0000-0000-0000-000000000000', from: '2025-01-01' });
    const S = payLoanStatus([a, b], new Map([['2026-02', { by: { '#1a2b3c4d': 4000 }, pool: 0 }]]));
    expect(S.find((x) => x.id === a.id)?.paid).toBe(4000);
    expect(S.find((x) => x.id === b.id)?.paid).toBe(0);
  });
});

describe('absences → payroll lines', () => {
  it('maternity over the whole month: the working hours of the month on code 301 (ФЗО)', () => {
    const X = absenceLines('2026-11', [{ id: 'x', employeeId: 'e', code: '301', from: '2026-10-15', to: '2027-04-15' }], PSIF0);
    expect(X).toHaveLength(1);
    expect(X[0]).toMatchObject({ code: '301', cat: 'bol', pct: 100, payer: 'ФЗО' });
    expect(X[0]!.hours).toBe(168); // November 2026: 21 working days
    expect(isAbsenceLine(X[0]!.type)).toBe(true);
  });
  it('a one-week paid leave and the employer sick leave turning ФЗО from the 31st day', () => {
    expect(absenceLines('2026-11', [{ id: 'x', employeeId: 'e', code: '402', from: '2026-11-02', to: '2026-11-06' }], PSIF0)[0]!.hours).toBe(40);
    const S = absenceLines('2026-11', [{ id: 'y', employeeId: 'e', code: '201', from: '2026-10-20', to: '2026-11-30' }], PSIF0);
    expect(S.map((l) => [l.code, l.hours])).toEqual([['201', 104], ['211', 64]]); // 01–18.11 employer (days 13–30), from 19.11 (31st day) ФЗО
    expect(absenceDays({ from: '2026-10-20', to: '2026-11-30' })).toBe(42);
  });
  it('part time scales the hours', () => {
    expect(absenceLines('2026-11', [{ id: 'x', employeeId: 'e', code: '401', from: '2026-11-02', to: '2026-11-06' }], PSIF0, { scale: 0.5 })[0]!.hours).toBe(20);
  });
});
