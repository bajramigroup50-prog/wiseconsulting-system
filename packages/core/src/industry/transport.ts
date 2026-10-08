/**
 * Transport: travel orders (legacy `pn*` 9223–9488) and freight for third parties (v469, 14439–14716).
 *
 * Travel orders: stops built from the day's documents, load in kg, odometer, duration and domestic per diem,
 * fuel consumption per vehicle. Freight: per diems abroad (Уредба за издатоците за службени патувања во странство,
 * table `FR_CTRY`), tour cost and result.
 */
import { num, r2 } from './common';

/* ================================================================== travel orders */

export const TRAVEL_ORDER_STATUS = { open: ['подготвен', 'info'], onroad: ['на пат', 'warn'], done: ['завршен', 'good'] } as const;

export interface TravelGood { itemId?: string | null; ix?: number; name: string; qty: number | string; unit?: string | null; kg?: number | null; loaded?: boolean }
export interface TravelStop {
  ref?: { type: 'invoice' | 'dispatch' | 'purchase'; id: string } | null;
  kind: 'pick' | 'deliv'; doc: string; partner: string; partnerId?: string | null; email?: string | null; addr?: string | null;
  goods: TravelGood[]; amt?: number; open?: number; status: 'open' | 'done';
  at?: string | null; recv?: string | null; cash?: number | null; ret?: { k: number; qty: number }[] | null; geo?: { lat: number; lon: number } | null;
  /** Cash voucher booked from this stop / return credit note made from it (FIX: legacy matched by `pnRef` strings). */
  cashVoucherId?: string | null; returnCreditId?: string | null; mailed?: string | null;
}
export interface TravelEvent { k: 'dep' | 'pick' | 'deliv' | 'ret' | 'note'; txt: string; at: string; by?: string | null; geo?: { lat: number; lon: number } | null }

export interface TransportConfig { vehicleId: string; driverId: string; assignee: string; from: string; dnevAmt: number | ''; dnevOn: boolean }
export const TRANSPORT_DEFAULTS: TransportConfig = { vehicleId: '', driverId: '', assignee: '', from: '', dnevAmt: '', dnevOn: false };
export const transportConfig = (o: Partial<TransportConfig> | null | undefined): TransportConfig => ({ ...TRANSPORT_DEFAULTS, ...(o ?? {}) });

/** Legacy `pnNextNo`: `001/2026`. */
export function travelOrderNo(used: readonly (string | null | undefined)[], year: string | number): string {
  const n = used.map((x) => parseInt(String(x ?? '').replace(/\/.*$/, ''), 10) || 0);
  return String((n.length ? Math.max(...n) : 0) + 1).padStart(3, '0') + '/' + year;
}

/** Legacy `pnLoad`: load at departure (all deliveries) and the peak along the route; `miss` = goods without weight. */
export function travelLoad(stops: readonly TravelStop[], weightOf: (g: TravelGood) => number): { start: number; peak: number; miss: number } {
  let cur = 0, miss = 0;
  for (const s of stops) if (s.kind !== 'pick') for (const g of s.goods) { const w = weightOf(g); if (!w && g.qty !== '') miss++; cur += w; }
  const start = cur;
  let peak = cur;
  for (const s of stops) for (const g of s.goods) {
    const w = weightOf(g);
    if (s.kind === 'pick') { if (!w && g.qty !== '') miss++; cur += w; } else cur -= w;
    peak = Math.max(peak, cur);
  }
  return { start: r2(start), peak: r2(peak), miss };
}

/** Legacy `pnDur`: hours between the departure and the return events. */
export function travelDuration(events: readonly TravelEvent[]): number | null {
  const d = events.find((e) => e.k === 'dep');
  const r = [...events].reverse().find((e) => e.k === 'ret');
  if (!d || !r) return null;
  return Math.max(0, (Date.parse(r.at) - Date.parse(d.at)) / 36e5);
}

