/**
 * Auto service — legacy-parity helpers (legacy `srchMatch` 7836, `digNorm` / `digMap` / `digN` 10284–10287, the
 * `DIG.cveh` Excel import 10276 / 10312 and the `DIG.vreg` registration-certificate read 10275 / 10308, the
 * `⬇ Извоз` export of every table, `woInv` → `bzInvDraft` 9690).
 * Pure logic; persistence is `@wise/db` `industry/auto.ts`.
 */
import { toCyr } from '../retail/items';
import { num } from './common';
import { plateNorm, vehicleLabel, woCalc, WO_STATUS, woState, type WoLabour, type WoPart } from './auto';

/** Legacy `srchMatch`: the whole query as a substring (case-insensitive), or its Latin → Cyrillic transcription. */
export function autoSearchMatch(text: string | null | undefined, q: string | null | undefined): boolean {
  const T = String(text ?? '').toLowerCase();
  const s = String(q ?? '').toLowerCase().trim();
  return !s || T.includes(s) || T.includes(toCyr(s));
}

/** Legacy `VIEWS.servis` search: number, plate, owner, vehicle label, complaint. */
export function workOrderMatches(w: { number?: string | null; plate?: string | null; complaint?: string | null }, owner: string | null | undefined, vehicle: string | null | undefined, q: string): boolean {
  return autoSearchMatch([w.number, w.plate, owner, vehicle, w.complaint].map((x) => x ?? '').join(' '), q);
}

/** Legacy `VIEWS.vozila` search: plate (normalised), VIN (part-number key), make / model / owner text. */
export function vehicleMatches(v: { plate?: string | null; vin?: string | null; make?: string | null; model?: string | null }, owner: string | null | undefined, q: string): boolean {
  const s = String(q ?? '').trim();
  if (!s) return true;
  const n = plateNorm(s);
  const pn = (x: string | null | undefined) => String(x ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  return plateNorm(v.plate).includes(n) || pn(v.vin).includes(pn(s)) || autoSearchMatch([v.make, v.model, owner].map((x) => x ?? '').join(' '), s);
}

/* ---------------- Excel import (legacy DIG) ---------------- */

/** Legacy `digNorm`: lower case, everything except letters / digits / `%+/` collapsed to one space. */
export const autoImportNorm = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-zа-шѓќѕљњџјçë0-9%+/]+/g, ' ').trim();

/** One importable column: key, template header, aliases (comma separated, legacy `DIG.*.f`). */
export type AutoImportField = readonly [key: string, header: string, aliases: string];

/**
 * Legacy `digMap`: column index per field — exact alias match first, then an alias (longer than 2 characters) that
 * the header starts with or contains; a column is used once.
 */
export function autoImportHeaderMap(hdr: readonly unknown[], F: readonly AutoImportField[]): Record<string, number> {
  const H = hdr.map(autoImportNorm);
  const M: Record<string, number> = {};
  for (const [k, , al] of F) {
    const A = al.split(',').map(autoImportNorm);
    let i = H.findIndex((x) => A.includes(x));
    if (i < 0) i = H.findIndex((x) => !!x && A.some((a) => a.length > 2 && (x.startsWith(a) || x.includes(a))));
    if (i >= 0 && !Object.values(M).includes(i)) M[k] = i;
  }
  return M;
}

/** Legacy `digN`: number from a cell (`1.234,5` / `1 234.5` / `1234,5`). */
export function autoImportNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '').replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  return Number(s) || 0;
}

/**
 * Legacy `digReadXlsx`: the header row is the one (among the first 15) with the most recognised columns; the rows
 * below it become objects keyed by field. Throws when no column is recognised (legacy `no_header`).
 */
export function autoImportRows(aoa: readonly (readonly unknown[])[], F: readonly AutoImportField[]): Record<string, string>[] {
  const A = aoa.filter((r) => r.some((x) => String(x ?? '').trim() !== ''));
  let hi = 0, best = -1, bm: Record<string, number> = {};
  for (let i = 0; i < Math.min(15, A.length); i++) {
    const m = autoImportHeaderMap(A[i]!, F);
    if (Object.keys(m).length > best) { best = Object.keys(m).length; hi = i; bm = m; }
  }
  if (best < 1) throw new Error('Не се препознаа колоните – користете го Excel образецот.');
  return A.slice(hi + 1).map((r) => {
    const o: Record<string, string> = {};
    for (const [k, i] of Object.entries(bm)) o[k] = String(r[i] ?? '').trim();
    return o;
  }).filter((o) => Object.values(o).some((v) => v !== ''));
}

