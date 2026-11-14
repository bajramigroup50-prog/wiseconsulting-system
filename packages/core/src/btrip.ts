/**
 * ✈️ Службени патувања — патен налог per employee (domestic and abroad) and its settlement (пресметка):
 *
 * - per diems: abroad by country from the Уредба за издатоците за службени патувања и селидби во странство
 *   (`FR_COUNTRIES`, the same table as the drivers' per diems, the office codebook overrides it), in the country by the
 *   office's domestic amount (MKD; ЗПДД: tax-free up to 8% of the average net salary of the last 3 months). Time from
 *   departure to return (abroad: per country by the border crossings): each full 24 h = 1, remainder over 12 h = 1,
 *   8–12 h = ½, under 8 h = 0 (`frUnitsH`).
 * - reduction for provided meals / lodging: 100 / 50 / 20 % (`FR_REDUCTIONS`) or any % on the order.
 * - own car: km × fuel price per litre × 30% (Уредба), transport, lodging and other costs (any currency × NBRM rate).
 * - advance → amount to pay to the employee or to return.
 * - posting: Д 44x (per diems / lodging / transport / own car / other, domestic vs abroad) / П 143x advance / П 241x employee.
 */
import { FR_COUNTRIES, frPerDiems, frUnitsH, type FreightSegment } from './industry/transport';
import { num, r2 } from './industry/common';

export const BT_DOMESTIC = 'MK';
export type BtVehicle = 'own' | 'company' | 'public' | 'none';
export const BT_VEHICLES: readonly (readonly [BtVehicle, string])[] = [['company', 'Службено возило'], ['own', 'Сопствено возило'], ['public', 'Јавен превоз / авион'], ['none', 'Без возило']];
export type BtCostKind = 'transport' | 'lodging' | 'other';
export const BT_COST_KINDS: readonly (readonly [BtCostKind, string])[] = [['transport', 'Превоз (билет, гориво, патарина…)'], ['lodging', 'Сместување (ноќевање)'], ['other', 'Останато (виза, такси, осигурување…)']];
export const BT_REDUCTIONS: readonly (readonly [number, string])[] = [[100, 'цела дневница'], [50, '50% – обезбедено сместување со појадок'], [20, '20% – обезбедено сместување и исхрана (полн / полупансион)'], [0, 'без дневница (сите трошоци обезбедени)']];
export type BtStatus = 'open' | 'done' | 'cancel';
export const BT_STATUS: Readonly<Record<BtStatus, readonly [string, string]>> = { open: ['Отворен (на пат)', 'warn'], done: ['Пресметан', 'good'], cancel: ['Откажан', 'bad'] };

export interface BtCost { k: BtCostKind; d: string; amt: number | string; cur: string }
export interface BusinessTrip {
  number: string;
  /** Date of the order (налог). */
  date: string;
  employeeId: string;
  abroad: boolean;
  /** Destination (city / place) and main country code (abroad). */
  dest: string;
  country: string;
  purpose: string;
  vehicle: BtVehicle;
  plate?: string;
  km?: number | string | null;
  /** Departure / return `YYYY-MM-DDTHH:mm`. */
  dep: string;
  ret: string;
  /** Abroad: countries with the border crossings (`c: 'MK'` = time in the country). Empty = the main country dep → ret. */
  segs?: FreightSegment[];
  /** Per-diem %, 100 = full (provided meals / lodging lower it). */
  red?: number | string | null;
  costs?: BtCost[];
  advance?: number | string | null;
  advCur?: string;
  /** Date the advance was paid (rate of a foreign-currency advance). */
  advDate?: string | null;
  status?: BtStatus;
  /** Who approved / ordered the trip, report of the trip. */
  approver?: string;
  report?: string;
  note?: string;
}

/** The office's codebook: per-country overrides, the domestic per diem, own-car % and fuel price. */
export interface BtSettings {
  /** Domestic per diem in MKD (full day). */
  domAmt: number;
  /** Country code → [amount, currency], overrides `FR_COUNTRIES`. */
  rates: Record<string, [number, string]>;
  /** Own car: % of the fuel price per km (Уредба: 30%). */
  carPct: number;
  /** Price of a litre of fuel (MKD). */
  fuelPrice: number;
}
/**
 * Default codebook. `domAmt` ≈ 8% of the average net salary (ДЗС, last 3 months) — the office checks and updates it;
 * `fuelPrice` = Евро-супер 95 price per litre (Регулаторна комисија за енергетика), updated by the office.
 */
export const BT_DEFAULTS: BtSettings = { domAmt: 3700, rates: {}, carPct: 30, fuelPrice: 80 };

