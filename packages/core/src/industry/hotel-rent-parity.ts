/**
 * Legacy parity — hotel (9510–9632, 11807–11818) and rent-a-car (9748–9858, 11647–11805): the pieces of the final
 * patched legacy views that were missing from the rebuild — editor callouts and confirmations, guest book / ДЗС
 * statistics, rent-a-car warnings, calculation labels, service intervals, the three extra report tabs of `rentIzv`
 * and the Excel imports of the dig bar (`DIG.hroom`, `DIG.hres`, `DIG.fleet`).
 */
import { addDays, ageAt, dayDiff, num, r2 } from './common';
import { HOTEL_STATUS, stayOverlaps } from './hotel';
import type { RentConfig } from './rentacar';

const dmy = (d: string | null | undefined) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '');

/* ============================== HOTEL ============================== */

/** Legacy grid legend: `Object.values(HT_ST).slice(0, 3)` — colour and label. */
export const HOTEL_LEGEND: readonly (readonly [string, string])[] = (['resv', 'in', 'out'] as const).map((k) => [HOTEL_STATUS[k][0], HOTEL_STATUS[k][2]] as const);

/** Board label on the folio (legacy `htFolioHTML` short labels). */
export const FOLIO_BOARD: Record<string, string> = { RO: 'само ноќевање', BB: 'со појадок', HB: 'полупансион', FB: 'полн пансион' };

/** Legacy `htEditor` callouts (9536–9539): room already taken in the period, departure not after arrival. */
export function hotelEditorCallouts(E: { id?: string | null; roomId: string; from: string; to: string }, others: readonly { id: string; roomId: string; from: string; to: string; status: string }[]): string[] {
  const W: string[] = [];
  const clash = !!E.roomId && !!E.from && !!E.to && others.some((r) => r.id !== E.id && r.roomId === E.roomId && !['cancel', 'noshow'].includes(r.status) && stayOverlaps(E, r));
  if (clash) W.push('⚠ Собата е веќе зафатена во овој период – изберете друга соба или датуми.');
  if (E.to <= E.from) W.push('Датумот на заминување мора да е по датумот на доаѓање.');
  return W;
}

/**
 * Legacy `htIn` (9587): the guests are required before the check-in; guests without a birth date or document number
 * need a confirmation.
 */
export function hotelCheckInCheck(guests: readonly { name?: string; birth?: string; docNo?: string }[]): { error: string | null; confirm: string | null } {
  const G = guests.filter((g) => g.name);
  if (!G.length) return { error: 'Внесете ги гостите (име, датум на раѓање, документ) пред пријавата.', confirm: null };
  const bad = G.filter((g) => !g.docNo || !g.birth).length;
  return { error: null, confirm: bad ? `${bad} гости немаат датум на раѓање или број на документ. Сепак да се пријават?` : null };
}

/** Legacy `htFisc` confirmation text. */
export const hotelTillConfirm = (tax: string) =>
  `Сметката е платена на фискалната каса (приходот влегува преку дневниот промет / Z-извештај)? Таксата за престој ${tax} ден. се евидентира во извештајот за такса.`;

export interface GuestBookRes {
  id: string; from: string; to: string; status: string; inAt?: string | Date | null; roomNo: string;
  guests: readonly { name: string; birth?: string; nat?: string; doc?: string; docNo?: string; sex?: string; police?: string }[];
}

/** Legacy `htGuestRows(a, b)`: named guests of checked-in / checked-out stays touching [a, b], in check-in order. */
export function hotelGuestRows<R extends GuestBookRes>(R: readonly R[], a: string, b: string) {
  const key = (r: GuestBookRes) => (r.inAt ? (r.inAt instanceof Date ? r.inAt.toISOString() : String(r.inAt)) : r.from);
  return R.filter((r) => (r.status === 'in' || r.status === 'out') && r.from <= b && r.to >= a)
    .sort((x, y) => key(x).localeCompare(key(y)))
    .flatMap((r) => r.guests.filter((g) => g.name).map((g) => ({ r, g, room: r.roomNo })));
}

