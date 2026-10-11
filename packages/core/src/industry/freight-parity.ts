/**
 * Freight for third parties — legacy parity layer (v469–v476, `legacy/index.html` 14436–14706).
 *
 * Pure helpers for the final behaviour of `VIEWS.frTuri` / `frEditor` (+ patch 14703), `ACT.frInv` (+ `saveInv` patch
 * 14549), `ACT.frTXlsx`, `frCost`, `frExp` / `frExpFor`, `VIEWS.frDnev` / `frDnevPdfHTML`, `ACT.frCfgSave`,
 * `VIEWS.frDok` / `ACT.frDocSave`, `ACT.frQuickSave` and `monSel`. The per-diem and fuel maths stay in
 * `transport.ts` / `fuelcard.ts`; this file adds what the screens, prints and exports need.
 */
import { dayDiff, num, r2 } from './common';
import { FR_COUNTRIES, FR_STATUS, type FreightSegment } from './transport';

/* ------------------------------------------------------------------ formatting */

const group = (int: string) => int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
/** Legacy `fmt`: `1.234,56`. */
export const frFmt = (n: number | string | null | undefined): string => {
  const v = Number(n) || 0;
  const [i, d] = Math.abs(v).toFixed(2).split('.') as [string, string];
  return (v < 0 && (i !== '0' || d !== '00') ? '-' : '') + group(i) + ',' + d;
};
/** Legacy `dmy`. */
export const frDmy = (d: string | null | undefined): string => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '');

/* ------------------------------------------------------------------ monSel (14438) */

export const MK_MONTHS = ['Јануари', 'Февруари', 'Март', 'Април', 'Мај', 'Јуни', 'Јули', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'] as const;

/** Legacy `monSel(id, val)`: months of the year of `val` + 1 down to − 2, newest first, labelled `Март 2026`. */
export function monthOptions(val: string, fallbackYear: number): { value: string; label: string }[] {
  const y = Number(String(val || '').slice(0, 4)) || fallbackYear;
  const L: { value: string; label: string }[] = [];
  for (let yy = y + 1; yy >= y - 2; yy--) for (let m = 12; m >= 1; m--) {
    const v = `${yy}-${String(m).padStart(2, '0')}`;
    L.push({ value: v, label: `${MK_MONTHS[m - 1]} ${yy}` });
  }
  return L;
}
export const isMonth = (s: string | null | undefined): s is string => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s ?? ''));

/* ------------------------------------------------------------------ constants */

/** Currency select of the price (legacy editor 14516) and of the tolls (14524). */
export const FR_CURRENCIES = ['EUR', 'MKD', 'USD', 'CHF', 'GBP'] as const;
export const FR_TOLL_CURRENCIES = ['EUR', 'MKD'] as const;
export type FrStatus = keyof typeof FR_STATUS;
/** Legacy list filter: 'open' (default, not invoiced / cancelled), 'all' or one status. */
export const FR_FILTERS: readonly (readonly [string, string])[] = [['open', 'Отворени (нефактурирани)'], ['all', 'Сите'], ...Object.entries(FR_STATUS).map(([k, v]) => [k, v[0]] as const)];

/* ------------------------------------------------------------------ tours */

export type FxFn = (cur: string, date: string) => number;

export interface FrTourLike {
  id?: string | null; number: string; date: string; status?: string | null; partnerId?: string | null; orderNo?: string | null; km?: number | string | null;
  vehicleId?: string | null; trailer?: string | null; driverId?: string | null; driver2Id?: string | null;
  loadPlace?: string | null; loadC?: string | null; unloadPlace?: string | null; unloadC?: string | null; unloadDate?: string | null;
  price?: number | string | null; cur?: string | null; fx?: number | string | null; vat?: string | null;
  tolls?: number | string | null; tollCur?: string | null; otherCost?: number | string | null; invoiceId?: string | null;
  segs?: readonly FreightSegment[];
}

/** Rate of the tour's price: MKD → 1, else the typed rate or NBRM on the unloading date (0 = missing). */
export function frTourFx(t: Pick<FrTourLike, 'cur' | 'fx' | 'unloadDate' | 'date'>, fx: FxFn): number {
  if (!t.cur || t.cur === 'MKD') return 1;
  return num(t.fx) || fx(t.cur, String(t.unloadDate || t.date).slice(0, 10)) || 0;
}
/** Legacy `frPriceMkd`. */
export const frPriceMkd = (t: Pick<FrTourLike, 'price' | 'cur' | 'fx' | 'unloadDate' | 'date'>, fx: FxFn): number => r2(num(t.price) * frTourFx(t, fx));

