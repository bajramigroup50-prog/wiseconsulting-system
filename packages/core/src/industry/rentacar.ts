/**
 * Rent-a-car (legacy 9749–9858 and the v4xx patches 11648–11810): rental days with a grace period, seasonal markup,
 * weekly price, extra km and missing fuel, agreed day price (`pDay`), invoice lines.
 *
 * Config (legacy `firm.rent`, FIX 10.4 item 7: `settings.industry.rent`).
 */
import { addDays, net4, netOfGross, num, r2, type ModuleInvoiceLine } from './common';

export interface RentConfig {
  rate: number;
  /** Revenue konto ('' = posting scheme `revService`). */
  revK: string;
  /** Deposits konto (liability, class 2). */
  depK: string;
  /** Price of 1/8 of a tank. */
  fuel8: number;
  /** Grace hours before another day is charged. */
  grace: number;
  minAge: number;
  minLic: number;
  /** Seasonal markup % and season MM-DD range (may wrap the new year). */
  sPct: number; sFrom: string; sTo: string;
  terms: string;
}

/**
 * Legacy `RC()`. FIX (LEGACY-MAP 10.4 item 4): revK '' = posting scheme; FIX item 16: the contract terms are reference
 * text here (editable per firm), not a literal inside the editor.
 */
export const RENT_TERMS_DEFAULT = '1. Возилото се користи само од возачите наведени во договорот.\n2. Забрането е користење под дејство на алкохол или опојни средства.\n3. Возилото се враќа со иста количина гориво; разликата се наплаќа.\n4. Казните за сообраќајни прекршоци во периодот на изнајмување се на товар на корисникот.\n5. Штета што не ја покрива осигурувањето се наплаќа од кауцијата.\n6. Излез од државата само со претходна писмена согласност и зелен картон.';
export const RENT_DEFAULTS: RentConfig = { rate: 18, revK: '', depK: '2222', fuel8: 600, grace: 2, minAge: 21, minLic: 2, sPct: 0, sFrom: '06-15', sTo: '09-15', terms: RENT_TERMS_DEFAULT };
export const rentConfig = (o: Partial<RentConfig> | null | undefined): RentConfig => ({ ...RENT_DEFAULTS, ...(o ?? {}) });

export const RENT_STATUS = {
  resv: ['резервација', 'info', '#cfe0ff'], out: ['кај клиент', 'warn', '#ffd9a8'], ret: ['вратено', 'good', '#d9f2e3'],
  closed: ['фактурирано', 'good', '#e8e8e8'], cancel: ['откажано', '', '#eee'],
} as const;

export interface RentVehicle { rDay?: number | string | null; rWeek?: number | string | null; rKm?: number | string | null; rKmX?: number | string | null }
export interface Handover { km?: number | string | null; fuel?: number | string | null; dmg?: string; at?: string | null }
export interface Rental {
  from: string; to: string; pDay?: number | string | null; deposit?: number | string | null; priceTot?: number | string | null;
  out?: Handover | null; ret?: Handover | null; extras?: readonly { name: string; qty: number; price: number }[];
}

/** `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` (local) → minutes since epoch on a UTC clock (only differences matter). */
const minutes = (s: string) => {
  const v = String(s);
  return Date.parse((v.length <= 10 ? v + 'T09:00' : v.slice(0, 16)) + ':00Z') / 6e4;
};

/** Legacy `rcDays`: started 24-hour periods after the grace hours, minimum one day. */
export function rcDays(from: string, to: string, c: Pick<RentConfig, 'grace'>): number {
  const hrs = (minutes(to) - minutes(from)) / 60;
  if (!(hrs > 0)) return 0;
  return Math.max(1, Math.ceil((hrs - num(c.grace)) / 24));
}

/** Legacy `rcInSeason`: MM-DD within the season (range may wrap the year end). */
export function rcInSeason(d: string, c: Pick<RentConfig, 'sPct' | 'sFrom' | 'sTo'>): boolean {
  if (!num(c.sPct)) return false;
  const md = d.slice(5, 10);
  return c.sFrom <= c.sTo ? md >= c.sFrom && md <= c.sTo : md >= c.sFrom || md <= c.sTo;
}

/** Legacy `rcRent`: day (or weekly-rate day for 7+ days) price per day, seasonal markup per day. Gross. */
export function rcRent(v: RentVehicle, from: string, days: number, c: RentConfig): number {
  const base = days >= 7 && num(v.rWeek) ? num(v.rWeek) : num(v.rDay);
  let t = 0;
  for (let i = 0; i < days; i++) t += rcInSeason(addDays(from.slice(0, 10), i), c) ? base * (1 + num(c.sPct) / 100) : base;
  return r2(t);
}

