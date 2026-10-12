/**
 * Fiscal device receipts (фискална сметка) built from a POS sale — the data the WISE desktop app sends to the fiscal
 * printer / cash register (window.wiseFiscal, desktop/fiscal). See docs/FISKALNI-APARATI.md.
 *
 * VAT groups on Macedonian fiscal devices: the legal mapping `FISCAL_VAT_GROUPS` (./vat-groups — А = 18 %, Б = 5 %,
 * В = 10 %, Г = exempt / 0 %; a firm that is not a VAT payer sells everything in Г). The device holds the rates; the
 * receipt carries only the letter of the LEGAL mapping — the desktop driver remaps it when the device is programmed
 * differently („Даночни групи на апаратот“).
 * Discounts: the Datecs-family devices refuse negative sale lines, so the POS discount (card / coupon / points) is sent
 * as one percentage over the subtotal; the cash part is "the rest", so device rounding can never block the close.
 */
import { num, r2 } from '../stock/num';
import { FISCAL_VAT_GROUPS, vatGroupFor, type FiscalVatGroups, type VatGroup } from './vat-groups';

export type { VatGroup } from './vat-groups';
export interface FiscalItem { name: string; qty: number; price: number; vat: VatGroup; mk?: boolean }
export interface FiscalReceipt { items: FiscalItem[]; discountPct?: number; payments: { card?: number }; ref?: string }
/** What the device returned for a printed receipt / report (desktop/fiscal driver result). */
export interface FiscalResult {
  ok: boolean; number?: string; time?: string; total?: number; code?: string; error?: string;
  device?: { vendor?: string; model?: string; driver?: string } | null;
}

/** VAT rate (%) → group letter of the fiscal device (legal mapping unless `groups` is given; unknown rate → 0 % group). */
export function vatGroup(rate: number, groups?: FiscalVatGroups | number): VatGroup {
  // `groups` is ignored unless it is a mapping (safe as an Array.map callback, which passes the index)
  return vatGroupFor(num(rate), groups && typeof groups === 'object' ? groups : FISCAL_VAT_GROUPS);
}

/** Item name as the devices accept it: no separators / control characters, at most 32 characters (driver trims more). */
export const fiscalName = (s: string): string => String(s ?? '').replace(/[\u0000-\u001F\u007F;]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 32) || 'Артикл';

/**
 * The fiscal receipt of a POS sale: positive cart lines (negative lines — e.g. legacy discount lines — are folded into
 * the discount), the discount as % of the gross (2 decimals, max 99 %), the card part of the payment.
 */
export function toFiscalReceipt(
  cart: readonly { name: string; qty: number; price: number; rate: number; mk?: boolean }[],
  o: { discount?: number; card?: number | null } = {},
): FiscalReceipt {
  const pos = cart.filter((c) => num(c.qty) > 0 && num(c.price) > 0);
  const neg = r2(cart.filter((c) => !(num(c.qty) > 0 && num(c.price) > 0)).reduce((s, c) => s - num(c.qty) * num(c.price), 0));
  if (!pos.length) throw new Error('Сметката нема ставки за фискалниот апарат.');
  const gross = r2(pos.reduce((s, c) => s + r2(num(c.qty) * num(c.price)), 0));
  const disc = r2(Math.max(0, num(o.discount ?? 0) + Math.max(0, neg)));
  const pct = gross > 0 ? r2((disc / gross) * 100) : 0;
  if (pct > 99) throw new Error('Попустот е поголем од 99 % — фискалниот апарат не може да ја издаде сметката.');
  const r: FiscalReceipt = {
    items: pos.map((c) => ({ name: fiscalName(c.name), qty: num(c.qty), price: r2(num(c.price)), vat: vatGroup(c.rate), ...(c.mk ? { mk: true } : {}) })),
    ...(pct > 0 ? { discountPct: pct } : {}),
    payments: {},
  };
  // the card part never exceeds what the device will total (the % discount may round a cent differently)
  const card = Math.min(fiscalTotal(r), Math.max(0, r2(num(o.card ?? 0))));
  if (card > 0) r.payments = { card };
  return r;
}

/** Total the device will print for a receipt (gross − discount %), rounded to cents. */
export function fiscalTotal(r: FiscalReceipt): number {
  const gross = r2(r.items.reduce((s, x) => s + r2(num(x.qty) * num(x.price)), 0));
  return r2(gross * (1 - num(r.discountPct ?? 0) / 100));
}

/** Validates a device result before it is recorded: only `ok` with a receipt number counts as fiscalised. */
export function fiscalConfirmed(r: unknown): r is FiscalResult & { ok: true; number: string } {
  const x = r as FiscalResult | null;
  return !!x && x.ok === true && typeof x.number === 'string' && /^[0-9A-Za-z\-/]{1,20}$/.test(x.number.trim()) && x.number.trim() !== '0';
}