/** Legacy `frCost` 14473: card fuel + per diems + tolls (in their currency at the tour date) + other costs (MKD). */
export function frCost(t: Pick<FrTourLike, 'tolls' | 'tollCur' | 'otherCost' | 'date'>, fuelMkd: number, perDiemMkd: number, fx: FxFn) {
  const tolls = r2(num(t.tolls) * (t.tollCur && t.tollCur !== 'MKD' ? fx(t.tollCur, String(t.date).slice(0, 10)) || 0 : 1));
  const oth = num(t.otherCost);
  return { fuel: r2(fuelMkd), dn: r2(perDiemMkd), tolls, oth, total: r2(fuelMkd + perDiemMkd + tolls + oth) };
}

/** Legacy list filter 14481–14482 (status, month, client). */
export function frFilterTours<T extends Pick<FrTourLike, 'status' | 'date' | 'partnerId'>>(L: readonly T[], F: { st?: string | null; mo?: string | null; p?: string | null }): T[] {
  const st = F.st || 'open';
  let R = [...L];
  if (st === 'open') R = R.filter((t) => !['inv', 'cancel'].includes(String(t.status || 'plan')));
  else if (st !== 'all') R = R.filter((t) => (t.status || 'plan') === st);
  if (F.mo) R = R.filter((t) => String(t.date).slice(0, 7) === F.mo);
  if (F.p) R = R.filter((t) => t.partnerId === F.p);
  return R;
}
/** Legacy `can2`: only planned / on-road / finished tours that are not invoiced can be picked for an invoice. */
export const frCanPick = (t: Pick<FrTourLike, 'status' | 'invoiceId'>): boolean => ['done', 'road', 'plan'].includes(String(t.status || 'plan')) && !t.invoiceId;

/** Legacy `frNextNo` 14455: `Т-001/2026` (the highest number of the year + 1). */
export function frNextNo(used: readonly { number: string; date: string }[], date: string): string {
  const y = String(date).slice(0, 4);
  const n = used.filter((x) => String(x.date).slice(0, 4) === y).map((x) => parseInt(String(x.number || '').replace(/^\D+/, ''), 10) || 0);
  return 'Т-' + String((n.length ? Math.max(...n) : 0) + 1).padStart(3, '0') + '/' + y;
}

/**
 * Legacy `ACT.frSave` 14533–14536 validations, in the legacy order and with the legacy messages.
 * `prev` = the stored tour when editing; `dupNumber` = another tour has the same number.
 */
export function frTourError(t: FrTourLike, o: { dupNumber: boolean; prev?: (FrTourLike & { invNumber?: string | null }) | null; countryName: (c: string) => string }): string | null {
  if (!t.partnerId && (num(t.price) || t.status === 'done')) return 'Изберете клиент (налогодавач) – потребен е за фактурата.';
  if (!t.partnerId && !t.driverId) return 'Изберете клиент или возач.';
  if (!String(t.number || '').trim()) return 'Внесете број на турата.';
  if (o.dupNumber) return `Бројот ${String(t.number).trim()} веќе постои.`;
  for (const g of t.segs ?? []) if (g.in && g.out && g.out < g.in) return `Излезот од ${o.countryName(g.c)} е пред влезот.`;
  const p = o.prev;
  if (p?.invoiceId && (num(p.price) !== num(t.price) || (p.cur || '') !== (t.cur || '') || (p.vat || '') !== (t.vat || '') || (p.partnerId || null) !== (t.partnerId || null))) {
    return `Турата е фактурирана (${p.invNumber ?? ''}) – цената, валутата, ДДВ и клиентот не се менуваат тука. Користете одобрение или нова фактура.`;
  }
  return null;
}

/* ------------------------------------------------------------------ invoice from tours (14540 + saveInv 14549) */

export interface FrInvoicePlan {
  partnerId: string; cur: string; fx: number; pdate: string; total: number; note: string;
  lines: { name: string; unit: string; qty: number; price: number; rate: number }[];
}