/** Legacy `pnDnev`: domestic per diem — 100% from 12 h, 50% from 8 h. */
export function travelPerDiem(order: { dnev?: boolean; events: readonly TravelEvent[] }, cfg: Pick<TransportConfig, 'dnevAmt'>): { hrs: number | null; pct: number; amt: number } | null {
  if (!order.dnev) return null;
  const hrs = travelDuration(order.events);
  if (hrs == null) return { hrs: null, pct: 0, amt: 0 };
  const pct = hrs >= 12 ? 100 : hrs >= 8 ? 50 : 0;
  return { hrs, pct, amt: r2((num(cfg.dnevAmt) * pct) / 100) };
}

/** Legacy `pnFuelRows`: km, litres and fuel cost per vehicle and month from finished orders. */
export function fuelByVehicle(orders: readonly { status: string; date: string; vehicleId?: string | null; plate?: string | null; depKm?: number | string | null; retKm?: number | string | null; fuelL?: number | string | null; fuelAmt?: number | string | null }[]) {
  type Acc = { km: number; l: number; amt: number; n: number };
  const R = new Map<string, Acc & { vehicleId: string | null; plate: string; mo: Record<string, Acc> }>();
  for (const x of orders) {
    if (x.status !== 'done') continue;
    const km = num(x.retKm) && num(x.depKm) ? num(x.retKm) - num(x.depKm) : 0;
    const k = x.vehicleId || x.plate || '—';
    const r = R.get(k) ?? { vehicleId: x.vehicleId ?? null, plate: x.plate ?? '', km: 0, l: 0, amt: 0, n: 0, mo: {} };
    R.set(k, r);
    const mm = (r.mo[x.date.slice(0, 7)] ??= { km: 0, l: 0, amt: 0, n: 0 });
    for (const o of [r, mm]) { o.km += Math.max(0, km); o.l += num(x.fuelL); o.amt += num(x.fuelAmt); o.n++; }
  }
  return [...R.values()].map((r) => ({ ...r, l: r2(r.l), amt: r2(r.amt), avg: r.km > 0 && r.l ? r2((r.l / r.km) * 100) : 0, ckm: r.km > 0 && r.amt ? r2(r.amt / r.km) : 0 }));
}

/* ================================================================== freight (тури за трети лица) */

/**
 * Highest per-diem amounts abroad (legacy `FR_CTRY` 14441, Уредба … е-Прописи 8/2025): [code, name, amount, currency].
 * FIX (LEGACY-MAP 10.4 item 16): kept as reference data here; a firm overrides amounts in `settings.industry.frt.rates`.
 */
