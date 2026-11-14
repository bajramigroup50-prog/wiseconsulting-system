import { describe, expect, it } from 'vitest';
import { btEntries, btNextNo, btSettings, btSettle, btUnits, btByEmployee, type BusinessTrip } from './btrip';

const S = btSettings({ domAmt: 3000, fuelPrice: 80 });
const fx = (c: string) => (c === 'EUR' ? 61.5 : c === 'CHF' ? 65 : 0);
const base: BusinessTrip = { number: '1/2026', date: '2026-11-02', employeeId: 'e1', abroad: false, dest: 'Битола', country: '', purpose: 'Состанок', vehicle: 'company', dep: '2026-11-02T07:00', ret: '2026-11-02T20:00' };

describe('per-diem units (8 / 12 / 24 h rule)', () => {
  it('under 8 h none, 8–12 h half, over 12 h full, each 24 h one', () => {
    expect(btUnits(7.9)).toBe(0);
    expect(btUnits(8)).toBe(0.5);
    expect(btUnits(12)).toBe(0.5);
    expect(btUnits(12.5)).toBe(1);
    expect(btUnits(24)).toBe(1);
    expect(btUnits(24 + 9)).toBe(1.5);
    expect(btUnits(48 + 13)).toBe(3);
  });
});

describe('btSettle', () => {
  it('domestic 13 h = one domestic per diem in MKD', () => {
    const s = btSettle(base, S, fx);
    expect(s.units).toBe(1);
    expect(s.perDiem).toBe(3000);
    expect(s.total).toBe(3000);
    expect(s.toPay).toBe(3000);
  });
  it('domestic 10 h = half, reduced to 20% when meals and lodging are provided', () => {
    expect(btSettle({ ...base, ret: '2026-11-02T17:00' }, S, fx).perDiem).toBe(1500);
    expect(btSettle({ ...base, red: 20 }, S, fx).perDiem).toBe(600);
    expect(btSettle({ ...base, red: 0 }, S, fx).perDiem).toBe(0);
  });
  it('abroad: country rate of the Уредба (Germany 87 EUR) × NBRM rate, two and a half days', () => {
    const s = btSettle({ ...base, abroad: true, country: 'DE', dep: '2026-11-02T06:00', ret: '2026-11-04T16:00' }, S, fx);
    expect(s.units).toBe(2.5);
    expect(s.perDiemBy).toEqual({ EUR: 217.5 });
    expect(s.perDiem).toBe(13376.25);
  });
  it('codebook overrides the country amount; segments split by countries', () => {
    const s2 = btSettings({ rates: { RS: [60, 'EUR'] } });
    const s = btSettle({ ...base, abroad: true, country: 'DE', segs: [{ c: 'RS', in: '2026-11-02T06:00', out: '2026-11-02T20:00' }, { c: 'DE', in: '2026-11-02T20:00', out: '2026-11-04T08:00' }] }, s2, fx);
    expect(s.rows.map((r) => [r.c, r.amt])).toEqual([['RS', 60], ['DE', 87]]);
    expect(s.units).toBe(2);
  });
  it('own car 30% of the fuel price per km, costs in currency, advance → to return', () => {
    const s = btSettle({ ...base, vehicle: 'own', km: 340, advance: 10000, costs: [{ k: 'lodging', d: 'Хотел', amt: 40, cur: 'EUR' }, { k: 'other', d: 'Паркинг', amt: 300, cur: 'MKD' }] }, S, fx);
    expect(s.car).toBe(8160);
    expect(s.lodging).toBe(2460);
    expect(s.other).toBe(300);
    expect(s.total).toBe(13920);
    expect(s.toPay).toBe(3920);
    const r = btSettle({ ...base, advance: 5000 }, S, fx);
    expect([r.toPay, r.toReturn]).toEqual([0, 2000]);
  });
  it('missing NBRM rate is reported', () => {
    expect(btSettle({ ...base, costs: [{ k: 'other', d: 'x', amt: 5, cur: 'GBP' }] }, S, fx).miss).toEqual(['GBP']);
  });
});

describe('btEntries', () => {
  it('Д 44x / П 143x advance / П 241x to pay, balanced', () => {
    const s = btSettle({ ...base, vehicle: 'own', km: 100, advance: 2000 }, S, fx);
    const L = btEntries(base, s);
    expect(L.map((l) => [l.account, l.debit ?? 0, l.credit ?? 0])).toEqual([['4400', 3000, 0], ['4403', 2400, 0], ['1430', 0, 2000], ['2410', 0, 3400]]);
  });
  it('abroad kontos; unspent advance only up to the costs', () => {
    const t = { ...base, abroad: true, country: 'AL' };
    const s = btSettle({ ...t, advance: 100, advCur: 'EUR' }, S, fx);
    const L = btEntries(t, s);
    expect(L.map((l) => l.account)).toEqual(['44001', '1431']);
    expect(L[1]!.credit).toBe(L[0]!.debit);
  });
});

describe('helpers', () => {
  it('next number per year', () => {
    expect(btNextNo([{ number: '3/2026', date: '2026-02-01' }, { number: '9/2025', date: '2025-05-01' }], '2026-11-02')).toBe('4/2026');
  });
  it('report per employee skips cancelled', () => {
    const st = btSettle(base, S, fx);
    const R = btByEmployee([{ employeeId: 'e1', st }, { employeeId: 'e1', st }, { employeeId: 'e1', st, status: 'cancel' as const }]);
    expect(R).toHaveLength(1);
    expect(R[0]!.n).toBe(2);
    expect(R[0]!.total).toBe(6000);
  });
});
