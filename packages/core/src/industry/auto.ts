/**
 * Auto service and parts (legacy 9633–9746: `AU`, `plN`, `pnN`, `WO_ST`, `woSt`, `woCalc`, `vehLbl`, `woNew`,
 * `woFindItem`, `partNums`, `MK_AL`, `fNorm`, `mkAl`, `fitsVeh`, `VIEWS.delovi` search, `potRows`).
 * Pure logic; persistence is `@wise/db` `industry/auto.ts`.
 */
import { addDays, dayDiff, num, r2 } from './common';

/** Legacy `AU()`: labour-hour price without VAT, standard service interval (km, months). */
export interface AutoConfig { hr: number; km: number; mon: number }
export const AUTO_DEFAULTS: AutoConfig = { hr: 1000, km: 15000, mon: 12 };
export const autoConfig = (o: Partial<AutoConfig> | null | undefined): AutoConfig => ({ ...AUTO_DEFAULTS, ...(o ?? {}) });

/** Legacy `plN`: registration plate key (Latin + Cyrillic letters, digits). */
export const plateNorm = (s: string | null | undefined): string => String(s ?? '').toUpperCase().replace(/[^0-9A-ZА-ЯЃЌЅЉЊЏЈ]/g, '');
/** Legacy `pnN`: part-number key (Latin letters and digits only — spaces, dashes and dots ignored). */
export const partNorm = (s: string | null | undefined): string => String(s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');

export type WorkOrderStatus = 'open' | 'work' | 'done';
/** Legacy `WO_ST` (+ `inv` when an invoice exists). */
export const WO_STATUS = { open: ['примен', 'info'], work: ['во работа', 'warn'], done: ['завршен', 'good'], inv: ['фактуриран', 'good'] } as const;
export type WoState = keyof typeof WO_STATUS;
/** Legacy `woSt`: invoiced orders are `inv`, otherwise the stored status. */
export const woState = (w: { status?: string | null; invoiceId?: string | null }): WoState =>
  w.invoiceId ? 'inv' : (['open', 'work', 'done'].includes(String(w.status)) ? (w.status as WorkOrderStatus) : 'open');

export interface WoPart { itemId?: string | null; name: string; qty: number | string; price: number | string; disc?: number | string | null; rate: number | string }
export interface WoLabour { itemId?: string | null; name: string; hrs: number | string; price: number | string; rate: number | string }

/** Legacy `woCalc`: parts (with discount) and labour, base and VAT rounded per line. */
export function woCalc(w: { parts?: readonly WoPart[] | null; labour?: readonly WoLabour[] | null }) {
  let pb = 0, pv = 0, lb = 0, lv = 0;
  for (const p of w.parts ?? []) {
    const b = r2(num(p.qty) * num(p.price) * (1 - num(p.disc) / 100));
    pb += b; pv += r2((b * num(p.rate)) / 100);
  }
  for (const l of w.labour ?? []) {
    const b = r2(num(l.hrs) * num(l.price));
    lb += b; lv += r2((b * num(l.rate)) / 100);
  }
  return { pb: r2(pb), lb: r2(lb), base: r2(pb + lb), vat: r2(pv + lv), tot: r2(pb + pv + lb + lv) };
}
export const partLineBase = (p: WoPart): number => r2(num(p.qty) * num(p.price) * (1 - num(p.disc) / 100));

/** Legacy `vehLbl`: `SK-1234-AB · VW Golf · 2008`. */
export const vehicleLabel = (v: { plate?: string | null; make?: string | null; model?: string | null; year?: number | string | null } | null | undefined): string =>
  v ? [v.plate, [v.make, v.model].filter(Boolean).join(' '), v.year].filter(Boolean).join(' · ') : '';

/** Legacy `woNew` next-service default: the km at the service plus the standard interval. */
export const nextServiceKm = (km: number | string | null | undefined, cfg: AutoConfig): number | null => (num(km) > 0 ? num(km) + num(cfg.km) : null);

export const VEHICLE_MAKES = ['Volkswagen', 'Škoda', 'Audi', 'Opel', 'Ford', 'Renault', 'Peugeot', 'Citroën', 'Fiat', 'BMW', 'Mercedes-Benz', 'Toyota', 'Hyundai', 'Kia', 'Dacia', 'Seat', 'Nissan', 'Mazda', 'Honda', 'Volvo', 'Iveco'] as const;
export const VEHICLE_FUELS = ['', 'дизел', 'бензин', 'бензин/ТНГ', 'хибрид', 'електрично'] as const;
export const LABOUR_PRESETS = ['Замена масло и филтри', 'Дијагностика', 'Замена плочки и дискови', 'Замена ремен', 'Сервис на клима', 'Монтажа гуми и баланс'] as const;

/**
 * Legacy `cvSave` checks: plate or VIN required, duplicate plate / VIN. Returns the error text or null;
 * `vinWarning` is the legacy confirm (VIN usually has 17 characters).
 */
export function vehicleProblems(v: { id?: string | null; plate?: string | null; vin?: string | null }, others: readonly { id: string; plate?: string | null; vin?: string | null; make?: string | null; model?: string | null; year?: number | string | null }[]): string | null {
  const plate = String(v.plate ?? '').trim(), vin = String(v.vin ?? '').trim().toUpperCase();
  if (!plate && !vin) return 'Внесете таблица или VIN.';
  const dup = others.find((o) => o.id !== v.id && ((plate && plateNorm(o.plate) === plateNorm(plate)) || (vin && String(o.vin ?? '').toUpperCase() === vin)));
  return dup ? `Возилото веќе постои: ${vehicleLabel(dup)}` : null;
}
export const vinWarning = (vin: string | null | undefined): string | null => {
  const v = String(vin ?? '').trim();
  return v && v.length !== 17 ? `VIN обично има 17 знаци (внесени ${v.length}).` : null;
};

/* ---------------- parts search ---------------- */

export interface PartItem { id: string; code?: string | null; name: string; barcodes?: readonly string[] | null; oe?: string | null; crossRefs?: string | null; fits?: string | null }

/** Legacy `partNums`: code, barcodes, OE numbers and cross references, normalised, at least 3 characters. */
export const partNums = (i: PartItem): string[] =>
  [i.code, ...(i.barcodes ?? []), ...String(i.oe ?? '').split(/[,;\n]/), ...String(i.crossRefs ?? '').split(/[,;\n]/)].map(partNorm).filter((x) => x.length >= 3);

/** Legacy `MK_AL`: make aliases. */
export const MAKE_ALIASES: readonly (readonly string[])[] = [['volkswagen', 'vw'], ['mercedes-benz', 'mercedes', 'mb'], ['škoda', 'skoda'], ['citroën', 'citroen'], ['alfa romeo', 'alfa'], ['land rover', 'landrover'], ['chevrolet', 'chevy']];
/** Legacy `fNorm`: lower case without diacritics, single spaces. */
export const foldText = (s: string | null | undefined): string => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
export function makeAliases(mk: string): string[] {
  const n = foldText(mk);
  return MAKE_ALIASES.map((x) => x.map(foldText)).find((x) => x.includes(n)) ?? [n];
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Legacy `fitsVeh`: does the item's "Возила" text (entries separated by `;` or new lines, e.g.
 * „VW Golf 5 2004-2008; Škoda Octavia 2 2004-2013“) match make (with aliases, whole word), model and year (in range)?
 */
export function fitsVehicle(fits: string | null | undefined, mk?: string | null, md?: string | null, yr?: number | string | null): boolean {
  const F = String(fits ?? '');
  if (!F) return false;
  const ma = mk ? makeAliases(mk) : null;
  const mdn = foldText(md);
  return F.split(/[;\n]/).some((e) => {
    const s = foldText(e);
    if (ma && !ma.some((a) => new RegExp('(^|[^a-z])' + esc(a) + '([^a-z]|$)').test(s))) return false;
    if (mdn && !s.includes(mdn)) return false;
    if (yr) {
      const r = s.match(/(19|20)\d\d\s*[-–]\s*((19|20)\d\d)?/);
      if (r) {
        const a = Number(r[0].slice(0, 4)), b = r[2] ? Number(r[2]) : 9999;
        if (Number(yr) < a || Number(yr) > b) return false;
      }
    }
    return true;
  });
}

const textMatch = (hay: string, q: string) => {
  const H = foldText(hay);
  return foldText(q).split(' ').filter(Boolean).every((w) => H.includes(w));
};

/**
 * Legacy `VIEWS.delovi` search: by part number (OE, cross reference, code, barcode — ≥ 3 characters, ignoring spaces and
 * dashes) or by name / vehicle text; then narrowed to the vehicle (make, model, year) when one is given.
 */
export function searchParts<T extends PartItem>(goods: readonly T[], f: { q?: string | null; mk?: string | null; md?: string | null; yr?: number | string | null }): T[] {
  let L: T[] = [];
  const q = String(f.q ?? '').trim();
  const qn = partNorm(q);
  if (q) L = goods.filter((i) => (qn.length >= 3 && partNums(i).some((n) => n.includes(qn))) || textMatch(i.name + ' ' + (i.fits ?? ''), q));
  if (f.mk || f.md) L = (q ? L : [...goods]).filter((i) => fitsVehicle(i.fits, f.mk, f.md, f.yr));
  return L;
}
/** Legacy „Замени“: other items sharing a normalised part number with `sel`. */
export function partAlternatives<T extends PartItem>(goods: readonly T[], sel: PartItem): T[] {
  const mine = partNums(sel);
  return goods.filter((i) => i.id !== sel.id && partNums(i).some((n) => mine.includes(n)));
}

/**
 * Legacy `woFindItem`: the text of the parts field — "code · name" label, exact code, part number (≥ 4 characters,
 * the one with most stock), or exact name.
 */
export function findPartItem<T extends PartItem & { stock?: number }>(items: readonly T[], q: string, byCode?: (code: string) => T | undefined): T | null {
  const s = String(q ?? '').trim();
  if (!s) return null;
  const byL = items.find((i) => (i.code ? i.code + ' · ' : '') + i.name === s);
  if (byL) return byL;
  const ic = byCode?.(s) ?? items.find((i) => i.code && i.code === s) ?? items.find((i) => (i.barcodes ?? []).includes(s));
  if (ic) return ic;
  const n = partNorm(s);
  if (n.length >= 4) {
    const L = items.filter((i) => partNums(i).includes(n));
    if (L.length) return [...L].sort((a, b) => (b.stock ?? 0) - (a.stock ?? 0))[0]!;
  }
  return items.find((i) => i.name.toLowerCase() === s.toLowerCase()) ?? null;
}

/* ---------------- service reminders ---------------- */

export interface ReminderVehicle { id: string; plate?: string | null; make?: string | null; model?: string | null; remindAt?: string | null }
export interface ReminderOrder { vehicleId: string | null; date: string; km?: number | string | null; status?: string | null; invoiceId?: string | null; nextKm?: number | string | null; nextDate?: string | null; nextNote?: string | null }

/**
 * Legacy `potRows`: for each vehicle, the last non-`open` service; due 30 days before the next-service date (from the
 * order, else last + `mon` months) or when the estimated km (pace between the first and last service with km, over
 * more than 30 days) is within 1 000 km of the next-service km (from the order, else last km + `km`). Vehicles marked
 * contacted in the last 30 days are hidden. Overdue first.
 */
export function serviceReminders<V extends ReminderVehicle, O extends ReminderOrder>(vehicles: readonly V[], orders: readonly O[], cfg: AutoConfig, today: string) {
  const R: { v: V; last: O; nKm: number; nDate: string; estKm: number | null; why: string; late: boolean }[] = [];
  for (const v of vehicles) {
    const W = orders.filter((w) => w.vehicleId === v.id && woState(w) !== 'open').sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const last = W[W.length - 1];
    if (!last) continue;
    const kmPts = W.filter((w) => num(w.km)).map((w) => ({ d: w.date, k: num(w.km) }));
    let perDay = 0;
    if (kmPts.length >= 2) {
      const a = kmPts[0]!, b = kmPts[kmPts.length - 1]!;
      const dd = dayDiff(a.d, b.d);
      if (dd > 30) perDay = (b.k - a.k) / dd;
    }
    const estKm = num(last.km) ? Math.round(num(last.km) + perDay * dayDiff(last.date, today)) : null;
    const nKm = num(last.nextKm) || (num(last.km) ? num(last.km) + num(cfg.km) : 0);
    const nDate = last.nextDate || (num(cfg.mon) ? addDays(last.date, Math.round(num(cfg.mon) * 30.4)) : '');
    const byD = !!nDate && nDate <= addDays(today, 30);
    const byK = !!nKm && estKm != null && estKm >= nKm - 1000;
    if (!byD && !byK) continue;
    if (v.remindAt && v.remindAt >= addDays(today, -30)) continue;
    const fq = (x: number) => x.toLocaleString('de-DE');
    R.push({
      v, last, nKm, nDate, estKm,
      why: [byD ? 'рок ' + nDate.split('-').reverse().join('.') : '', byK ? `≈${fq(estKm!)} км (сервис на ${fq(nKm)})` : ''].filter(Boolean).join(' · '),
      late: (!!nDate && nDate < today) || (!!nKm && estKm != null && estKm >= nKm),
    });
  }
  return R.sort((a, b) => (b.late ? 1 : 0) - (a.late ? 1 : 0));
}

/** Legacy WhatsApp text of a reminder. */
export const reminderText = (v: ReminderVehicle, note: string | null | undefined, firm: { name?: string | null; phone?: string | null }): string =>
  `Почитувани, за возилото ${v.plate ?? ''} (${[v.make, v.model].filter(Boolean).join(' ')}) наскоро е потребен ${note || 'редовен сервис'}. Закажете термин: ${firm.phone ?? ''} – ${firm.name ?? ''}`;
/** Legacy phone → wa.me number (`0…` → `389…`). */
export const waNumber = (phone: string | null | undefined): string => String(phone ?? '').replace(/\D/g, '').replace(/^0/, '389');

/* ---------------- invoice ---------------- */

/**
 * Legacy `woInv`: parts as goods lines (item revenue konto, discount kept) and labour as `Работа: …` lines in hours
 * on the service revenue konto (`serviceAccount`, the posting scheme's `revService`).
 */
export function workOrderInvoiceLines(w: { parts?: readonly WoPart[] | null; labour?: readonly WoLabour[] | null }, units: (itemId: string) => string | null | undefined, serviceAccount: string | null) {
  return [
    ...(w.parts ?? []).map((p) => ({ itemId: p.itemId || null, name: p.name, unit: (p.itemId && units(p.itemId)) || 'ком', qty: num(p.qty), price: num(p.price), disc: num(p.disc), rate: num(p.rate), account: p.itemId ? null : serviceAccount })),
    ...(w.labour ?? []).map((l) => ({ itemId: l.itemId || null, name: 'Работа: ' + l.name, unit: 'час', qty: num(l.hrs), price: num(l.price), disc: 0, rate: num(l.rate), account: serviceAccount })),
  ].filter((l) => l.qty);
}
