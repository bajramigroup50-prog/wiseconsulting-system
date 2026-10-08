/**
 * Statutory payroll parameters (legacy `PAY_DEF`, `PAY_KEYS`, `payRows`, `paramsFor`, `mpinOfficial`).
 *
 * DELIBERATE FIX (LEGACY-MAP 6.4 #1, top-fix #5): legacy `grossFromNet`, `empCalc`,
 * `readEmployeeDocs` and v1 `payrollCalc` silently fell back to PIO 18.8% / вработување 1.2%
 * whenever a key was missing from `params`, while the dated table `PAY_DEF` (and the
 * УЈП MPIN 2026 file) use PIO 19.9% / вработување 0.1%. The total (28%) is identical, but
 * the split per fund — and therefore the MPIN file and the 234x postings — differed.
 * Here the dated table is the ONE parameter source: `resolvePayParams` fills any missing key
 * from the row valid for the payroll month, and `empCalc` refuses incomplete params.
 *
 * Overrides (legacy global `settings/pay`) are passed in explicitly, so the caller can
 * scope them per firm (LEGACY-MAP 6.4 #10).
 */
import PAY_DEF_JSON from '../data/payroll-params.json';

/** Rate/amount keys that every payroll calculation needs. */
export const PAY_RATE_KEYS = ['avg', 'minBase', 'maxBase', 'exempt', 'minGross', 'minNet', 'pio', 'zdr', 'dop', 'vrab', 'tax'] as const;
export type PayRateKey = (typeof PAY_RATE_KEYS)[number];

/** Complete parameter set used by a payroll run (`payroll.params` in legacy v2). Percentages are in %, amounts in denars. */
export type PayParams = Record<PayRateKey, number> & {
  /** Monthly hour fund (Mon–Fri × 8) of the payroll month. Defaults to 176 like legacy. */
  hours?: number;
  /** `from` of the parameter row the run was created with. */
  pfrom?: string;
};

/** A dated parameter row (legacy `PAY_DEF` row / `settings/pay` row). */
export type PayParamRow = Partial<Record<PayRateKey, number>> & {
  from: string;
  src?: string;
  user?: boolean;
};

/** Statutory 2026 parameter rows, valid from the given month (YYYY-MM) until the next row. */
export const PAY_DEF: readonly (Record<PayRateKey, number> & { from: string; src: string })[] = PAY_DEF_JSON;

/** Field labels for the parameter editor (legacy `PAY_KEYS`). */
export const PAY_KEYS: readonly (readonly [string, string])[] = [
  ['from', 'Важи од (месец)'],
  ['avg', 'Просечна бруто плата'],
  ['minBase', 'Најниска основица'],
  ['maxBase', 'Највисока основица'],
  ['exempt', 'Даночно ослободување'],
  ['minGross', 'Мин. плата бруто'],
  ['minNet', 'Мин. плата нето'],
  ['pio', 'ПИО %'],
  ['zdr', 'Здравство %'],
  ['dop', 'Доп. здр. %'],
  ['vrab', 'Вработување %'],
  ['tax', 'Данок %'],
  ['src', 'Извор / белешка'],
];

const has = (v: unknown): boolean => v != null && v !== '' && Number.isFinite(+(v as number));

/** `PAY_DEF` merged with override rows (same `from` → merged, new `from` → added), sorted by `from`. Legacy `payRows`. */
export function payRows(overrides: readonly PayParamRow[] = []): PayParamRow[] {
  const M = new Map<string, PayParamRow>(PAY_DEF.map((r) => [r.from, { ...r }]));
  for (const r of overrides) if (r && r.from) M.set(r.from, { ...(M.get(r.from) || {}), ...r, user: true });
  return [...M.values()].sort((a, b) => (a.from < b.from ? -1 : 1));
}

/** Parameter row valid for `month` (YYYY-MM); before the first row the first row is used (legacy `paramsFor`). */
export function paramsFor(month: string, overrides: readonly PayParamRow[] = []): PayParamRow {
  const R = payRows(overrides);
  let cur = R[0]!;
  for (const r of R) if (r.from <= month) cur = r;
  return cur;
}

/**
 * Effective parameters for `month`: rows up to the month merged in date order, so a row only
 * needs the keys that change (e.g. an override `{from:'2027-01', avg:72000}` keeps the other
 * 2026 values). Legacy `paramsFor` returned such a partial row as-is and the calculation then
 * fell back to the old hard-coded rates.
 */
export function effectiveParams(month: string, overrides: readonly PayParamRow[] = []): PayParamRow {
  const R = payRows(overrides);
  let cur: PayParamRow = { ...R[0]! };
  for (const r of R.slice(1)) {
    if (r.from > month) break;
    const def = Object.fromEntries(Object.entries(r).filter(([, v]) => v != null && v !== ''));
    cur = { ...cur, ...def } as PayParamRow;
  }
  return cur;
}

/** Official УЈП row for the month — `PAY_DEF` only, ignoring overrides (legacy `mpinOfficial`). */
export function mpinOfficial(month: string): PayParamRow {
  return paramsFor(month, []);
}

/**
 * Complete the params of a payroll run: keys present (and numeric) in `params` win, every missing
 * key comes from the dated row for `month` (with overrides). Throws if a key is still missing.
 */
export function resolvePayParams(
  params: Partial<Record<PayRateKey, number | string>> & { hours?: number | string; pfrom?: string } | null | undefined,
  month: string,
  overrides: readonly PayParamRow[] = [],
): PayParams {
  const row = effectiveParams(month, overrides);
  const out: Partial<PayParams> = {};
  for (const k of PAY_RATE_KEYS) {
    const v = params?.[k];
    out[k] = has(v) ? +(v as number) : (row[k] as number);
  }
  if (params && has(params.hours)) out.hours = +(params.hours as number);
  if (params?.pfrom) out.pfrom = params.pfrom;
  assertPayParams(out);
  return out;
}

/** Throws when any statutory key is missing / not numeric — no silent fallbacks to old rates. */
export function assertPayParams(P: Partial<PayParams> | null | undefined): asserts P is PayParams {
  const miss = PAY_RATE_KEYS.filter((k) => !P || !has(P[k]));
  if (miss.length) throw new Error('Payroll params missing: ' + miss.join(', '));
}

/** Differences between the run's params and the official УЈП row (legacy `mpinParamDiff`). Empty = MPIN header will be accepted. */
export function mpinParamDiff(month: string, params: Partial<PayParams> | null | undefined): string[] {
  const O = mpinOfficial(month) as Record<string, unknown>;
  const P = (params || {}) as Record<string, unknown>;
  const N: Record<string, string> = {
    avg: 'Просечна плата',
    exempt: 'Даночно ослободување',
    pio: 'ПИО %',
    zdr: 'Здравство %',
    dop: 'Доп. здравство %',
    vrab: 'Вработување %',
    tax: 'Данок %',
  };
  return Object.keys(N)
    .filter((k) => Math.abs((+(P[k] as number) || 0) - (+(O[k] as number) || 0)) > 1e-9)
    .map((k) => `${N[k]}: ${P[k] ?? '—'} → ${O[k]}`);
}