/** Legacy `rcCalc` (9758 → 11661): days, rent (agreed `pDay` wins), extra km, missing fuel, extras, total, deposit. */
export function rcCalc(r: Rental, v: RentVehicle, c: RentConfig) {
  const end = r.ret?.at || r.to;
  const days = rcDays(r.from, end, c);
  let rent = r.priceTot != null && r.priceTot !== '' && !r.ret?.at ? num(r.priceTot) : rcRent(v, r.from, days, c);
  const pDay = num(r.pDay);
  if (pDay > 0) rent = r2(pDay * days);
  const km = r.ret && num(r.ret.km) && r.out && num(r.out.km) ? num(r.ret.km) - num(r.out.km) : 0;
  const allow = num(v.rKm) ? num(v.rKm) * days : 0;
  const xKm = allow && km > allow ? km - allow : 0;
  const has = (x: unknown) => x !== '' && x != null;
  const fuelD = r.ret && r.out && has(r.ret.fuel) && has(r.out.fuel) ? Math.max(0, num(r.out.fuel) - num(r.ret.fuel)) : 0;
  const auto: { name: string; qty: number; price: number; auto: true }[] = [];
  if (xKm && num(v.rKmX)) auto.push({ name: `Дополнителни км (${xKm} км над ${allow})`, qty: xKm, price: num(v.rKmX), auto: true });
  if (fuelD && num(c.fuel8)) auto.push({ name: `Гориво – недостасува ${fuelD}/8 резервоар`, qty: fuelD, price: num(c.fuel8), auto: true });
  const ex = [...auto, ...(r.extras ?? []).map((x) => ({ ...x, auto: false as const }))];
  const exT = r2(ex.reduce((s, x) => s + num(x.qty) * num(x.price), 0));
  return { days, rent, km, allow, xKm, fuelD, ex, exT, tot: r2(rent + exT), dep: num(r.deposit), pDayAgreed: pDay > 0 ? pDay : null };
}

/** Two rentals of the same vehicle overlap (legacy `rcClash`, returned rentals end at the return time). */
export const rentalsOverlap = (a: Rental, b: Rental) => a.from < (b.ret?.at || b.to) && (a.ret?.at || a.to) > b.from;

/**
 * Invoice lines (legacy `rcInv` 9820).
 * FIX (LEGACY-MAP 10.4 item 6): legacy priced the rent as `net4(rent / days) × days`, so the gross total drifted by a
 * cent per day of rounding; the rent is now one line (qty 1, the whole period) whose net price is chosen with `netOfGross` so its VAT-inclusive
 * total equals the agreed gross rent (to the cent when such a base exists, otherwise within 1 cent).
 */
export function rentalInvoiceLines(r: Rental & { plate: string }, k: ReturnType<typeof rcCalc>, c: RentConfig): ModuleInvoiceLine[] {
  const span = `${r.from.replace('T', ' ')} – ${(r.ret?.at || r.to).replace('T', ' ')}`;
  return [
    { name: `Изнајмување возило ${r.plate} (${span}), ${k.days} ден.`, unit: 'наем', qty: 1, price: netOfGross(k.rent, c.rate), rate: num(c.rate), account: c.revK || null },
    ...k.ex.map((x) => ({ name: x.name, unit: 'ком', qty: num(x.qty), price: net4(x.price, c.rate), rate: num(c.rate), account: c.revK || null })),
  ];
}

/** Driver checks before the handover (legacy `rcOut` + 11717 patch). Returns the problems (empty = ok). */
export function handoverProblems(drv: { name?: string; doc?: string; lic?: string; birth?: string; phone?: string; docExp?: string }, out: Handover, today: string): string[] {
  const P: string[] = [];
  if (!drv.name || !drv.doc || !drv.lic || !drv.birth) P.push('Внесете ги податоците на возачот: датум на раѓање, документ и возачка дозвола.');
  if (!String(drv.phone ?? '').replace(/\D/g, '')) P.push('Внесете телефон за контакт на корисникот.');
  if (drv.docExp && drv.docExp < today) P.push('Документот на корисникот е истечен.');
  if (out.km === '' || out.km == null || out.fuel === '' || out.fuel == null) P.push('Внесете км и гориво при предавањето.');
  return P;
}
