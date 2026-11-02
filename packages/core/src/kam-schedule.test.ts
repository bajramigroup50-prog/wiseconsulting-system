import { describe, expect, it } from 'vitest';
import { kamRateOn, kamSchedule } from './finance';

describe('kamSchedule (Helix каматна листа)', () => {
  it('fixed rate, nothing paid = open × rate × days / 365', () => {
    expect(kamSchedule({ open0: 36500, due: '2026-01-01', asOf: '2026-01-11', payments: [], rate: 10 }).k).toBe(100);
  });
  it('a partial payment lowers the base from its date; paid late still owes interest', () => {
    const r = kamSchedule({ open0: 36500, due: '2026-01-01', asOf: '2026-03-01', payments: [{ date: '2026-01-11', amt: 18250 }, { date: '2026-01-21', amt: 18250 }], rate: 10 });
    expect(r.segs.map((s) => [s.days, s.base])).toEqual([[10, 36500], [10, 18250]]);
    expect(r.k).toBe(150);
  });
  it('rate table: each period with its rate', () => {
    const rates = [{ from: '2025-07-01', rate: 10 }, { from: '2026-01-01', rate: 20 }];
    expect(kamRateOn(rates, '2025-12-31')).toBe(10);
    const r = kamSchedule({ open0: 36500, due: '2025-12-22', asOf: '2026-01-11', payments: [], rates });
    expect(r.segs.map((s) => [s.days, s.rate])).toEqual([[10, 10], [10, 20]]);
    expect(r.k).toBe(300);
  });
  it('not late → 0', () => expect(kamSchedule({ open0: 100, due: '2026-05-01', asOf: '2026-05-01', payments: [], rate: 10 }).k).toBe(0));
});
