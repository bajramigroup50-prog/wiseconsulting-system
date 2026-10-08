/**
 * Travel agency (legacy 11844–11999): arrangements (own = tour operator, agent = intermediary), bookings, payments,
 * arrangement result, the inputs of the travel-margin VAT (чл. 38 ЗДДВ, `@wise/core` `travelMarginFor`), invoice lines.
 *
 * The VAT itself is computed by Phase 5 (`ddvFor` with `{ travel: { arrangements, agg } }`): this module only supplies
 * `{ rev, cost, own }` per arrangement ({@link arrangementVatTotals}) and marks margin-scheme invoices (`tourM`,
 * `arrangementId`).
 */
import { TRAVEL_MARGIN_RATE } from '../data/vat';
import type { TravelArrangementTotals } from '../vat';
import { net4, num, r2, type ModuleInvoiceLine } from './common';

export interface TravelConfig {
  /** Margin basis (чл. 38 ст. 3): whole period or per arrangement. */
  agg: 'period' | 'arr';
  /** Revenue konto ('' = posting scheme `revService`). */
  revK: string;
  /** Advances from travellers ('' = posting scheme `advance`). */
  advK: string;
  /** Collections on behalf of the provider (intermediary). */
  passKonto: string;
  /** Default commission % (intermediary). */
  comm: number;
  lic: string; guar: string; terms: string;
}
/** FIX (LEGACY-MAP 10.4 items 4 and 16): kontos fall back to the scheme; terms are editable reference text. */
export const TRAVEL_TERMS_DEFAULT = '1. Пријавата е важечка по уплата на аванс од 30% од цената.\n2. Остатокот се уплаќа најдоцна 14 дена пред поаѓањето.\n3. Откажување од страна на патникот: до 30 дена пред поаѓање – 10%, 29–15 дена – 30%, 14–8 дена – 50%, 7–0 дена или непојавување – 100% од цената.\n4. Агенцијата го задржува правото да го откаже патувањето ако не се пополни минималниот број патници, со целосно враќање на уплатата.\n5. Патникот е одговорен за валидноста на патната исправа и визите.\n6. Приговорите се поднесуваат писмено во рок од 8 дена по завршувањето на патувањето.';
export const TRAVEL_DEFAULTS: TravelConfig = { agg: 'period', revK: '', advK: '', passKonto: '2290', comm: 10, lic: '', guar: '', terms: TRAVEL_TERMS_DEFAULT };
export const travelConfig = (o: Partial<TravelConfig> | null | undefined): TravelConfig => ({ ...TRAVEL_DEFAULTS, ...(o ?? {}) });

export const ARRANGEMENT_STATUS = { open: ['отворен за пријави', 'info'], full: ['пополнет', 'warn'], done: ['реализиран', 'good'], cancel: ['откажан', ''] } as const;
export const TA_OWN = 'Сопствена услуга на агенцијата (не е претходна)';
export const TA_CATEGORIES = ['Сместување (хотел)', 'Превоз (авион)', 'Превоз (автобус)', 'Трансфер', 'Водич', 'Влезници / излети', 'Визи', 'Патничко осигурување', 'Друго', TA_OWN] as const;

export interface ArrangementCost { cat: string; who?: string; desc?: string; amt?: number | string; cur?: string; fx?: number | string; purchaseId?: string | null }
export interface Arrangement { id: string; kind: 'own' | 'agent'; price?: number | string | null; priceCh?: number | string | null; comm?: number | string | null; seats?: number | string | null; costs: readonly ArrangementCost[] }
export interface BookingPay { date: string; amt: number; how: string; voucherId?: string | null; no?: string | null }
export interface Booking {
  adults?: number | string | null; children?: number | string | null; extra?: number | string | null; disc?: number | string | null;
  priceTot?: number | string | null; pax?: readonly { name?: string }[]; pays?: readonly BookingPay[]; status?: string;
}

const set = (v: unknown) => v !== '' && v != null;

/** Legacy `tbTot`: agreed total, else adults × price + children × child price + extra − discount. */
export const bookingTotal = (b: Booking, A: Pick<Arrangement, 'price' | 'priceCh'>): number =>
  set(b.priceTot) ? r2(num(b.priceTot)) : r2(num(b.adults) * num(A.price) + num(b.children) * (num(A.priceCh) || num(A.price)) + num(b.extra) - num(b.disc));
export const bookingPaid = (b: Booking): number => r2((b.pays ?? []).reduce((s, p) => s + num(p.amt), 0));
export const bookingPax = (b: Booking): number => Math.max(num(b.adults) + num(b.children), (b.pax ?? []).filter((p) => p.name).length);

/** Legacy `taOwn`: own services (not prior travel services) in MKD. */
export const arrangementOwn = (A: Pick<Arrangement, 'costs'>): number =>
  r2(A.costs.filter((c) => c.cat === TA_OWN).reduce((s, c) => s + num(c.amt) * (num(c.fx) || 1), 0));

