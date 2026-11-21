import { describe, expect, it } from 'vitest';
import { cashflowPlan, cfAvgDelay, cfMonthly, cfPayday, cfRecurringFromHistory, cfVatSchedule, type CfDoc } from './cashflow';

const doc = (o: Partial<CfDoc>): CfDoc => ({ id: 'x', partner: 'p', date: '2026-11-01', due: null, total: 0, paid: 0, ...o });

describe('паричен тек – прогноза', () => {
  it('open invoices by due date, running balance, first day below zero', () => {
    const R = cashflowPlan({
      today: '2026-11-21', horizon: 30, start: 10_000,
      invoices: [doc({ id: 'i1', due: '2026-11-25', total: 5_000, paid: 1_000 }), doc({ id: 'i2', due: '2026-12-01', total: 2_000, paid: 2_000 })],
      purchases: [doc({ id: 'p1', partner: 's', due: '2026-11-28', total: 20_000 })],
    });
    expect(R.days).toHaveLength(31);
    expect(R.days[0]).toMatchObject({ date: '2026-11-21', bal: 10_000 });
    expect(R.days.find((d) => d.date === '2026-11-25')).toMatchObject({ inn: 4_000, bal: 14_000 });
    expect(R.days.find((d) => d.date === '2026-11-28')).toMatchObject({ out: 20_000, bal: -6_000 });
    expect(R.firstNeg?.date).toBe('2026-11-28');
    expect(R.low).toEqual({ date: '2026-11-28', bal: -6_000 });
    expect(R.warnings[0]).toMatch(/28\.11\.2026.*под нула/);
    expect(R.days.at(-1)!.bal).toBe(-6_000);
    expect(R.weeks[0]).toMatchObject({ from: '2026-11-21', to: '2026-11-27', inn: 4_000, out: 0, bal: 14_000 });
  });

  it('overdue: receivables a week later (or not at all), payables today; customer delay moves the date', () => {
    const base = {
      today: '2026-11-21', horizon: 30, start: 0,
      invoices: [doc({ id: 'late', due: '2026-11-01', total: 1_000 }), doc({ id: 'slow', partner: 'slow', due: '2026-11-24', total: 500 })],
      purchases: [doc({ id: 'p', partner: 's', due: '2026-11-10', total: 300 })],
    };
    const A = cashflowPlan(base);
    expect(A.items.find((i) => i.kind === 'late')?.date).toBe('2026-11-28');
    expect(A.items.find((i) => i.kind === 'pur')?.date).toBe('2026-11-21');
    expect(A.overdueIn).toEqual({ n: 1, sum: 1_000 });
    expect(A.overduePur).toEqual({ n: 1, sum: 300 });
    expect(cashflowPlan({ ...base, lateIn: null }).items.some((i) => i.kind === 'late')).toBe(false);
    const B = cashflowPlan({ ...base, useDelay: true, delays: new Map([['slow', 12]]) });
    expect(B.items.find((i) => i.partner === 'slow')?.date).toBe('2026-12-06');
  });

  it('recurring salary + contributions on the pay day, VAT on its due date, instalments and manual items', () => {
    const R = cashflowPlan({
      today: '2026-11-21', horizon: 60, start: 100_000, invoices: [], purchases: [],
      payroll: { net: 30_000, contrib: 15_000, day: 10 },
      vat: cfVatSchedule({ today: '2026-11-21', end: '2027-01-20', kind: 'month', last: { period: '2026-10', due: '2026-11-25', amount: 8_000 } }),
      recurring: [{ label: 'Закуп', amount: 12_000, day: 1 }, { label: 'Лизинг', amount: 5_000, day: 15, kind: 'loan', until: '2026-12-31' }],
      manual: [{ date: '2026-12-05', amount: 50_000, label: 'Позајмица од сопственик' }],
    });
    const on = (d: string) => R.items.filter((i) => i.date === d).map((i) => [i.kind, i.amount]);
    expect(on('2026-12-10')).toEqual([['net', -30_000], ['contrib', -15_000]]);
    expect(on('2027-01-10')).toEqual([['net', -30_000], ['contrib', -15_000]]);
    expect(on('2026-11-25')).toEqual([['vat', -8_000]]);
    expect(on('2026-12-25')).toEqual([['vat', -8_000]]);
    expect(R.items.filter((i) => i.kind === 'vat').map((i) => i.date)).toEqual(['2026-11-25', '2026-12-25']);
    expect(on('2026-12-01')).toEqual([['rec', -12_000]]);
    expect(R.items.filter((i) => i.kind === 'loan').map((i) => i.date)).toEqual(['2026-12-15']);
    expect(on('2026-12-05')).toEqual([['manual', 50_000]]);
    // running balance = start + Σ items
    expect(R.days.at(-1)!.bal).toBe(100_000 + R.items.reduce((s, i) => s + i.amount, 0));
    expect(R.totals.net).toBe(-60_000);
  });

  it('minimum balance warning', () => {
    const R = cashflowPlan({ today: '2026-11-21', horizon: 30, start: 5_000, invoices: [], purchases: [doc({ partner: 's', due: '2026-11-30', total: 4_000 })], min: 2_000 });
    expect(R.firstNeg).toBeNull();
    expect(R.firstMin?.date).toBe('2026-11-30');
    expect(R.warnings.join(' ')).toMatch(/под минимумот/);
  });

  it('helpers: monthly dates, pay day, average delay, recurring from history, quarterly VAT', () => {
    expect(cfMonthly('2026-11-21', '2027-02-28', 31)).toEqual(['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
    expect(cfMonthly('2026-11-10', '2026-12-31', 10)).toEqual(['2026-12-10']);
    expect(cfPayday(['2026-08-14', '2026-09-15', '2026-10-15'])).toBe(15);
    expect(cfPayday([])).toBe(10);
    const d = cfAvgDelay([
      { partner: 'a', date: '2026-01-01', due: '2026-01-10', pays: [{ date: '2026-01-20', amt: 100 }, { date: '2026-01-05', amt: 100 }] },
      { partner: 'b', date: '2026-01-01', due: null, pays: [{ date: '2026-01-31', amt: 50 }] },
    ]);
    expect(d.get('a')).toBe(5);
    expect(d.get('b')).toBe(30);
    const H = cfRecurringFromHistory([
      ...['2026-07-03', '2026-08-02', '2026-09-03', '2026-10-04'].map((date) => ({ date, amount: 12_000, key: 'rent', label: 'Закуп' })),
      ...['2026-08-10', '2026-10-10'].map((date) => ({ date, amount: 900, key: 'odd', label: 'Повремено' })),
      ...['2026-08-10', '2026-09-10', '2026-10-10'].map((date, i) => ({ date, amount: [100, 900, 100][i]!, key: 'jumpy', label: 'Различно' })),
    ], '2026-11-21');
    expect(H).toEqual([{ label: 'Закуп', amount: 12_000, day: 3, kind: 'rec' }]);
    expect(cfVatSchedule({ today: '2026-11-21', end: '2027-02-28', kind: 'quarter', last: { period: '2026-Т3', due: '2026-10-25', amount: 9_000 } }))
      .toEqual([{ amount: 9_000, due: '2027-01-25', label: 'ДДВ 2026-Т4 (проценка)', est: true }]);
  });
});