/** Legacy `DIG.cveh`: „Возила на клиенти (Excel)“. */
export const VEHICLE_IMPORT_FIELDS: readonly AutoImportField[] = [
  ['plate', 'Таблица', 'таблица,регистрација,plate,targa'], ['vin', 'VIN', 'vin,шасија,shasia'], ['make', 'Марка', 'марка,make,marka'],
  ['model', 'Модел', 'модел,model'], ['year', 'Година', 'година,year,viti'], ['engine', 'Мотор', 'мотор,engine'],
  ['owner', 'Сопственик', 'сопственик,owner,клиент,pronari'], ['km', 'Км', 'км,km,километри'],
];
export const VEHICLE_IMPORT_TEMPLATE: string[][] = [VEHICLE_IMPORT_FIELDS.map((f) => f[1]), ['SK-1234-AB', 'WVWZZZ1KZ8W000001', 'Volkswagen', 'Golf 5', '2008', '1.9 TDI 77kW', 'Петар Петровски', '185000']];

export interface VehicleImportRow { plate: string; vin: string; make: string; model: string; year: number | null; engine: string; owner: string; km: number | null }

/**
 * Legacy `digApply` for `cveh`: rows without plate and VIN are ignored; plate and VIN in capitals; a plate / VIN
 * already present (in the firm or earlier in the file) is skipped and listed.
 */
export function vehicleImportPlan(aoa: readonly (readonly unknown[])[], existing: readonly { plate?: string | null; vin?: string | null }[]) {
  const R = autoImportRows(aoa, VEHICLE_IMPORT_FIELDS);
  const seen = [...existing.map((v) => ({ plate: v.plate ?? '', vin: String(v.vin ?? '').toUpperCase() }))];
  const add: VehicleImportRow[] = [];
  const skip: string[] = [];
  for (const r of R) {
    const plate = String(r.plate ?? '').toUpperCase().trim(), vin = String(r.vin ?? '').toUpperCase().trim();
    if (!plate && !vin) continue;
    if (seen.some((v) => (plate && plateNorm(v.plate) === plateNorm(plate)) || (vin && v.vin === vin))) { skip.push(plate || vin); continue; }
    seen.push({ plate, vin });
    const yr = Math.trunc(autoImportNum(r.year));
    add.push({
      plate, vin, make: String(r.make ?? '').trim(), model: String(r.model ?? '').trim(), year: yr > 1900 && yr < 2200 ? yr : null,
      engine: String(r.engine ?? '').trim(), owner: String(r.owner ?? '').trim(), km: Math.round(autoImportNum(r.km)) || null,
    });
  }
  return { add, skip };
}

/* ---------------- registration certificate (legacy DIG.vreg, AI read) ---------------- */

/** Legacy `DIG.vreg.ai` prompt (сообраќајна дозвола). */
export const VREG_PROMPT = 'This is a vehicle registration certificate (сообраќајна дозвола) from North Macedonia or another country. Codes: A = registration plate, E = VIN, D.1 = make, D.3 = model, B = first registration date, P.1 = engine capacity, P.3 = fuel, C.1 = owner. Reply with ONLY JSON: {"plate":string,"vin":string,"make":string,"model":string,"year":number,"engine":string,"fuel":string,"owner":string}';

export interface VregRead { plate: string; vin: string; make: string; model: string; year: number | null; engine: string; fuel: string; owner: string }

/** Legacy `digApply` for `vreg`: the read fields for the vehicle form (plate / VIN in capitals). */
export function vregToVehicle(r: unknown): VregRead {
  const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
  const s = (k: string) => String(o[k] ?? '').trim();
  const yr = Math.trunc(autoImportNum(o.year));
  return { plate: s('plate').toUpperCase(), vin: s('vin').toUpperCase(), make: s('make'), model: s('model'), year: yr > 1900 && yr < 2200 ? yr : null, engine: s('engine'), fuel: s('fuel'), owner: s('owner') };
}

/* ---------------- exports (legacy „⬇ Извоз“ of the tables) ---------------- */

type ExportCell = string | number | null;
const dmy = (d: string | null | undefined) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '');

/** Work orders list (columns of `VIEWS.servis` + the invoice number). */
export function workOrderExportRows<W extends { number: string; date: string; plate?: string | null; km?: number | null; complaint?: string | null; work?: string | null; status?: string | null; invoiceId?: string | null; invoiceStatus?: string | null; parts?: readonly WoPart[] | null; labour?: readonly WoLabour[] | null }>(
  L: readonly W[], vehicle: (w: W) => string, owner: (w: W) => string, invoiceNo: (w: W) => string,
): ExportCell[][] {
  return [
    ['Број', 'Датум', 'Возило', 'Сопственик', 'Км', 'Дефект', 'Извршена работа', 'Делови без ДДВ', 'Работа без ДДВ', 'ДДВ', 'Износ со ДДВ', 'Статус', 'Фактура'],
    ...L.map((w) => {
      const c = woCalc(w);
      return [w.number, dmy(w.date), vehicle(w) || w.plate || '', owner(w), w.km ?? null, w.complaint ?? '', w.work ?? '', c.pb, c.lb, c.vat, c.tot, WO_STATUS[woState(w)][0], invoiceNo(w)];
    }),
  ];
}

