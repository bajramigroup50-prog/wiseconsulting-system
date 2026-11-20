import { describe, expect, it } from 'vitest';
import { fxRevalPlan, monthEnd } from './fx-reval';
import { deferralError, deferralLines, deferralParts, deferralState, deferralSourceId, deferralTo, ymAdd, type Deferral } from './deferrals';

const K = { gain: '7810', loss: '4810' };

describe('fxRevalPlan', () => {
  it('books a gain when the rate went up and a loss when it went down', () => {
    const p = fxRevalPlan([
      { konto: '1030', cur: 'EUR', name: 'Халк EUR', balCur: 10000, balMkd: 615000, rate: 61.6950 },
      { konto: '1031', cur: 'USD', name: 'НЛБ USD', balCur: 2000, balMkd: 112000, rate: 55.1463 },
    ], K);
    expect(p.rows.map((r) => r.diff)).toEqual([1950, -1707.4]);
    expect(p.gain).toBe(1950);
    expect(p.loss).toBe(1707.4);
    expect(p.lines).toEqual([
      expect.objectContaining({ account: '1030', debit: 1950, credit: 0 }),
      expect.objectContaining({ account: '7810', debit: 0, credit: 1950 }),
      expect.objectContaining({ account: '4810', debit: 1707.4, credit: 0 }),
      expect.objectContaining({ account: '1031', debit: 0, credit: 1707.4 }),
    ]);
    const d = p.lines.reduce((s, l) => s + l.debit, 0), c = p.lines.reduce((s, l) => s + l.credit, 0);
    expect(d).toBeCloseTo(c, 2);
  });

  it('skips accounts without a currency balance, with a skip reason, and rounding noise under 1 denar', () => {
    const p = fxRevalPlan([
      { konto: '1030', cur: 'EUR', name: 'a', balCur: null, balMkd: 5000, rate: 61.5 },
      { konto: '1032', cur: 'EUR', name: 'b', balCur: 100, balMkd: 6169, rate: 61.695, skip: 'конто со две валути' },
      { konto: '1033', cur: 'EUR', name: 'c', balCur: 100, balMkd: 6169.2, rate: 61.695 },
    ], K);
    expect(p.lines).toEqual([]);
    expect(p.rows.every((r) => r.diff === 0)).toBe(true);
  });

  it('revalues an overdraft (negative balance in currency) the other way round', () => {
    const p = fxRevalPlan([{ konto: '1030', cur: 'EUR', name: 'a', balCur: -1000, balMkd: -61500, rate: 61.7 }], K);
    expect(p.rows[0]!.diff).toBe(-200);
    expect(p.loss).toBe(200);
  });

  it('monthEnd', () => {
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
    expect(monthEnd('2026-12')).toBe('2026-12-31');
  });
});

const D: Deferral = { id: 'd1', name: 'Осигурување возила', kind: 'cost', amount: 10000, from: '2026-11', months: 12, konto: '4490', defKonto: '1909' };

describe('deferrals', () => {
  it('splits in equal parts; the last month takes the remainder', () => {
    const P = deferralParts(D);
    expect(P).toHaveLength(12);
    expect(P[0]).toEqual({ ym: '2026-11', amount: 833.33, no: 1 });
    expect(P[1]!.ym).toBe('2026-12');
    expect(P[2]!.ym).toBe('2027-01');
    expect(P[11]).toEqual({ ym: '2027-10', amount: 833.37, no: 12 });
    expect(Math.round(P.reduce((s, p) => s + p.amount, 0) * 100)).toBe(1000000);
    expect(deferralTo(D)).toBe('2027-10');
  });

  it('cost: Д трошок / П 1909; income: Д 2930 / П приход', () => {
    const p = deferralParts(D)[0]!;
    expect(deferralLines(D, p).map((l) => [l.account, l.debit, l.credit])).toEqual([['4490', 833.33, 0], ['1909', 0, 833.33]]);
    const I: Deferral = { ...D, kind: 'income', konto: '7400', defKonto: '2930' };
    expect(deferralLines(I, p).map((l) => [l.account, l.debit, l.credit])).toEqual([['2930', 833.33, 0], ['7400', 0, 833.33]]);
  });

  it('state: booked months, remaining and the months due up to a month', () => {
    const s = deferralState(D, new Set([deferralSourceId('d1', '2026-11')]), '2027-01');
    expect(s.posted).toBe(833.33);
    expect(s.remaining).toBe(9166.67);
    expect(s.due.map((p) => p.ym)).toEqual(['2026-12', '2027-01']);
    expect(deferralState({ ...D, stopped: true }, new Set(), '2027-01').due).toEqual([]);
  });

  it('ymAdd', () => {
    expect(ymAdd('2026-12', 1)).toBe('2027-01');
    expect(ymAdd('2026-01', -1)).toBe('2025-12');
    expect(ymAdd('2026-05', 24)).toBe('2028-05');
  });

  it('validation', () => {
    expect(deferralError(D)).toBeNull();
    expect(deferralError({ ...D, konto: '7400' })).toMatch(/класа 4/);
    expect(deferralError({ ...D, months: 0 })).toMatch(/месеци/);
    expect(deferralError({ ...D, amount: 0 })).toMatch(/Износот/);
    expect(deferralError({ ...D, defKonto: '4490' })).toMatch(/различни/);
  });
});