/**
 * Legacy `ACT.frInv`: one client, one currency; line text `Превоз на стока A (C) – B (C), CMR Т-001/2026, SK-1234-AB/SK-55-XY,
 * нар. 77 · 1.200,00 EUR × 61.5`; note with the foreign-currency total and the international-transport VAT exemption;
 * `pdate` = the latest unloading date. FIX (LEGACY-MAP 10.4 item 15, kept): the invoice is in the tours' currency at
 * the first tour's rate (legacy converted every line to MKD), so line prices stay in that currency.
 */
export function frInvoicePlan(T: readonly FrTourLike[], o: { plate: (vehicleId: string) => string | null | undefined; fx: FxFn; date: string }): FrInvoicePlan | { error: string } {
  const R = T.filter((t) => !t.invoiceId);
  if (!R.length) return { error: 'Изберете тури.' };
  const P = [...new Set(R.map((t) => t.partnerId || ''))];
  if (P.length > 1) return { error: 'Избраните тури се на различни клиенти – една фактура е за еден клиент.' };
  if (!P[0]) return { error: 'Изберете клиент (налогодавач) – потребен е за фактурата.' };
  const C = [...new Set(R.map((t) => t.cur || 'MKD'))];
  if (C.length > 1) return { error: 'Избраните тури се во различни валути.' };
  const cur = C[0]!;
  const fxOf = (t: FrTourLike) => (cur !== 'MKD' ? frTourFx({ ...t, cur }, o.fx) : 1);
  const fx = fxOf(R[0]!);
  if (!(fx > 0)) return { error: `Нема курс за ${cur} – внесете го во Курсна листа.` };
  const lines = R.map((t) => {
    const pl = t.vehicleId ? o.plate(t.vehicleId) : null;
    const name = `Превоз на стока ${t.loadPlace || ''}${t.loadC ? ' (' + t.loadC + ')' : ''} – ${t.unloadPlace || ''}${t.unloadC ? ' (' + t.unloadC + ')' : ''}, CMR ${t.number}${pl ? ', ' + pl : ''}${t.trailer ? '/' + t.trailer : ''}${t.orderNo ? ', нар. ' + t.orderNo : ''}${cur !== 'MKD' ? ` · ${frFmt(num(t.price))} ${cur} × ${fxOf(t)}` : ''}`;
    return { name, unit: 'тура', qty: 1, price: num(t.price), rate: t.vat === 'dom' ? 18 : 0 };
  });
  const total = r2(R.reduce((a, t) => a + num(t.price), 0));
  const intl = R.some((t) => t.vat !== 'dom');
  const note = [
    cur !== 'MKD' ? `Вкупно за плаќање: ${frFmt(total)} ${cur}. Денарската противвредност е по среден курс на НБРМ.` : '',
    intl ? 'Меѓународен превоз на стоки – ослободено од ДДВ со право на одбивка според Законот за ДДВ.' : '',
  ].filter(Boolean).join(' ');
  const pdate = R.map((t) => String(t.unloadDate || t.date).slice(0, 10)).sort().pop() || o.date;
  return { partnerId: P[0], cur, fx, pdate, total, note, lines };
}

/* ------------------------------------------------------------------ Excel export (frTXlsx 14551) */

export const FR_XLSX_HEAD = ['Тура', 'Датум', 'Клиент', 'Нарачка', 'Товарење', 'Држ.', 'Истовар', 'Држ.', 'Датум истовар', 'Возило', 'Приколка', 'Возач', 'Км', 'Цена', 'Валута', 'Цена ден.', 'Гориво ден.', 'Патарини ден.', 'Дневници ден.', 'Други ден.', 'Разлика ден.', 'Статус', 'Фактура'] as const;

/** One row of the legacy 23-column tours sheet. */
export function frXlsxRow(t: FrTourLike, x: { partner: string; plate: string; driver: string; rev: number; cost: ReturnType<typeof frCost>; invNumber: string }): (string | number)[] {
  return [
    t.number, frDmy(t.date), x.partner, t.orderNo || '', t.loadPlace || '', t.loadC || '', t.unloadPlace || '', t.unloadC || '', frDmy(t.unloadDate), x.plate, t.trailer || '', x.driver,
    num(t.km), num(t.price), t.cur || 'MKD', x.rev, x.cost.fuel, x.cost.tolls, x.cost.dn, x.cost.oth, r2(x.rev - x.cost.total), (FR_STATUS[(t.status || 'plan') as FrStatus] ?? [''])[0], x.invNumber,
  ];
}