/**
 * Legacy `htStat` (11808) — ДЗС monthly tourist statistics: arrivals (stays starting in the period) and nights within
 * the period per nationality; domestic = MK.
 */
export function hotelDzsStat(R: readonly GuestBookRes[], a: string, b: string) {
  const by: Record<string, { arr: number; nights: number }> = {};
  for (const { r, g } of hotelGuestRows(R, a, b)) {
    const nat = g.nat || 'MK';
    const o = (by[nat] ??= { arr: 0, nights: 0 });
    if (r.from >= a && r.from <= b) o.arr++;
    const s = r.from > a ? r.from : a;
    const end = addDays(b, 1);
    const e = r.to < end ? r.to : end;
    o.nights += Math.max(0, dayDiff(s, e));
  }
  const dom = by.MK ?? { arr: 0, nights: 0 };
  const foreign = Object.entries(by).filter(([k]) => k !== 'MK').sort((x, y) => y[1].nights - x[1].nights);
  const fa = foreign.reduce((s, [, o]) => s + o.arr, 0), fn = foreign.reduce((s, [, o]) => s + o.nights, 0);
  const avg = (n: number, a0: number) => (a0 ? (n / a0).toFixed(1) : '');
  return { dom, foreign, fa, fn, total: { arr: dom.arr + fa, nights: dom.nights + fn }, avg };
}

/* ============================== IMPORTS (legacy dig bar) ============================== */

/** Field spec: key, label (template header), aliases (legacy `DIG[k].f`). */
export type HrImportField = readonly [key: string, label: string, aliases: string];

/** Legacy `DIG.hroom`. */
export const HOTEL_ROOM_IMPORT: readonly HrImportField[] = [
  ['no', 'Број', 'број,соба,room,no,nr'], ['kind', 'Тип', 'тип,type,lloji'], ['beds', 'Легла', 'легла,beds,shtretër'], ['floor', 'Кат', 'кат,floor,kati'], ['price', 'Цена по ноќ', 'цена,price,cmimi'],
];
/** Legacy `DIG.hres` (Booking.com / Airbnb export). */
export const HOTEL_RES_IMPORT: readonly HrImportField[] = [
  ['guest', 'Гостин', 'гостин,guest,guest name,име,booker name,emri'], ['from', 'Доаѓање', 'доаѓање,check-in,arrival,od,from,пристигнување'],
  ['to', 'Заминување', 'заминување,check-out,departure,do,to'], ['room', 'Соба', 'соба,room,unit type,room number,dhoma'],
  ['persons', 'Лица', 'лица,persons,guests,adults,persona'], ['price', 'Вкупна цена', 'цена,price,total,iznos,износ,çmimi'],
  ['source', 'Извор', 'извор,source,booked via,channel'], ['phone', 'Телефон', 'телефон,phone,tel'], ['email', 'Е-пошта', 'е-пошта,email,e-mail'],
];
/** Legacy `DIG.fleet` (rent prices) + the vehicle name for new vehicles. */
export const FLEET_PRICE_IMPORT: readonly HrImportField[] = [
  ['plate', 'Таблица', 'таблица,plate,targa'], ['name', 'Возило', 'возило,назив,модел,vehicle,model,name'], ['rClass', 'Класа', 'класа,class,klasa'],
  ['rDay', 'Цена/ден', 'цена/ден,цена,day,price,dita'], ['rWeek', 'Цена/ден 7+', 'цена/ден 7+,7+,недела,week'], ['rDep', 'Кауција', 'кауција,deposit,depozita'],
  ['rKm', 'Км/ден', 'км/ден,km/day,км'], ['rKmX', 'Доп. км', 'доп,extra,km extra'],
];

/** Legacy `digNorm`. */
export const hrImportNorm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-zа-шѓќѕљњџјçë0-9%+/]+/g, ' ').trim();