/**
 * Legacy `taCost`: prior travel services in MKD — manual cost lines, or the linked purchase's total when a cost line
 * points to a purchase (`purchaseTotal(id)`, MKD incl. VAT, because their VAT is not deductible).
 */
export const arrangementCost = (A: Pick<Arrangement, 'costs'>, purchaseTotal: (id: string) => number | undefined): number =>
  r2(A.costs.filter((c) => c.cat !== TA_OWN).reduce((s, c) => {
    const p = c.purchaseId ? purchaseTotal(c.purchaseId) : undefined;
    return s + (p ?? num(c.amt) * (num(c.fx) || 1));
  }, 0));

/** Legacy `taCalc`: revenue, payments, passengers, costs, margin and VAT of an arrangement. */
export function arrangementResult(A: Arrangement, B: readonly Booking[], purchaseTotal: (id: string) => number | undefined, cfg: TravelConfig, vatRegistered: boolean) {
  const L = B.filter((b) => b.status !== 'cancel');
  const rev = r2(L.reduce((s, b) => s + bookingTotal(b, A), 0));
  const paid = r2(L.reduce((s, b) => s + bookingPaid(b), 0));
  const pax = L.reduce((s, b) => s + bookingPax(b), 0);
  const fill = num(A.seats) ? Math.round((pax / num(A.seats)) * 100) : null;
  const k = TRAVEL_MARGIN_RATE / (100 + TRAVEL_MARGIN_RATE);
  if (A.kind === 'agent') {
    const comm = r2((rev * (num(A.comm) || num(cfg.comm))) / 100);
    const vat = vatRegistered ? r2(comm * k) : 0;
    return { rev, paid, pax, fill, cost: r2(rev - comm), own: 0, margin: comm, vatM: vat, vatO: 0, vat, net: r2(comm - vat) };
  }
  const cost = arrangementCost(A, purchaseTotal);
  const own = Math.min(arrangementOwn(A), rev);
  const margin = r2(rev - cost - own);
  const vatM = vatRegistered && margin > 0 ? r2(margin * k) : 0;
  const vatO = vatRegistered ? r2(own * k) : 0;
  const vat = r2(vatM + vatO);
  return { rev, paid, pax, fill, cost, own, margin, vatM, vatO, vat, net: r2(margin + own - vat) };
}

/**
 * The Phase 5 travel-margin input of one own arrangement: `{ rev, cost, own }` (legacy `taCalc` fields used by
 * `tuMarginFor`). Intermediary arrangements are not under the margin scheme (their invoices carry VAT on the
 * commission), so they return null.
 */
export function arrangementVatTotals(A: Arrangement, B: readonly Booking[], purchaseTotal: (id: string) => number | undefined, cfg: TravelConfig): TravelArrangementTotals | null {
  if (A.kind === 'agent') return null;
  const R = arrangementResult(A, B, purchaseTotal, cfg, true);
  return { rev: R.rev, cost: R.cost, own: R.own };
}

/**
 * Invoice of a booking (legacy `tbInv` 11946).
 * - own arrangement: one line at the gross price, rate 0, `tourM: true` + `arrangementId` (VAT on the margin is
 *   computed per period by Phase 5 and booked with the travel-VAT journal);
 * - intermediary: the commission with 18% VAT (gross → net) and the rest on the pass-through konto at 0%.
 * FIX (LEGACY-MAP 10.4 item 5): the 18% is the statutory margin rate constant, not a literal.
 */
export function bookingInvoice(b: Booking, A: Arrangement & { code?: string | null; name?: string | null; dest?: string | null; from?: string | null; to?: string | null }, cfg: TravelConfig, fmtDate: (d: string) => string):
  { lines: ModuleInvoiceLine[]; tourM: boolean; note: string } {
  const t = bookingTotal(b, A);
  const nm = `Туристички аранжман ${A.code ?? ''} ${A.name ?? ''} (${fmtDate(A.from ?? '')} – ${fmtDate(A.to ?? '')}), ${bookingPax(b)} патници`.replace(/\s+/g, ' ');
  if (A.kind === 'agent') {
    const comm = r2((t * (num(A.comm) || num(cfg.comm))) / 100);
    return {
      tourM: false, note: '',
      lines: [
        { name: 'Провизија за посредување – ' + nm, unit: 'ком', qty: 1, price: net4(comm, TRAVEL_MARGIN_RATE), rate: TRAVEL_MARGIN_RATE, account: cfg.revK || null },
        { name: 'Наплата за сметка на давателот на услугата – ' + (A.dest ?? ''), unit: 'ком', qty: 1, price: r2(t - comm), rate: 0, account: cfg.passKonto },
      ],
    };
  }
  return {
    tourM: true,
    note: 'Посебна постапка за оданочување на туристички агенции (чл. 38 од Законот за ДДВ) – ДДВ не се искажува.',
    lines: [{ name: nm, unit: 'ком', qty: 1, price: t, rate: 0, account: cfg.revK || null }],
  };
}