/* ------------------------------------------------------------------ licences and documents (frExp / frExpFor / frDok) */

export interface FrDocLike { id?: string; who: 'veh' | 'drv'; ref: string; kind: string; no?: string | null; validFrom?: string | null; validTo?: string | null; note?: string | null }

/** Legacy `osDays`: whole days from today to the date (null without a date). */
export const frDays = (d: string | null | undefined, today: string): number | null => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? dayDiff(today, d) : null);

/** Legacy `frExp` 14475: documents expiring within 30 days (or already expired). */
export function frExpiring<T extends FrDocLike>(docs: readonly T[], today: string, within = 30): { d: T; n: number }[] {
  return docs.map((d) => ({ d, n: frDays(d.validTo, today) })).filter((x): x is { d: T; n: number } => x.n != null && x.n <= within);
}
/** Legacy `frExpFor` 14476: expired documents of the tour's vehicle and drivers. */
export function frExpiredFor<T extends FrDocLike>(t: Pick<FrTourLike, 'vehicleId' | 'driverId' | 'driver2Id'>, docs: readonly T[], today: string): T[] {
  const ids = [t.vehicleId, t.driverId, t.driver2Id].filter(Boolean) as string[];
  return docs.filter((d) => ids.includes(d.ref) && (frDays(d.validTo, today) ?? 0) < 0 && !!d.validTo);
}
/** Legacy badge 14606: `истечено` / `за N дена` / `важи`. */
export function frDocBadge(validTo: string | null | undefined, today: string): readonly [string, string] | null {
  const n = frDays(validTo, today);
  return n == null ? null : n < 0 ? ['bad', 'истечено'] : n <= 30 ? ['warn', `за ${n} дена`] : ['good', 'важи'];
}
/** Legacy `ACT.frDocSave` 14618 checks. */
export function frDocError(d: FrDocLike): string | null {
  if (!d.ref) return d.who === 'drv' ? 'Нема внесени вработени (возачи).' : 'Нема внесени возила во ОС → Регистар.';
  if (d.validFrom && d.validTo && d.validTo < d.validFrom) return '„Важи до“ е пред „Важи од“.';
  return null;
}

/** Template of the documents import (server addition: legacy had no import on this screen, the user's rule asks for one). */
export const FR_DOC_IMPORT_HEAD = ['За (возило / возач)', 'Регистрација / име на возач', 'Вид', 'Број', 'Важи од', 'Важи до', 'Забелешка'] as const;