export const FR_COUNTRIES: readonly (readonly [string, string, number, string])[] = [
  ['AL', 'Албанија', 74, 'EUR'], ['AT', 'Австрија', 94, 'EUR'], ['BE', 'Белгија', 92, 'EUR'], ['BA', 'Босна и Херцеговина', 75, 'EUR'], ['BG', 'Бугарија', 75, 'EUR'],
  ['HR', 'Хрватска', 81, 'EUR'], ['CZ', 'Чешка', 32, 'EUR'], ['CZP', 'Чешка – Прага', 82, 'EUR'], ['DK', 'Данска', 97, 'EUR'], ['EE', 'Естонија', 52, 'EUR'],
  ['FI', 'Финска', 92, 'EUR'], ['FR', 'Франција', 85, 'EUR'], ['FRP', 'Франција – Париз, Стразбур', 95, 'EUR'], ['DE', 'Германија', 87, 'EUR'], ['GR', 'Грција', 61, 'EUR'],
  ['GRA', 'Грција – Атина', 81, 'EUR'], ['IE', 'Ирска', 86, 'EUR'], ['IT', 'Италија', 76, 'EUR'], ['ITR', 'Италија – Рим', 93, 'EUR'], ['XK', 'Косово', 45, 'EUR'],
  ['LV', 'Латвија', 41, 'EUR'], ['LT', 'Литванија', 45, 'EUR'], ['LU', 'Луксембург', 81, 'EUR'], ['HU', 'Унгарија', 79, 'EUR'], ['MD', 'Молдавија', 106, 'EUR'],
  ['NL', 'Холандија', 90, 'EUR'], ['NO', 'Норвешка', 103, 'EUR'], ['PL', 'Полска', 53, 'EUR'], ['PLW', 'Полска – Варшава', 80, 'EUR'], ['PT', 'Португалија', 88, 'EUR'],
  ['RO', 'Романија', 27, 'EUR'], ['ROB', 'Романија – Букурешт', 76, 'EUR'], ['SK', 'Словачка', 83, 'EUR'], ['SI', 'Словенија', 82, 'EUR'], ['RS', 'Србија', 48, 'EUR'],
  ['RSB', 'Србија – Белград', 82, 'EUR'], ['ES', 'Шпанија', 64, 'EUR'], ['ESM', 'Шпанија – Мадрид, Барселона', 87, 'EUR'], ['SE', 'Шведска', 90, 'EUR'],
  ['CH', 'Швајцарија', 130, 'CHF'], ['TR', 'Турција', 42, 'EUR'], ['TRI', 'Турција – поголеми градови', 82, 'EUR'], ['UA', 'Украина', 79, 'EUR'],
  ['GB', 'Велика Британија', 75, 'GBP'], ['GBL', 'Велика Британија – Лондон', 81, 'GBP'], ['ME', 'Црна Гора', 78, 'EUR'],
];
export const FR_STATUS = { plan: ['Планирана', ''], road: ['На пат', 'warn'], done: ['Завршена', 'good'], inv: ['Фактурирана', 'good'], cancel: ['Откажана', 'bad'] } as const;
export const FR_REDUCTIONS: readonly (readonly [number, string])[] = [[100, 'цела дневница'], [50, '50% – платено сместување со појадок'], [20, '20% – платено сместување со полн/полупансион']];
export const FR_DOC_VEHICLE = ['Лиценца за превоз (заедничка / национална)', 'CEMT дозвола', 'Калибрација на тахограф', 'CMR осигурување', 'ADR сертификат за возило', 'Регистрација на приколка', 'Технички на приколка', 'Друго'] as const;
export const FR_DOC_DRIVER = ['Возачка дозвола', 'Сертификат за стручна оспособеност (код 95 / CPC)', 'Тахограф картичка', 'Лекарско уверение', 'ADR сертификат за возач', 'Пасош', 'Виза / работна дозвола', 'Друго'] as const;
export const frCountryName = (c: string) => FR_COUNTRIES.find((x) => x[0] === c)?.[1] ?? c;

/** Per-diem amount of a country (firm override, else the table). */
export function frRate(code: string, overrides?: Readonly<Record<string, readonly [number, string] | [number, string]>> | null): [number, string] {
  const o = overrides?.[code];
  if (o && num(o[0])) return [num(o[0]), o[1] || 'EUR'];
  const d = FR_COUNTRIES.find((x) => x[0] === code);
  return d ? [d[2], d[3]] : [0, 'EUR'];
}

/** Legacy `frUnitsH`: per diems for a duration — each 24 h = 1, remainder over 12 h = 1, 8–12 h = ½. */
export const frUnitsH = (hrs: number): number => {
  if (!(hrs > 0)) return 0;
  const d = Math.floor(hrs / 24), r = hrs - d * 24;
  return d + (r > 12 ? 1 : r >= 8 ? 0.5 : 0);
};

export interface FreightSegment { c: string; in: string; out: string; units?: number | string | null }

const hoursOf = (g: FreightSegment) => (Date.parse(g.out) - Date.parse(g.in)) / 36e5;