export function btSettings(...layers: (Partial<BtSettings> | null | undefined)[]): BtSettings {
  const o: BtSettings = { ...BT_DEFAULTS, rates: {} };
  for (const L of layers) {
    if (!L) continue;
    if (num(L.domAmt) > 0) o.domAmt = num(L.domAmt);
    if (L.carPct != null && String(L.carPct) !== '' && num(L.carPct) >= 0) o.carPct = num(L.carPct);
    if (num(L.fuelPrice) > 0) o.fuelPrice = num(L.fuelPrice);
    for (const [k, v] of Object.entries(L.rates ?? {})) if (Array.isArray(v) && num(v[0]) > 0) o.rates[k] = [num(v[0]), String(v[1] || 'EUR')];
  }
  return o;
}

/** Country list for the editor: the Уредба table with the codebook amounts applied. */
export function btCountries(s: BtSettings): { c: string; n: string; amt: number; cur: string; def: number; defCur: string }[] {
  return FR_COUNTRIES.map(([c, n, a, cur]) => ({ c, n, amt: s.rates[c]?.[0] ?? a, cur: s.rates[c]?.[1] ?? cur, def: a, defCur: cur }));
}
export const btCountryName = (c: string): string => (c === BT_DOMESTIC ? 'Македонија' : FR_COUNTRIES.find((x) => x[0] === c)?.[1] ?? c);

const valid = (d: string | null | undefined) => !!d && Number.isFinite(Date.parse(d));
export const btHours = (dep: string, ret: string): number => (valid(dep) && valid(ret) ? Math.max(0, r2((Date.parse(ret) - Date.parse(dep)) / 36e5)) : 0);
/** Per diems of a duration (re-export of the legal rule, for the domestic order and the tests). */
export const btUnits = (hrs: number): number => frUnitsH(hrs);

/** The order's segments: domestic = one `MK` segment dep → ret; abroad without segments = the main country dep → ret. */
export function btSegments(t: Pick<BusinessTrip, 'abroad' | 'country' | 'dep' | 'ret' | 'segs'>): FreightSegment[] {
  if (!t.abroad) return [{ c: BT_DOMESTIC, in: t.dep, out: t.ret }];
  const S = (t.segs ?? []).filter((g) => g.c);
  return S.length ? S : t.country ? [{ c: t.country, in: t.dep, out: t.ret }] : [];
}

export interface BtSettlement {
  hrs: number;
  units: number;
  /** Per-diem rows (country, hours, units, amount in currency, rate, MKD). */
  rows: { c: string; in: string; out: string; hrs: number | null; u: number; amt: number; cur: string; v: number; fx: number; m: number }[];
  perDiemBy: Record<string, number>;
  perDiem: number;
  car: number;
  costs: { k: BtCostKind; d: string; amt: number; cur: string; fx: number; m: number }[];
  transport: number;
  lodging: number;
  other: number;
  total: number;
  advance: number;
  toPay: number;
  toReturn: number;
  /** Currencies without an NBRM rate (amount counted as 0). */
  miss: string[];
}

/** `fx(cur, date)` = MKD per unit (MKD → 1; 0 = no rate). */
export function btSettle(t: BusinessTrip, s: BtSettings, fx: (cur: string, date: string) => number): BtSettlement {
  const F = (cur: string, d: string) => (cur === 'MKD' ? 1 : fx(cur, d));
  const red = t.red == null || String(t.red) === '' ? 100 : Math.min(100, Math.max(0, num(t.red)));
  const segs = btSegments(t);
  const ov: Record<string, [number, string]> = { ...s.rates, [BT_DOMESTIC]: [s.domAmt, 'MKD'] };
  // frPerDiems reads 0 as "100%": 0% (everything provided) zeroes the amounts below
  const d = frPerDiems({ red: red || 100, segs, date: t.ret || t.date }, F, ov);
  const miss = new Set(d.miss);
  const rows = d.rows.map((r) => ({ c: r.c, in: r.in, out: r.out, hrs: r.hrs == null ? null : r2(r.hrs), u: r.u, amt: r.amt, cur: r.cur, v: red ? r.v : 0, fx: r.fx, m: red ? r.m : 0 }));
  const perDiemBy: Record<string, number> = {};
  for (const r of rows) perDiemBy[r.cur] = r2((perDiemBy[r.cur] ?? 0) + r.v);
  const perDiem = r2(rows.reduce((a, r) => a + r.m, 0));
  const car = t.vehicle === 'own' ? r2(num(t.km) * s.fuelPrice * s.carPct / 100) : 0;
  const cd = (t.ret || t.date).slice(0, 10);
  const costs = (t.costs ?? []).filter((c) => num(c.amt)).map((c) => {
    const cur = c.cur || 'MKD';
    const rate = F(cur, cd) || 0;
    if (!rate) miss.add(cur);
    return { k: c.k, d: c.d, amt: r2(num(c.amt)), cur, fx: rate, m: r2(num(c.amt) * rate) };
  });
  const sum = (k: BtCostKind) => r2(costs.filter((c) => c.k === k).reduce((a, c) => a + c.m, 0));
  const transport = sum('transport'), lodging = sum('lodging'), other = sum('other');
  const total = r2(perDiem + car + transport + lodging + other);
  const ac = t.advCur || 'MKD';
  const ar = num(t.advance) ? F(ac, (t.advDate || t.date).slice(0, 10)) || 0 : 1;
  if (num(t.advance) && !ar) miss.add(ac);
  const advance = r2(num(t.advance) * ar);
  const diff = r2(total - advance);
  return {
    hrs: btHours(t.dep, t.ret), units: rows.reduce((a, r) => a + r.u, 0), rows, perDiemBy, perDiem, car, costs, transport, lodging, other, total, advance,
    toPay: diff > 0 ? diff : 0, toReturn: diff < 0 ? -diff : 0, miss: [...miss],
  };
}

