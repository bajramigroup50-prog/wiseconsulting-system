/**
 * Fixed-asset depreciation (legacy `depFor` 5861, `runDep` ACT 7239, `DEP_PRESETS` 3183).
 *
 * Straight line, monthly, starting the month AFTER the acquisition date, capped at cost.
 *
 * Deliberate fixes (LEGACY-MAP §8.4 item 9):
 *  - D1 `runDep` debited 4300 and credited EVERYTHING to 0190 "Амортизација на градежни објекти", which ZS_DEF maps
 *       to bs012 (buildings). `depEntries` now books per asset group: 00x → 4300 / 009x, 010–012 → 4301 / 0190–0192,
 *       013 → 4302 / 0193, 014 → 4303 / 0194, 015 → 4303 / 0195 (KONTO_SRC names; ZS_DEF reads 009x/019x per group).
 *  - D2 `DEP_PRESETS` used 0120 for buildings (0120 is "Постројки"), 0140 for vehicles (biological assets) and 0130
 *       twice. Fixed presets use the chart's own groups.
 *  - D3 assets flagged `vehicleOnly` (fleet records, not owned assets) were depreciated although the year-end check
 *       ignores them; they are now skipped. A `disposed` date stops depreciation after that month.
 *  - D4 `new Date('YYYY-MM-DD')` parses as UTC and `getMonth()` reads local time, so west-of-UTC servers shifted the
 *       start month; the date string is now parsed directly. Missing/invalid dates give 0 instead of NaN.
 */
import { r2 } from '../money';
import type { YeLine } from './balances';

export interface DepAsset {
  id: string;
  name?: string;
  konto: string;
  /** annual rate in % */
  rate: number | string;
  /** acquisition date YYYY-MM-DD */
  date: string;
  cost: number | string;
  vehicleOnly?: boolean;
  /** disposal / write-off date YYYY-MM-DD (new) */
  disposed?: string;
}

export interface DepRow {
  id: string;
  /** depreciation of the year */
  year: number;
  /** accumulated depreciation at year end */
  acc: number;
  konto: string;
}

const ym = (d: string | undefined): number | null => {
  const m = /^(\d{4})-(\d{2})/.exec(String(d || ''));
  if (!m) return null;
  return +m[1]! * 12 + +m[2]!; // month index, 1-based month
};

export interface DepOptions {
  /** reproduce legacy: depreciate `vehicleOnly` assets and ignore `disposed` */
  legacy?: boolean;
}

/** Depreciation for `year` (legacy `depFor`). */
export function depFor(assets: readonly DepAsset[], year: number, opt: DepOptions = {}): { rows: DepRow[]; total: number } {
  const rows: DepRow[] = [];
  let total = 0;
  for (const a of assets) {
    if (!opt.legacy && a.vehicleOnly) continue;
    const s0 = ym(a.date);
    const cost = +a.cost || 0;
    if (s0 == null) {
      rows.push({ id: a.id, year: 0, acc: 0, konto: a.konto });
      continue;
    }
    // legacy: sm = Y*12 + (month0) + 1 = month after acquisition, in "Y*12 + month0" units
    const sm = s0; // s0 = Y*12 + month(1..12) == Y*12 + month0 + 1
    const end = !opt.legacy ? ym(a.disposed) : null; // last month that is still depreciated (inclusive), as Y*12+month0
    const annual = (cost * (+a.rate || 0)) / 100;
    const monthsTo = (y: number) => {
      const hi = end != null ? Math.min(y * 12 + 12, end) : y * 12 + 12;
      return Math.max(0, Math.min(12, hi - Math.max(sm, y * 12)));
    };
    const startY = Math.floor((s0 - 1) / 12);
    let prev = 0;
    for (let y = startY; y < year; y++) prev += (annual * monthsTo(y)) / 12;
    prev = Math.min(prev, cost);
    const yr = r2(Math.min((annual * monthsTo(year)) / 12, cost - prev));
    rows.push({ id: a.id, year: yr, acc: r2(prev + yr), konto: a.konto });
    total += yr;
  }
  return { rows, total: r2(total) };
}

/** Expense / accumulated-depreciation accounts for an asset konto (fix D1). */
export function depAccounts(assetKonto: string): { expense: string; accumulated: string } {
  const k = String(assetKonto || '');
  if (/^00/.test(k)) {
    const g = k.slice(0, 3);
    const acc = g === '000' || g === '001' ? '0090' : g === '002' ? '0091' : g === '003' ? '0092' : g === '004' ? '0093' : '0097';
    return { expense: '4300', accumulated: acc };
  }
  if (/^01[01]/.test(k)) return { expense: '4301', accumulated: '0190' };
  if (/^012/.test(k)) return { expense: '4301', accumulated: '0192' };
  if (/^013/.test(k)) return { expense: '4302', accumulated: '0193' };
  if (/^014/.test(k)) return { expense: '4303', accumulated: '0194' };
  return { expense: '4303', accumulated: '0195' };
}

/** Journal lines for `dep-<year>` (legacy `runDep`: one 4300 / 0190 pair), grouped per expense and accumulated account. */
export function depEntries(rows: readonly DepRow[], opt: DepOptions = {}): YeLine[] {
  if (opt.legacy) {
    const t = r2(rows.reduce((s, r) => s + r.year, 0));
    return [
      { account: '4300', debit: t, credit: 0 },
      { account: '0190', debit: 0, credit: t },
    ];
  }
  const D: Record<string, number> = {};
  const P: Record<string, number> = {};
  for (const r of rows) {
    if (!r.year) continue;
    const { expense, accumulated } = depAccounts(r.konto);
    D[expense] = r2((D[expense] || 0) + r.year);
    P[accumulated] = r2((P[accumulated] || 0) + r.year);
  }
  return [
    ...Object.entries(D)
      .sort()
      .map(([account, v]) => ({ account, debit: v, credit: 0 })),
    ...Object.entries(P)
      .sort()
      .map(([account, v]) => ({ account, debit: 0, credit: v })),
  ];
}

/** Depreciation presets `[konto, label, rate %]` (fix D2; legacy list in data/yearend-misc.json `depPresetsLegacy`). */
export const DEP_PRESETS: readonly (readonly [string, string, number])[] = [
  ['0110', 'Градежни објекти', 2.5],
  ['0120', 'Постројки и опрема', 10],
  ['0136', 'Транспортни средства (моторни возила)', 20],
  ['0135', 'Мебел', 10],
  ['0134', 'Канцелариски инвентар и компјутери', 25],
];
