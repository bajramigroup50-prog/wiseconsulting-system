/**
 * Fuel-card statements (DKV, Shell, OMV, Eurowag, UTA…) — legacy `FR_COLS`, `ACT.frGRead`, `frNum`, `frDate`,
 * `ACT.frGSave`, the month table of `VIEWS.frGor` 14624 and `frTourFuel` / `frCost` 14470.
 *
 * Fuel is never booked from here: the card issuer's purchase invoice books it. The rows are used for the per-vehicle
 * month overview and, by registration plate and date, for the costs of a freight tour.
 */
import { num, r2 } from './common';
import { frTourWindow, plateKey, type FreightSegment } from './transport';

export type FuelCol = 'd' | 'plate' | 'ctry' | 'prod' | 'qty' | 'amt' | 'cur';
export const FUEL_COLS: readonly (readonly [FuelCol, string, RegExp])[] = [
  ['d', 'Датум', /^(datum|date|datum transakcije|transaction date|lieferdatum|tankdatum|датум)/i],
  ['plate', 'Регистрација', /(kennzeichen|plate|registr|license|licence|vehicle|kfz|регистр|возило)/i],
  ['ctry', 'Држава', /^(land|country|držav|drzav|држав|country code)/i],
  ['prod', 'Производ', /(produkt|product|artikel|warenart|производ|артикл)/i],
  ['qty', 'Литри', /(menge|liter|litre|quantity|qty|volume|колич|литр)/i],
  ['amt', 'Износ (бруто)', /(brutto|gross|betrag|amount|total|износ|вкупно)/i],
  ['cur', 'Валута', /(währung|wahrung|currency|valuta|валута)/i],
];
export const FUEL_MAX_ROWS = 5000;

export interface FuelRow { d: string; plate: string; ctry?: string; prod?: string; qty: number; amt: number; cur: string }
export type FuelMap = Partial<Record<FuelCol, number>>;

/** Legacy `frGRead`: header row = first row with ≥ 3 recognised columns (else the first row); columns matched in order. */
export function detectFuelColumns(aoa: readonly (readonly unknown[])[]): { hi: number; head: string[]; map: FuelMap } {
  let hi = aoa.findIndex((r) => r.filter((x) => FUEL_COLS.some((c) => c[2].test(String(x ?? '').trim()))).length >= 3);
  if (hi < 0) hi = 0;
  const head = (aoa[hi] ?? []).map((x) => String(x ?? '').trim());
  const map: FuelMap = {};
  for (const [k, , rx] of FUEL_COLS) {
    const i = head.findIndex((x, j) => rx.test(x) && !Object.values(map).includes(j));
    if (i >= 0) map[k] = i;
  }
  return { hi, head, map };
}