/** Legacy `digMap`: header cells → field index (exact alias first, then prefix / contains for aliases over 2 chars). */
export function hrImportMap(hdr: readonly unknown[], F: readonly HrImportField[]): Record<string, number> {
  const H = hdr.map(hrImportNorm);
  const M: Record<string, number> = {};
  for (const [k, , al] of F) {
    const A = al.split(',').map(hrImportNorm);
    let i = H.findIndex((x) => A.includes(x));
    if (i < 0) i = H.findIndex((x) => !!x && A.some((a) => a.length > 2 && (x.startsWith(a) || x.includes(a))));
    if (i >= 0 && !Object.values(M).includes(i)) M[k] = i;
  }
  return M;
}

/** Legacy `digReadXlsx`: find the header among the first 15 rows, return the data rows as objects of strings. */
export function hrImportRows(aoa: readonly (readonly unknown[])[], F: readonly HrImportField[]): Record<string, string>[] {
  const A = aoa.filter((r) => r.some((x) => String(x ?? '').trim() !== ''));
  let hi = 0, best = -1, bm: Record<string, number> = {};
  for (let i = 0; i < Math.min(15, A.length); i++) {
    const m = hrImportMap(A[i]!, F);
    if (Object.keys(m).length > best) { best = Object.keys(m).length; hi = i; bm = m; }
  }
  if (best < 1) throw new Error('Не се препознаа колоните – користете го Excel образецот.');
  return A.slice(hi + 1).map((r) => Object.fromEntries(F.map(([k]) => [k, bm[k] == null ? '' : String(r[bm[k]!] ?? '').trim()])));
}