/** Legacy `frSegAuto`: the tour's per diems split over the countries by time spent (rounded to ½, totals kept). */
export function frSegAuto(segs: readonly FreightSegment[]): Map<FreightSegment, number> {
  const G = segs.filter((g) => g.c && g.in && g.out && Date.parse(g.out) > Date.parse(g.in));
  const M = new Map<FreightSegment, number>();
  if (!G.length) return M;
  const t0 = Math.min(...G.map((g) => Date.parse(g.in))), t1 = Math.max(...G.map((g) => Date.parse(g.out)));
  const T = frUnitsH((t1 - t0) / 36e5);
  const H = G.map(hoursOf);
  const sh = H.reduce((a, b) => a + b, 0) || 1;
  const U = H.map((x) => Math.round((x / sh) * T * 2) / 2);
  let diff = r2(T - U.reduce((a, b) => a + b, 0));
  let guard = 100;
  while (Math.abs(diff) >= 0.5 && guard--) {
    const i = H.indexOf(Math.max(...H.filter((_, j) => diff > 0 || U[j]! >= 0.5)));
    U[i] = r2(U[i]! + (diff > 0 ? 0.5 : -0.5));
    diff = r2(diff + (diff > 0 ? -0.5 : 0.5));
  }
  G.forEach((g, i) => M.set(g, U[i]!));
  return M;
}

/**
 * Legacy `frDnev`: per diems per segment (manual units override the automatic split), reduction %, totals per currency
 * and in MKD (`fx(cur, date)` = MKD per unit; 0 = missing rate → listed in `miss`).
 */
export function frPerDiems(t: { red?: number | string | null; segs: readonly FreightSegment[]; date?: string }, fx: (cur: string, date: string) => number, overrides?: Readonly<Record<string, [number, string]>> | null) {
  const red = (num(t.red) || 100) / 100;
  const auto = frSegAuto(t.segs);
  const by: Record<string, number> = {};
  const miss = new Set<string>();
  let mkd = 0;
  const rows = t.segs.filter((g) => g.c).map((g) => {
    const [amt, cur] = frRate(g.c, overrides);
    const u = g.units !== '' && g.units != null && !Number.isNaN(Number(g.units)) ? num(g.units) : auto.get(g) ?? 0;
    const v = r2(u * amt * red);
    const rate = fx(cur, (g.out || g.in || t.date || '').slice(0, 10)) || 0;
    if (!rate && v) miss.add(cur);
    const m = r2(v * rate);
    by[cur] = r2((by[cur] ?? 0) + v);
    mkd += m;
    return { ...g, amt, cur, u, auto: auto.get(g), v, fx: rate, m, hrs: g.in && g.out ? hoursOf(g) : null };
  });
  const G = t.segs.filter((g) => g.in && g.out);
  const tot = G.length ? (Math.max(...G.map((g) => Date.parse(g.out))) - Math.min(...G.map((g) => Date.parse(g.in)))) / 36e5 : 0;
  return { rows, by, mkd: r2(mkd), miss: [...miss], totH: r2(tot), totU: frUnitsH(tot) };
}

/**
 * Fuel-card rows of the tour's vehicle within the tour dates (legacy `frTourFuel`).
 * FIX (LEGACY-MAP 10.4 item 14): legacy ended the window at `t.retDate`, which no editor ever set, so return-leg fuel
 * was dropped; the window now ends at the return date, else the last segment's exit, else the unloading date.
 */
export function frTourWindow(t: { date: string; unloadDate?: string | null; retDate?: string | null; segs?: readonly FreightSegment[] }): [string, string] {
  const outs = (t.segs ?? []).map((g) => String(g.out || '').slice(0, 10)).filter(Boolean).sort();
  const end = t.retDate || outs[outs.length - 1] || t.unloadDate || t.date;
  return [t.date.slice(0, 10), String(end).slice(0, 10) < t.date.slice(0, 10) ? t.date.slice(0, 10) : String(end).slice(0, 10)];
}
export const plateKey = (s: string | null | undefined) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9А-Ш]/g, '');