/** Customers' vehicles (columns of `VIEWS.vozila`). */
export function vehicleExportRows<V extends { id: string; plate?: string | null; make?: string | null; model?: string | null; year?: number | null; vin?: string | null; engine?: string | null; fuel?: string | null; km?: number | null; note?: string | null }>(
  L: readonly V[], owner: (v: V) => string, services: (v: V) => { n: number; last: string | null },
): ExportCell[][] {
  return [
    ['Таблица', 'Марка', 'Модел', 'Година', 'VIN', 'Мотор', 'Гориво', 'Сопственик', 'Км', 'Сервиси', 'Последен', 'Забелешка'],
    ...L.map((v) => { const s = services(v); return [v.plate ?? '', v.make ?? '', v.model ?? '', v.year ?? null, v.vin ?? '', v.engine ?? '', v.fuel ?? '', owner(v), v.km ?? null, s.n, dmy(s.last), v.note ?? '']; }),
  ];
}

/** Service history of one vehicle (the „Историја“ card). */
export function vehicleHistoryRows(W: readonly { number: string; date: string; km?: number | null; complaint?: string | null; work?: string | null; parts?: readonly WoPart[] | null; labour?: readonly WoLabour[] | null }[]): ExportCell[][] {
  return [
    ['Датум', 'Км', 'Број', 'Дефект', 'Работа', 'Делови', 'Работа (норма)', 'Износ со ДДВ'],
    ...W.map((w) => [dmy(w.date), w.km ?? null, w.number, w.complaint ?? '', w.work ?? '', (w.parts ?? []).map((p) => `${p.name} ×${num(p.qty)}`).join(' · '), (w.labour ?? []).map((l) => l.name).join(', '), woCalc(w).tot]),
  ];
}

/** Parts search results (columns of `VIEWS.delovi`; price with VAT). */
export function partsExportRows(L: readonly { code?: string | null; name: string; fits?: string | null; oe?: string | null; crossRefs?: string | null; stock: number; price: number; rate: number }[]): ExportCell[][] {
  return [
    ['Шифра', 'Назив', 'Возила', 'OE', 'Замени', 'Залиха', 'Цена со ДДВ'],
    ...L.map((i) => [i.code ?? '', i.name, i.fits ?? '', i.oe ?? '', i.crossRefs ?? '', i.stock, Math.round(i.price * (1 + i.rate / 100) * 100) / 100]),
  ];
}

/** Service reminders (columns of `VIEWS.potsetnici`). */
export function reminderExportRows<X extends { v: { plate?: string | null; make?: string | null; model?: string | null; year?: number | null }; last: { date: string; km?: number | string | null; nextNote?: string | null }; why: string; late: boolean }>(
  R: readonly X[], owner: (r: X) => { name: string; phone: string; email: string },
): ExportCell[][] {
  return [
    ['Таблица', 'Возило', 'Сопственик', 'Телефон', 'Е-пошта', 'Последен сервис', 'Км', 'Што', 'Статус', 'Зошто'],
    ...R.map((x) => { const p = owner(x); return [x.v.plate ?? '', vehicleLabel({ make: x.v.make, model: x.v.model }), p.name, p.phone, p.email, dmy(x.last.date), num(x.last.km) || null, x.last.nextNote ?? '', x.late ? 'поминат' : 'наскоро', x.why]; }),
  ];
}

/* ---------------- invoice draft (legacy woInv → bzInvDraft) ---------------- */

/**
 * Legacy `woInv` opened the invoice editor with a draft (`bzInvDraft`): nothing was booked and no part left stock
 * until the user saved the invoice. Here the invoice is stored as an unbooked `draft`; an order whose invoice is
 * still a draft stays editable (re-invoicing refreshes the same draft) and is frozen once the invoice is booked.
 */
export const workOrderFrozen = (w: { invoiceId?: string | null; invoiceStatus?: string | null }): boolean => !!w.invoiceId && w.invoiceStatus !== 'draft';

/** Legacy `woInv` short-stock check (asks „Сепак да се фактурира?“): parts linked to a stock item with too little on hand. */
export function woShortParts(parts: readonly WoPart[], stock: (itemId: string) => number | null | undefined): WoPart[] {
  return parts.filter((p) => { if (!p.itemId) return false; const s = stock(p.itemId); return s != null && s < num(p.qty); });
}