/** Legacy `frNum`: `1.234,56`, `1,234.56`, `12,5`, numbers. */
export function fuelNum(x: unknown): number {
  if (typeof x === 'number') return x;
  let s = String(x ?? '').replace(/\s/g, '');
  if (/,\d{1,3}$/.test(s) && s.indexOf('.') < s.lastIndexOf(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/,\d{1,3}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  return Number(s) || 0;
}

/** Legacy `frDate`: Date, Excel serial, `YYYY-MM-DD…`, `D.M.YYYY` / `D/M/YY` → `YYYY-MM-DD` ('' when unknown). */
export function fuelDate(x: unknown): string {
  if (x instanceof Date && !Number.isNaN(+x)) return new Date(x.getTime() - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  if (typeof x === 'number' && x > 20000 && x < 80000) return new Date(Math.round((x - 25569) * 864e5)).toISOString().slice(0, 10);
  const s = String(x ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    const y = m[3]!.length === 2 ? '20' + m[3] : m[3]!;
    return `${y}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  }
  return '';
}

/**
 * Legacy `frGSave`: rows of the sheet (after the header) → fuel rows; date, plate and amount are required; currency
 * from its column (3 letters) or `defCur`. Errors are user messages.
 */
export function fuelRowsFromSheet(rows: readonly (readonly unknown[])[], map: FuelMap, defCur: string): { rows: FuelRow[]; error: string | null } {
  if (map.d == null || map.plate == null || map.amt == null) return { rows: [], error: 'Изберете ги барем колоните Датум, Регистрација и Износ.' };
  const cell = (r: readonly unknown[], k: FuelCol) => (map[k] == null ? '' : r[map[k]!]);
  const out = rows.filter((r) => r.some((x) => String(x ?? '').trim() !== '')).map((r) => {
    const cur = String(cell(r, 'cur') ?? '').trim();
    return {
      d: fuelDate(cell(r, 'd')), plate: String(cell(r, 'plate') ?? '').trim(), ctry: String(cell(r, 'ctry') ?? '').trim(), prod: String(cell(r, 'prod') ?? '').trim(),
      qty: map.qty != null ? r2(fuelNum(cell(r, 'qty'))) : 0, amt: r2(fuelNum(cell(r, 'amt'))), cur: map.cur != null && cur ? cur.toUpperCase().slice(0, 3) : defCur,
    };
  }).filter((r) => r.d && r.plate && r.amt);
  if (!out.length) return { rows: [], error: 'Нема важечки редови (датум, регистрација, износ).' };
  if (out.length > FUEL_MAX_ROWS) return { rows: [], error: `Премногу редови во една датотека (најмногу ${FUEL_MAX_ROWS}) – поделете ја.` };
  return { rows: out, error: null };
}

/** Legacy `VIEWS.frGor` month table: per plate fill-ups, litres, amount per currency, MKD (missing rates listed). */
export function fuelByPlate(rows: readonly FuelRow[], month: string, fx: (cur: string, date: string) => number) {
  const agg = new Map<string, { plate: string; l: number; mkd: number; n: number; by: Record<string, number> }>();
  const miss = new Set<string>();
  for (const r of rows) {
    if (String(r.d).slice(0, 7) !== month) continue;
    const k = plateKey(r.plate) || '?';
    const a = agg.get(k) ?? { plate: r.plate, l: 0, mkd: 0, n: 0, by: {} };
    agg.set(k, a);
    a.l += num(r.qty);
    const cur = r.cur || 'MKD';
    const rate = cur !== 'MKD' ? fx(cur, r.d) || 0 : 1;
    if (!rate) miss.add(cur);
    a.mkd += num(r.amt) * rate;
    a.by[cur] = r2((a.by[cur] ?? 0) + num(r.amt));
    a.n++;
  }
  return { rows: [...agg.values()].map((a) => ({ ...a, l: r2(a.l), mkd: r2(a.mkd) })).sort((a, b) => b.mkd - a.mkd), miss: [...miss] };
}

/** Legacy `frTourFuel` with the FIX 10.4 item 14 window ({@link frTourWindow}): fuel of the tour's vehicle in MKD. */
export function tourFuel(rows: readonly FuelRow[], plate: string | null | undefined, t: { date: string; unloadDate?: string | null; retDate?: string | null; segs?: readonly FreightSegment[] }, fx: (cur: string, date: string) => number) {
  const p = plateKey(plate);
  if (!p) return { mkd: 0, l: 0, n: 0 };
  const [a, b] = frTourWindow(t);
  let mkd = 0, l = 0, n = 0;
  for (const r of rows) {
    if (plateKey(r.plate) !== p) continue;
    const d = String(r.d ?? '').slice(0, 10);
    if (!d || d < a || d > b) continue;
    mkd += num(r.amt) * (r.cur && r.cur !== 'MKD' ? fx(r.cur, d) || 0 : 1);
    l += num(r.qty);
    n++;
  }
  return { mkd: r2(mkd), l: r2(l), n };
}

/** Legacy `frCurTxt`: `120,00 EUR + 3.000,00 MKD`. */
export const currencyText = (by: Readonly<Record<string, number>>, f: (v: number) => string): string =>
  Object.entries(by).filter(([, v]) => v).map(([c, v]) => `${f(v)} ${c}`).join(' + ') || '—';
