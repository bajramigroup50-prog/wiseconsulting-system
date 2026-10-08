/**
 * Hotel (legacy 9510–9632, 11808–11818): tourist tax by age, stay calculation, invoice lines, guest book,
 * tourist-tax and occupancy reports.
 *
 * Config (legacy `firm.hot`, FIX 10.4 item 7: stored as `settings.industry.hotel`): tax per person/night, free / half
 * age limits, accommodation VAT rate, revenue and tourist-tax kontos, invoice payer mode.
 */
import { addDays, ageAt, dayDiff, daysInMonth, net4, num, r2, r4, type ModuleInvoiceLine } from './common';

export interface HotelConfig {
  tax: number;
  /** Children under this age pay no tax ('' = none). */
  freeAge: number | '';
  /** Children under this age pay 50% ('' = none). */
  halfAge: number | '';
  rate: number;
  /** Accommodation revenue konto ('' = posting scheme `revService`). */
  revK: string;
  /** Tourist tax liability konto (not VAT turnover — class 2). */
  taxK: string;
  /** '' = common partner "Гости – физички лица (хотел)", 'guest' = one partner per guest. */
  payer: '' | 'guest';
}

/**
 * Legacy `HT()` defaults. FIX (LEGACY-MAP 10.4 item 4): revK was the literal '7400'; empty now means the firm's
 * posting scheme (`revService`), resolved by the invoice service.
 */
export const HOTEL_DEFAULTS: HotelConfig = { tax: 40, freeAge: '', halfAge: '', rate: 5, revK: '', taxK: '2399', payer: '' };
export const hotelConfig = (o: Partial<HotelConfig> | null | undefined): HotelConfig => ({ ...HOTEL_DEFAULTS, ...(o ?? {}) });

/**
 * Statuses (legacy `HT_ST`). FIX (LEGACY-MAP 10.4 item 11): the dashboard filtered a `noshow` status that `HT_ST`
 * never defined — it is a real status here (set from the reservation when the guest does not arrive).
 */
export const HOTEL_STATUS = {
  resv: ['резервација', 'info', '#cfe0ff'], in: ['во хотел', 'warn', '#ffd9a8'], out: ['одјавен', 'good', '#cfeedd'],
  noshow: ['не дојде', 'bad', '#f6c9c9'], cancel: ['откажана', '', '#eee'],
} as const;
export type HotelStatus = keyof typeof HOTEL_STATUS;
export const BOARD = { RO: 'само ноќевање', BB: 'ноќевање со појадок', HB: 'полупансион', FB: 'полн пансион' } as const;

export interface HotelGuest { name: string; birth?: string; nat?: string; doc?: string; docNo?: string; sex?: string; police?: string }
export interface HotelCharge { date: string; name: string; itemId?: string | null; qty: number; price: number; rate: number; konto?: string | null }
export interface HotelStay {
  from: string; to: string; price: number | string | null; adults: number; children: number;
  guests?: readonly HotelGuest[]; charges?: readonly HotelCharge[]; noTax?: boolean; advance?: number | string | null; board?: string | null;
}

export const htNights = (r: Pick<HotelStay, 'from' | 'to'>) => Math.max(0, dayDiff(r.from, r.to));

/** Legacy `htTaxUnits`: taxable persons (children free / half by age at arrival). */
export function htTaxUnits(r: HotelStay, c: HotelConfig): { units: number; n: number; free: number; half: number } {
  const G = (r.guests ?? []).filter((g) => g.name);
  if (!G.length) {
    const adults = num(r.adults) || 1;
    return { units: adults + (c.freeAge === '' ? num(r.children) : 0), n: adults + num(r.children), free: 0, half: 0 };
  }
  let u = 0, fr = 0, hf = 0;
  for (const g of G) {
    const a = ageAt(g.birth, r.from);
    if (a != null && c.freeAge !== '' && a < num(c.freeAge)) { fr++; continue; }
    if (a != null && c.halfAge !== '' && a < num(c.halfAge)) { hf++; u += 0.5; continue; }
    u += 1;
  }
  return { units: u, n: G.length, free: fr, half: hf };
}

/** Legacy `htCalc`: accommodation (gross), charges (gross), tourist tax, total, advance and rest. */
export function htCalc(r: HotelStay, c: HotelConfig) {
  const n = htNights(r);
  const acc = r2(n * num(r.price));
  const ch = r2((r.charges ?? []).reduce((a, x) => a + num(x.qty) * num(x.price), 0));
  const tu = htTaxUnits(r, c);
  const tax = r.noTax ? 0 : r2(tu.units * n * num(c.tax));
  const adv = num(r.advance);
  return { n, acc, ch, tax, tu, tot: r2(acc + ch + tax), adv, rest: r2(acc + ch + tax - adv) };
}

