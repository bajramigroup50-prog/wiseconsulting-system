/**
 * 📈 Benchmark „Споредба со дејноста“ (Анализи): the open firm against the other office firms of the same activity,
 * anonymously — medians and quartiles of gross margin, net margin, DSO, current ratio and the health score. Every
 * firm is computed from one account → (debit − credit) map of the year (one SQL aggregation, not every ledger line),
 * with the same `ratios` / `healthScore` as the firm's own tabs.
 */
import { dashAgg, healthScore, ratios, type Ratios } from './analysis';

/** Fewer comparable firms than this → the benchmark is hidden (anonymity, meaningful medians). */
export const BENCH_MIN_PEERS = 3;

export interface BenchMetrics { gm: number | null; nm: number | null; dso: number | null; cur: number | null; score: number | null }

/** `ratios` from a year-to-date balance map alone (revenue / expenses come from the class 4 / 7 balances; no DPO). */
export function ratiosFromBalance(balance: Readonly<Record<string, number>>, days: number): Ratios {
  const L = Object.entries(balance).map(([account, v]) => ({ date: 'x', account, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0 }));
  return ratios({ balance, agg: dashAgg(L, 'x', 'x'), purchases: 0, days });
}

/**
 * Metrics of one firm. The health score has no 13-week forecast here (that needs the documents of each firm): the
 * forecast's lowest balance is replaced by today's cash, the runway is left out. A firm without revenue has no margins.
 */
export function benchMetrics(balance: Readonly<Record<string, number>>, days: number): BenchMetrics {
  const r = ratiosFromBalance(balance, days);
  const any = Object.values(balance).some((v) => Math.abs(v) > 0.005);
  const h = any ? healthScore({ balance, r, minBal: r.cash, avgOut: 0 }) : null;
  return { gm: r.gm, nm: r.nm, dso: r.dso, cur: r.cur, score: h ? h.score : null };
}

export interface Quart { n: number; q1: number; med: number; q3: number }

/** Quartiles with linear interpolation (like Excel QUARTILE.INC); null when there are no values. */
export function quartiles(values: readonly (number | null | undefined)[]): Quart | null {
  const a = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const q = (p: number) => { const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return Math.round((a[lo]! + (a[hi]! - a[lo]!) * (i - lo)) * 100) / 100; };
  return { n: a.length, q1: q(0.25), med: q(0.5), q3: q(0.75) };
}

export const BENCH_KEYS = [
  ['gm', 'Бруто маржа', '%', 'hi'], ['nm', 'Нето маржа', '%', 'hi'], ['dso', 'Денови на наплата (DSO)', 'дена', 'lo'],
  ['cur', 'Тековна ликвидност', '', 'hi'], ['score', 'Финансиско здравје', '/ 100', 'hi'],
] as const satisfies readonly (readonly [keyof BenchMetrics, string, string, 'hi' | 'lo'])[];

export type BenchPos = 'top' | 'mid' | 'low' | '';
export interface BenchRow { key: keyof BenchMetrics; name: string; unit: string; better: 'hi' | 'lo'; own: number | null; q: Quart | null; pos: BenchPos }

/**
 * One row per metric: the firm's value, the peers' quartiles and where the firm stands — `top` = in the best quarter
 * (above Q3, or below Q1 when lower is better), `low` = in the worst quarter, `mid` in between. Null (hidden) with
 * fewer than `min` peers; a metric that fewer than `min` peers have data for gets no quartiles.
 */
export function benchCompare(own: BenchMetrics, peers: readonly BenchMetrics[], min = BENCH_MIN_PEERS): BenchRow[] | null {
  if (peers.length < min) return null;
  return BENCH_KEYS.map(([key, name, unit, better]) => {
    const q = quartiles(peers.map((p) => p[key]));
    const v = own[key];
    let pos: BenchPos = '';
    if (q && q.n >= min && v != null) {
      const hiQ = v > q.q3, loQ = v < q.q1;
      pos = better === 'hi' ? (hiQ ? 'top' : loQ ? 'low' : 'mid') : (loQ ? 'top' : hiQ ? 'low' : 'mid');
    }
    return { key, name, unit, better, own: v, q: q && q.n >= min ? q : null, pos };
  });
}

/** Normalized activity text for matching firms of the same activity (case, spaces, quotes, leading NKD code kept). */
export const activityKey = (s: string | null | undefined): string =>
  String(s ?? '').toLowerCase().replace(/[„“"'«»]/g, '').replace(/\s+/g, ' ').trim();