/** Legacy `digD`: Excel serial, ISO or d.m.y / d/m/y (2-digit years → 20yy). '' when not a date. */
export function hrImportDate(v: unknown): string {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10);
  const s = String(v).trim();
  const p = (x: string) => x.padStart(2, '0');
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${p(m[2]!)}-${p(m[3]!)}`;
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(s);
  if (m) return `${m[3]!.length === 2 ? '20' + m[3] : m[3]}-${p(m[2]!)}-${p(m[1]!)}`;
  if (/^\d{5}$/.test(s)) return hrImportDate(Number(s));
  return '';
}

/** Legacy `digN`: '1.234,50' / '1 234.5' → number (0 when empty). */
export function hrImportNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '').replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  return Number(s) || 0;
}

/** Excel template: header row of the field labels + one sample row. */
export const hrImportTemplate = (F: readonly HrImportField[], sample: readonly (string | number)[]) => [F.map((x) => x[1]), [...sample]];

/** Legacy `digApply` for `hres`: price per night = total / nights, else the room price; persons → adults. */
export function hotelImportReservation(r: Record<string, string>, rooms: readonly { id: string; no: string; kind: string | null; beds: number; price: string | number }[]) {
  const rm = rooms.find((x) => hrImportNorm(x.no) === hrImportNorm(r.room) || (!!x.kind && hrImportNorm(x.kind) === hrImportNorm(r.room)));
  const from = hrImportDate(r.from), to = hrImportDate(r.to);
  const guest = String(r.guest ?? '').trim();
  if (!rm) return { skip: `${guest || '?'} (соба „${r.room ?? ''}“)` } as const;
  if (!from || !to || !(to > from)) return { skip: `${guest || '?'} (датуми)` } as const;
  const nts = dayDiff(from, to);
  const tot = hrImportNum(r.price);
  return {
    res: {
      roomId: rm.id, from, to, guestName: guest || '?', phone: r.phone ?? '', email: r.email ?? '', adults: hrImportNum(r.persons) || rm.beds || 2,
      price: tot && nts ? r2(tot / nts) : num(rm.price), src: String(r.source ?? '').trim() || 'увоз',
    },
  } as const;
}

/* ============================== RENT-A-CAR ============================== */

/** Legacy `RC_CT` (11648) — countries of travel. */
export const RENT_COUNTRIES: readonly (readonly [string, string])[] = [
  ['MK', 'Северна Македонија'], ['AL', 'Албанија'], ['XK', 'Косово'], ['RS', 'Србија'], ['ME', 'Црна Гора'], ['BA', 'Босна и Херцеговина'], ['HR', 'Хрватска'],
  ['SI', 'Словенија'], ['GR', 'Грција'], ['BG', 'Бугарија'], ['TR', 'Турција'], ['EU', 'Други држави од ЕУ'],
];
/** Legacy `RC_CHK` — equipment and documents checklist of the handover record. */
export const RENT_CHECKLIST = ['Сообраќајна дозвола', 'Полиса за осигурување', 'Зелен картон', 'Резервна гума', 'Дигалка и клуч за тркала', 'Прва помош', 'Триаголник', 'Светлосен елек', 'Зимска опрема / синџири', 'Клучеви (бр.)'] as const;
/** Legacy extras datalist (`rx_l`). */
export const RENT_EXTRAS = ['Детско седиште', 'Дополнителен возач', 'Зелен картон (странство)', 'GPS уред', 'Чистење на возилото', 'Штета на возилото', 'Доставување / преземање на адреса'] as const;
export const rentCountryName = (c: string) => RENT_COUNTRIES.find((x) => x[0] === c)?.[1] ?? c;
export const rentAbroad = (countries: readonly string[] | null | undefined) => (countries?.length ? countries : ['MK']).some((c) => c !== 'MK');

export interface RentDriverLike { name?: string; birth?: string; licFrom?: string; licExp?: string; docExp?: string; phone?: string }

/**
 * Legacy `rcEditor` warnings (9778 + 11687): vehicle taken, driver age, licence years, licence / document expiring
 * before the return, vehicle registration / insurance / technical inspection expiring, abroad without green card.
 */
export function rentWarnings(
  E: { from: string; to: string; status: string; countries?: readonly string[] | null; green?: boolean; driver: RentDriverLike },
  v: { regExp?: string | null; insExp?: string | null; techExp?: string | null } | null,
  c: Pick<RentConfig, 'minAge' | 'minLic'>,
  clash: { number: string; driverName: string } | null,
): string[] {
  const W: string[] = [];
  const d = E.driver ?? {};
  const f = String(E.from).slice(0, 10), to = String(E.to).slice(0, 10);
  if (clash) W.push(`Возилото е зафатено: ${clash.number} (${clash.driverName})`);
  const age = ageAt(d.birth, f);
  if (age != null && age < num(c.minAge)) W.push(`Возачот има ${age} години (минимум ${c.minAge}).`);
  const licY = d.licFrom ? ageAt(d.licFrom, f) : null;
  if (licY != null && licY < num(c.minLic)) W.push(`Возачка дозвола помалку од ${c.minLic} години.`);
  if (d.licExp && d.licExp < to) W.push(`Возачката дозвола истекува пред крајот на изнајмувањето (${dmy(d.licExp)}).`);
  if (v) for (const [n, x] of [['регистрација', v.regExp], ['осигурување', v.insExp], ['технички', v.techExp]] as const) if (x && x < to) W.push(`Возилото: ${n} истекува ${dmy(x)} – пред крајот на изнајмувањето.`);
  if (d.docExp && d.docExp < to) W.push(`Документот за идентификација истекува ${dmy(d.docExp)} – пред крајот на изнајмувањето.`);
  if (rentAbroad(E.countries) && !E.green && E.status !== 'resv') W.push('Возилото е во странство без означен зелен картон.');
  return W;
}

/** Legacy `rcOut` minimum-age confirmation (asked before the handover). */
export function rentAgeConfirm(d: RentDriverLike, from: string, c: Pick<RentConfig, 'minAge'>): string | null {
  const age = ageAt(d.birth, String(from).slice(0, 10));
  return age != null && age < num(c.minAge) ? `Возачот има ${age} години (минимум ${c.minAge}). Сепак?` : null;
}

/** Calculation label (legacy 9789): days, weekly price, season markup. */
export function rentCalcLabel(days: number, v: { rWeek?: unknown }, c: Pick<RentConfig, 'sPct' | 'sFrom' | 'sTo'>, pDayAgreed?: number | null): string {
  return `Изнајмување: ${days} ${days === 1 ? 'ден' : 'дена'}${days >= 7 && num(v.rWeek) && !pDayAgreed ? ' (неделна цена)' : ''}${pDayAgreed ? ` × ${pDayAgreed.toFixed(2)} (договорена цена)` : ''}${num(c.sPct) && !pDayAgreed ? ` · сезона +${c.sPct}% (${c.sFrom} – ${c.sTo})` : ''}`;
}

/** Legacy `rcRet` toast. */
export const rentReturnMessage = (tot: number, auto: boolean) =>
  `Возилото е примено. За плаќање ${tot.toFixed(2)} ден.${auto ? ' (вклучени дополнителни км / гориво)' : ''}`;

/** Legacy `rcDepBack` default: keep at most the unpaid rest of the invoice. */
export const rentDepositKeepDefault = (dep: number, open: number) => r2(Math.min(dep, Math.max(0, open)));

/** Legacy `pnSvc` (9247): oil service / tyres by km, `bad` when overdue, `warn` under 1000 km. */
export function rentServiceDue(v: { odo?: number | null; oilEvery?: number | null; oilLastKm?: number | null; tyreEvery?: number | null; tyreLastKm?: number | null }) {
  const odo = num(v.odo);
  const L: { t: 'oil' | 'tyre'; n: string; due: number; left: number; st: '' | 'bad' | 'warn' | 'good' }[] = [];
  const add = (t: 'oil' | 'tyre', n: string, every: unknown, last: unknown) => {
    if (!num(every)) return;
    const due = num(last) + num(every);
    const left = due - odo;
    L.push({ t, n, due, left, st: !odo ? '' : left < 0 ? 'bad' : left < 1000 ? 'warn' : 'good' });
  };
  add('oil', 'Сервис (масло и филтри)', v.oilEvery, v.oilLastKm);
  add('tyre', 'Гуми', v.tyreEvery, v.tyreLastKm);
  return L;
}

/** Legacy `rentIzv` deadlines: registration / insurance / technical within 30 days (or past), `osDays(d) <= 30`. */
export function rentDocsSoon(v: { regExp?: string | null; insExp?: string | null; techExp?: string | null }, today: string): [string, string][] {
  return ([['рег.', v.regExp], ['осиг.', v.insExp], ['техн.', v.techExp]] as const)
    .filter(([, d]) => d && dayDiff(today, d) <= 30).map(([n, d]) => [n, d!] as [string, string]);
}

/** Legacy `rentIzv` column „Сервис и рокови“. */
export function rentServiceText(v: Parameters<typeof rentServiceDue>[0] & Parameters<typeof rentDocsSoon>[0], today: string): string[] {
  return [
    ...rentServiceDue(v).filter((s) => s.st === 'bad' || s.st === 'warn').map((s) => `🔧 ${s.n} ${s.left < 0 ? 'поминат' : `за ${s.left} км`}`),
    ...rentDocsSoon(v, today).map(([n, d]) => `📄 ${n} ${dmy(d)}`),
  ];
}

/** A rental prepared for the reports (`rcRev` + `rcCalc` done by the caller). */
export interface RentReportRow {
  id: string; number: string; plate: string; from: string; to: string; status: string; retAt?: string | null;
  driver: { name?: string; phone?: string; nat?: string; docExp?: string; licExp?: string };
  partnerId?: string | null; partnerName?: string | null; countries: readonly string[]; green: boolean;
  deposit: number; depositIn: boolean; depositClosed: boolean;
  days: number; tot: number; km: number;
  /** Legacy `rcRev`: net revenue from the invoice, or estimated from the contract (`est`). */
  net: number; gross: number; paid: number; est: boolean; invNumber: string | null;
}

/** Legacy `rcRev`: invoice base when invoiced, otherwise the contract total without VAT (estimate). */
export function rentRevenue(tot: number, rate: number, inv: { base: number; total: number; paid: number; number: string } | null) {
  if (inv) return { net: r2(inv.base), gross: r2(inv.total), paid: r2(inv.paid), est: false, invNumber: inv.number };
  return { net: r2(tot / (1 + (num(rate) || 18) / 100)), gross: tot, paid: 0, est: true, invNumber: null };
}

/** Rentals of the report period (legacy: not reservations, starting ≤ b and ending ≥ a). */
export const rentInPeriod = <R extends RentReportRow>(L: readonly R[], a: string, b: string) =>
  L.filter((r) => r.status !== 'resv' && r.status !== 'cancel' && r.from.slice(0, 10) <= b && String(r.retAt || r.to).slice(0, 10) >= a);

/** Legacy `rentIzv` tab `mon`: per month of the pick-up. */
export function rentByMonth(L: readonly RentReportRow[], nVehicles: number) {
  const by: Record<string, { n: number; days: number; net: number; est: number; km: number }> = {};
  for (const r of L) {
    const o = (by[r.from.slice(0, 7)] ??= { n: 0, days: 0, net: 0, est: 0, km: 0 });
    o.n++; o.days += r.days; o.net = r2(o.net + r.net); if (r.est) o.est = r2(o.est + r.net); o.km += r.km || 0;
  }
  const M = Object.entries(by).sort(([x], [y]) => x.localeCompare(y));
  const mx = Math.max(1, ...M.map(([, o]) => o.net));
  return M.map(([mo, o]) => {
    const [y, m] = mo.split('-').map(Number) as [number, number];
    const cap = nVehicles * new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { mo, ...o, util: cap ? Math.round((Math.min(o.days, cap) / cap) * 100) : null, perDay: o.days ? r2(o.net / o.days) : null, bar: Math.round((o.net / mx) * 100) };
  });
}

/** Legacy `rentIzv` tab `cli`: clients (firm or driver), countries of travel, nationality of the drivers. */
export function rentClients(L: readonly RentReportRow[]) {
  const C: Record<string, { name: string; ph: string; n: number; days: number; net: number; firm: boolean }> = {};
  const N: Record<string, { n: number; net: number }> = {};
  const K: Record<string, number> = {};
  for (const r of L) {
    const d = r.driver ?? {};
    const key = r.partnerId ? 'p:' + r.partnerId : 'd:' + String(d.name ?? '').trim().toLowerCase();
    const o = (C[key] ??= { name: (r.partnerId ? r.partnerName : d.name) ?? '', ph: d.phone ?? '', n: 0, days: 0, net: 0, firm: !!r.partnerId });
    o.n++; o.days += r.days; o.net = r2(o.net + r.net); if (d.phone) o.ph = d.phone;
    const nat = d.nat || '—';
    const x = (N[nat] ??= { n: 0, net: 0 }); x.n++; x.net = r2(x.net + r.net);
    for (const c of r.countries.length ? r.countries : ['MK']) K[c] = (K[c] ?? 0) + 1;
  }
  return {
    clients: Object.values(C).sort((a, b) => b.net - a.net),
    countries: Object.entries(K).sort((a, b) => b[1] - a[1]),
    nationalities: Object.entries(N).sort((a, b) => b[1].n - a[1].n),
  };
}

/** Legacy `rentIzv` tab `open`: late returns, vehicles abroad, returned without invoice, unpaid, open deposits, documents. */
export function rentOpenItems(all: readonly RentReportRow[], now: string) {
  const to10 = (r: RentReportRow) => r.to.slice(0, 10);
  return {
    late: all.filter((r) => r.status === 'out' && r.to < now).map((r) => ({ r, hours: Math.max(0, Math.round((Date.parse(now.slice(0, 16) + ':00Z') - Date.parse((r.to.length <= 10 ? r.to + 'T09:00' : r.to.slice(0, 16)) + ':00Z')) / 36e5)) })),
    abroad: all.filter((r) => r.status === 'out' && rentAbroad(r.countries)),
    noInv: all.filter((r) => r.status === 'ret' && !r.invNumber),
    unpaid: all.filter((r) => r.invNumber && r.gross - r.paid > 0.5),
    deposits: all.filter((r) => r.depositIn && !r.depositClosed),
    docs: all.filter((r) => (r.status === 'resv' || r.status === 'out') && ((r.driver.docExp && r.driver.docExp < to10(r)) || (r.driver.licExp && r.driver.licExp < to10(r)))),
  };
}

/** Legacy `DIG.fleet` apply: the prices of a row (only filled cells); plate normalised like `plN`. */
export function fleetImportRow(r: Record<string, string>) {
  const plate = String(r.plate ?? '').replace(/[\s-]+/g, '').toUpperCase();
  const p: Record<string, number> = {};
  for (const f of ['rDay', 'rWeek', 'rDep', 'rKm', 'rKmX'] as const) if (r[f] !== '' && r[f] != null) p[f] = hrImportNum(r[f]);
  return { plate, name: String(r.name ?? '').trim(), rClass: String(r.rClass ?? '').trim(), prices: p };
}


/* ---------------- rent-a-car: identity document / driving licence scan (legacy `RC_DOC_PROMPT`, `rcScanDoc` 11650) ---------------- */

/** Legacy `RC_DOC_PROMPT` (verbatim). */
export const RC_DOC_PROMPT = `You read an identity document photo/scan for a car-rental contract in North Macedonia. It can be a passport, a national ID card (front and/or back) or a driving licence; several images may be given (front/back, or passport + licence). Read the MRZ if present and cross-check it with the printed fields.
Return ONLY JSON:
{"docType":"passport|id|license","name":"Given names + Surname as printed (Latin or Cyrillic as printed)","birth":"YYYY-MM-DD","sex":"M|F|","nationality":"country name in Macedonian, e.g. Македонија, Албанија, Косово, Германија","embg":"personal number (ЕМБГ / Personal No.) or ''","docNo":"passport or ID number","docIssued":"YYYY-MM-DD or ''","docExp":"YYYY-MM-DD or ''","docIssuer":"issuing authority or ''","address":"address if printed (ID back) or ''",
"lic":{"no":"driving licence number or ''","cat":"categories e.g. B, C1","issued":"YYYY-MM-DD (date of issue of category B if shown, else of the licence) or ''","exp":"YYYY-MM-DD or ''"}}
Rules: dates as YYYY-MM-DD; MRZ dates are YYMMDD. If a field is not visible use ''. If only a driving licence is given, put docType "license" and fill lic plus name/birth.`;
export const RC_DOC_PROMPT_LICENCE = RC_DOC_PROMPT + '\nThe user says this is a DRIVING LICENCE.';

/** Legacy `rcIsoD`: `d.m.yyyy` / ISO → `YYYY-MM-DD`, else ''. */
export const rcIsoDate = (v: unknown): string => {
  const s = String(v ?? '').trim();
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(s);
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
};

/**
 * Legacy `rcScanDoc` apply: the fields read from a passport / ID card / driving licence (only non-empty values),
 * and what was read for the status line („✓ Прочитано: …“).
 */
export function rcDocToDriver(r0: unknown, licence: boolean): { set: Record<string, string>; read: string[] } {
  const r = ((Array.isArray(r0) ? r0[0] : r0) ?? {}) as Record<string, unknown>;
  const L = (r.lic ?? {}) as Record<string, unknown>;
  const set: Record<string, string> = {};
  const read: string[] = [];
  const put = (k: string, v: unknown) => { const s = String(v ?? '').trim(); if (s) set[k] = s; };
  if (r.name) { put('name', r.name); read.push('име'); }
  if (rcIsoDate(r.birth)) { set.birth = rcIsoDate(r.birth); read.push('датум на раѓање'); }
  if (!licence && r.docType !== 'license') {
    if (r.docNo) { put('doc', r.docNo); set.docType = r.docType === 'id' ? 'id' : 'passport'; read.push(set.docType === 'id' ? 'лична карта' : 'пасош'); }
    if (rcIsoDate(r.docExp)) set.docExp = rcIsoDate(r.docExp);
    put('docIss', r.docIssuer); put('nat', r.nationality); put('embg', r.embg); put('addr', r.address);
  }
  if (L.no) { put('lic', L.no); read.push('возачка'); }
  put('licCat', L.cat);
  if (rcIsoDate(L.issued)) set.licFrom = rcIsoDate(L.issued);
  if (rcIsoDate(L.exp)) set.licExp = rcIsoDate(L.exp);
  return { set, read };
}