/** Rooms overlap: [from, to) intervals of the same room. */
export const stayOverlaps = (a: { from: string; to: string }, b: { from: string; to: string }) => a.from < b.to && a.to > b.from;

/**
 * Invoice lines of a stay (legacy `htInv` 9591): nights at the accommodation rate, room charges at their own rates
 * (gross → net), tourist tax at 0% on the tax konto (pass-through, not turnover).
 */
export function hotelInvoiceLines(r: HotelStay, c: HotelConfig, roomNo: string, fmtDate: (d: string) => string): ModuleInvoiceLine[] {
  const k = htCalc(r, c);
  const L: ModuleInvoiceLine[] = [];
  const board = r.board && r.board !== 'RO' ? (BOARD as Record<string, string>)[r.board] ?? '' : '';
  if (k.n) L.push({ name: `Ноќевање ${board ? board + ' ' : ''}– соба ${roomNo}, ${fmtDate(r.from)}–${fmtDate(r.to)}`.replace(/\s+/g, ' '), unit: 'ноќ', qty: k.n, price: net4(num(r.price), c.rate), rate: num(c.rate), account: c.revK || null });
  for (const x of r.charges ?? []) L.push({ itemId: x.itemId || null, name: x.name, unit: 'ком', qty: num(x.qty), price: net4(x.price, x.rate), rate: num(x.rate), account: x.konto || c.revK || null });
  if (k.tax) L.push({ name: `Такса за привремен престој (${k.tu.units} лица × ${k.n} ноќи)`, unit: 'ком', qty: 1, price: k.tax, rate: 0, account: c.taxK });
  return L;
}

/** Net value of the advance (accommodation rate) for the advance invoice (FIX 10.4 item 11). */
export const hotelAdvanceNet = (gross: number, c: HotelConfig) => net4(gross, c.rate);

export interface HotelResRow extends HotelStay { status: string; room: string }

/** Legacy `hotelKniga` tab `tax`: room-nights, persons, free, taxable units and tax per month within [a, b]. */
export function hotelTaxReport(R: readonly HotelResRow[], a: string, b: string, c: HotelConfig) {
  const by: Record<string, { n: number; per: number; units: number; free: number; amt: number }> = {};
  for (const r of R.filter((x) => x.status === 'in' || x.status === 'out')) {
    const tu = htTaxUnits(r, c);
    for (let d = r.from; d < r.to; d = addDays(d, 1)) {
      if (d < a || d > b) continue;
      const o = (by[d.slice(0, 7)] ??= { n: 0, per: 0, units: 0, free: 0, amt: 0 });
      o.n++; o.per += tu.n;
      o.units += r.noTax ? 0 : tu.units;
      o.free += r.noTax ? tu.n : tu.free;
      o.amt = r2(o.amt + (r.noTax ? 0 : tu.units * num(c.tax)));
    }
  }
  return Object.entries(by).sort(([x], [y]) => x.localeCompare(y)).map(([mo, o]) => ({ mo, ...o, units: r4(o.units) }));
}

/** Legacy `hotelKniga` tab `izv`: sold room-nights, occupancy, net accommodation revenue, ADR, RevPAR per month. */
export function hotelOccupancy(R: readonly HotelResRow[], rooms: number, a: string, b: string, c: HotelConfig) {
  const by: Record<string, { n: number; rev: number }> = {};
  for (const r of R.filter((x) => ['in', 'out', 'resv'].includes(x.status))) {
    for (let d = r.from; d < r.to; d = addDays(d, 1)) {
      if (d < a || d > b) continue;
      const o = (by[d.slice(0, 7)] ??= { n: 0, rev: 0 });
      o.n++;
      o.rev = r2(o.rev + net4(num(r.price), c.rate));
    }
  }
  return Object.entries(by).sort(([x], [y]) => x.localeCompare(y)).map(([mo, o]) => {
    const cap = rooms * daysInMonth(mo);
    return { mo, n: o.n, cap, occ: cap ? Math.round((o.n / cap) * 100) : null, rev: o.rev, adr: o.n ? r2(o.rev / o.n) : null, revpar: cap ? r2(o.rev / cap) : null };
  });
}