const impDate = (s: string): string | null | false => {
  const x = String(s ?? '').trim();
  if (!x) return null;
  let m = x.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  m = x.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) return `${m[3]!.length === 2 ? '20' + m[3] : m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return false;
};
const plateK = (s: string | null | undefined) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9А-Ш]/g, '');

/**
 * Rows of the documents sheet (header first) → documents. `За` = „возач“ / „drv“ for drivers, else vehicle; the
 * vehicle is matched by plate, the driver by name (case-insensitive). Row errors are reported with the row number.
 */
export function frDocImport(rows: readonly (readonly string[])[], vehicles: readonly { id: string; plate: string }[], drivers: readonly { id: string; name: string }[], kinds: { veh: readonly string[]; drv: readonly string[] }): { docs: FrDocLike[]; errors: string[] } {
  const docs: FrDocLike[] = [];
  const errors: string[] = [];
  rows.slice(1).forEach((r, i) => {
    const c = (k: number) => String(r[k] ?? '').trim();
    if (!c(1) && !c(2)) return;
    const who: 'veh' | 'drv' = /^(возач|drv|driver|👤)/i.test(c(0)) ? 'drv' : 'veh';
    const ref = who === 'drv' ? drivers.find((d) => d.name.trim().toLowerCase() === c(1).toLowerCase())?.id : vehicles.find((v) => plateK(v.plate) === plateK(c(1)))?.id;
    const row = i + 2;
    if (!ref) { errors.push(`Ред ${row}: ${who === 'drv' ? 'нема вработен' : 'нема возило'} „${c(1)}“.`); return; }
    const K = kinds[who];
    const kind = K.find((k) => k.toLowerCase() === c(2).toLowerCase()) ?? (c(2) || K[0]!);
    const validFrom = impDate(c(4)), validTo = impDate(c(5));
    if (validFrom === false || validTo === false) { errors.push(`Ред ${row}: неважечки датум.`); return; }
    const d: FrDocLike = { who, ref, kind, no: c(3), validFrom, validTo, note: c(6) };
    const e = frDocError(d);
    if (e) { errors.push(`Ред ${row}: ${e}`); return; }
    docs.push(d);
  });
  return { docs, errors };
}

/* ------------------------------------------------------------------ per diems abroad (frDnev 14580, frCfgSave 14598) */

/** Legacy `VIEWS.frDnev` filter: tours of the month with at least one country, not cancelled. */
export const frDnevTours = <T extends Pick<FrTourLike, 'date' | 'status' | 'segs'>>(L: readonly T[], mo: string): T[] =>
  L.filter((t) => (t.segs ?? []).some((g) => g.c) && String(t.date).slice(0, 7) === mo && t.status !== 'cancel');
/** Legacy warning list: tours of the month without borders. */
export const frToursWithoutBorders = <T extends Pick<FrTourLike, 'date' | 'status' | 'segs'>>(L: readonly T[], mo: string): T[] =>
  L.filter((t) => String(t.date).slice(0, 7) === mo && t.status !== 'cancel' && !(t.segs ?? []).some((g) => g.c));

/** Legacy per-driver aggregation (by `driverId` only; `-` = without driver). */
export function frDnevByDriver<T extends Pick<FrTourLike, 'driverId'>>(T: readonly T[], dn: (t: T) => { mkd: number; by: Record<string, number>; rows: { u: number }[] }) {
  const by = new Map<string, T[]>();
  for (const t of T) { const k = t.driverId || '-'; by.set(k, [...(by.get(k) ?? []), t]); }
  return [...by.entries()].map(([k, L]) => {
    let mkd = 0, u = 0;
    const cur: Record<string, number> = {};
    for (const t of L) {
      const d = dn(t);
      mkd += d.mkd;
      for (const [c, v] of Object.entries(d.by)) cur[c] = r2((cur[c] ?? 0) + v);
      u += d.rows.reduce((a, r) => a + r.u, 0);
    }
    return { driverId: k, tours: L, units: u, by: cur, mkd: r2(mkd) };
  });
}

/** Legacy `ACT.frCfgSave`: blank = standard; 0 < amount < 1000; the currency is the table's. */
export function frParseRates(entries: readonly (readonly [string, string])[]): { rates: Record<string, [number, string]> } | { error: string } {
  const rates: Record<string, [number, string]> = {};
  for (const [code, raw] of entries) {
    const v = String(raw).replace(',', '.').trim();
    if (v === '') continue;
    const n = Number(v);
    if (!(n > 0 && n < 1000)) return { error: 'Неважечки износ.' };
    const d = FR_COUNTRIES.find((x) => x[0] === code);
    if (!d) continue;
    rates[code] = [n, d[3]];
  }
  return { rates };
}

/* ------------------------------------------------------------------ quick add (frQuickSave 14697) */

export function frQuickDriverError(name: string, embg: string, existingEmbg: readonly (string | null | undefined)[]): string | null {
  if (!name.trim()) return 'Внесете име.';
  if (embg && !/^\d{13}$/.test(embg)) return 'ЕМБГ има 13 цифри.';
  if (embg && existingEmbg.includes(embg)) return 'Вработен со овој ЕМБГ веќе постои.';
  return null;
}
export function frQuickVehicleError(plate: string, existingPlates: readonly string[]): string | null {
  if (!plate.trim()) return 'Внесете регистрација.';
  if (existingPlates.some((p) => plateK(p) === plateK(plate))) return 'Возило со оваа регистрација веќе постои.';
  return null;
}
/** Legacy name of a quickly added vehicle: `Scania R450 SK-1234-AB` / `Камион SK-…` / `Приколка SK-…`. */
export const frQuickVehicleName = (trailer: boolean, name: string, plate: string): string => `${name.trim() || (trailer ? 'Приколка' : 'Камион')} ${plate.trim().toUpperCase()}`;
/** Legacy employee number: highest numeric `no` + 1. */
export const frNextEmployeeNo = (nos: readonly (string | null | undefined)[]): string => String(nos.reduce((m, x) => Math.max(m, parseInt(String(x ?? ''), 10) || 0), 0) + 1);