/* ------------------------------------------------------------------ posting */

/** Scheme keys of the settlement (defaults from the chart: 440x costs, 143x advances, 241x liabilities). */
export const BT_SCHEME = {
  btDnD: '4400', btDnS: '44001', btLodD: '44010', btLodS: '44011', btTrD: '44020', btTrS: '44021', btCar: '4403', btOth: '4406',
  btAdvD: '1430', btAdvS: '1431', btEmpD: '2410', btEmpS: '2411',
} as const;
export type BtSchemeKey = keyof typeof BT_SCHEME;
export interface BtLine { account: string; debit?: number; credit?: number; note?: string }

/**
 * Journal of the settlement: Д costs / П advance (up to the costs — an unspent advance stays on 143x until returned)
 * / П the employee (amount to pay). `k(key)` = the firm's scheme konto.
 */
export function btEntries(t: Pick<BusinessTrip, 'abroad' | 'number'>, st: BtSettlement, k: (key: BtSchemeKey) => string = (x) => BT_SCHEME[x], who = ''): BtLine[] {
  const A = t.abroad;
  const L: BtLine[] = [];
  const dr = (key: BtSchemeKey, v: number, note: string) => { if (v > 0) L.push({ account: k(key), debit: r2(v), note }); };
  dr(A ? 'btDnS' : 'btDnD', st.perDiem, `Дневници ${st.units} · ${t.number}`);
  dr(A ? 'btLodS' : 'btLodD', st.lodging, `Сместување · ${t.number}`);
  dr(A ? 'btTrS' : 'btTrD', st.transport, `Превоз · ${t.number}`);
  dr('btCar', st.car, `Сопствено возило · ${t.number}`);
  dr('btOth', st.other, `Останати трошоци · ${t.number}`);
  const adv = r2(Math.min(st.advance, st.total));
  if (adv > 0) L.push({ account: k(A ? 'btAdvS' : 'btAdvD'), credit: adv, note: `Аконтација ${who} · ${t.number}`.trim() });
  if (st.toPay > 0) L.push({ account: k(A ? 'btEmpS' : 'btEmpD'), credit: st.toPay, note: `За исплата ${who} · ${t.number}`.trim() });
  return L;
}

/** Next order number `NN/YYYY` (highest of the year + 1). */
export function btNextNo(used: readonly { number: string | null; date: string | null }[], date: string): string {
  const y = date.slice(0, 4);
  const n = used.filter((u) => String(u.date ?? '').startsWith(y)).reduce((m, u) => Math.max(m, parseInt(String(u.number ?? ''), 10) || 0), 0);
  return `${n + 1}/${y}`;
}

/** Report rows per employee for a period (settled and open orders, cancelled left out). */
export function btByEmployee<T extends { employeeId: string; st: BtSettlement; status?: BtStatus }>(L: readonly T[]) {
  const M = new Map<string, { employeeId: string; n: number; days: number; perDiem: number; car: number; transport: number; lodging: number; other: number; total: number; advance: number; toPay: number; toReturn: number }>();
  for (const x of L) {
    if (x.status === 'cancel') continue;
    const r = M.get(x.employeeId) ?? { employeeId: x.employeeId, n: 0, days: 0, perDiem: 0, car: 0, transport: 0, lodging: 0, other: 0, total: 0, advance: 0, toPay: 0, toReturn: 0 };
    r.n++; r.days = r2(r.days + x.st.units);
    for (const f of ['perDiem', 'car', 'transport', 'lodging', 'other', 'total', 'advance', 'toPay', 'toReturn'] as const) r[f] = r2(r[f] + x.st[f]);
    M.set(x.employeeId, r);
  }
  return [...M.values()];
}
