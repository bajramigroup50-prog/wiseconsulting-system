import { describe, expect, it } from 'vitest';
import { activityKey, benchCompare, benchMetrics, quartiles, ratiosFromBalance, type BenchMetrics } from './fin-bench';

describe('quartiles', () => {
  it('interpolates like QUARTILE.INC and ignores nulls', () => {
    expect(quartiles([1, 2, 3, 4, 5, null])).toEqual({ n: 5, q1: 2, med: 3, q3: 4 });
    expect(quartiles([10, 20, 30, 40])).toEqual({ n: 4, q1: 17.5, med: 25, q3: 32.5 });
    expect(quartiles([null, undefined])).toBeNull();
  });
});

describe('ratiosFromBalance / benchMetrics', () => {
  // revenue 1000 (credit on 740), cost of goods 600 (debit 700), other cost 300 (420); cash 500, receivables 236, payables 200
  const B = { '740': -1000, '700': 600, '420': 300, '1000': 500, '120': 236, '220': -200 };
  it('derives revenue, margins and DSO from the balances alone', () => {
    const r = ratiosFromBalance(B, 365);
    expect(r.rev).toBe(1000);
    expect(r.res).toBe(100);
    expect(r.gm).toBe(40);
    expect(r.nm).toBe(10);
    expect(r.dso).toBe(73); // 236 / (1000 × 1,18) × 365
    expect(r.cur).toBe(3.68);
  });
  it('gives a health score, none for an empty firm', () => {
    const m = benchMetrics(B, 365);
    expect(m.score).toBeGreaterThan(50);
    expect(benchMetrics({}, 365)).toEqual({ gm: null, nm: null, dso: null, cur: null, score: null });
  });
});

describe('benchCompare', () => {
  const p = (gm: number, dso: number): BenchMetrics => ({ gm, nm: 5, dso, cur: 1.5, score: 60 });
  const peers = [p(10, 30), p(20, 40), p(30, 50), p(40, 60), p(50, 70)];
  it('is hidden with fewer than 3 peers', () => {
    expect(benchCompare(p(1, 1), peers.slice(0, 2))).toBeNull();
  });
  it('places the firm in the best / worst quarter, lower DSO is better', () => {
    const R = benchCompare({ gm: 45, nm: 5, dso: 80, cur: null, score: 60 }, peers)!;
    const by = Object.fromEntries(R.map((r) => [r.key, r]));
    expect(by.gm!.q).toEqual({ n: 5, q1: 20, med: 30, q3: 40 });
    expect(by.gm!.pos).toBe('top');
    expect(by.dso!.pos).toBe('low');
    expect(by.nm!.pos).toBe('mid');
    expect(by.cur!.pos).toBe('');
    expect(benchCompare({ gm: 5, nm: 5, dso: 20, cur: 1.5, score: 60 }, peers)!.find((r) => r.key === 'dso')!.pos).toBe('top');
  });
  it('gives no quartiles for a metric with too few values', () => {
    const R = benchCompare(p(1, 1), [p(1, 1), p(2, 2), { gm: null, nm: null, dso: null, cur: null, score: null }])!;
    expect(R.find((r) => r.key === 'gm')!.q).toBeNull();
  });
});

describe('activityKey', () => {
  it('normalizes case, quotes and spaces', () => {
    expect(activityKey(' 47.11  Трговија „на мало“ ')).toBe(activityKey('47.11 трговија на мало'));
  });
});
