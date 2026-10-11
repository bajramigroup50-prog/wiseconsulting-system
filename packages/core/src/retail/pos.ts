/**
 * Фискална каса (legacy `VIEWS.kasa` 5680 + the loyalty wrapper 9937–9942, `ACT.posFile` 7229, `itemByCode` 4167):
 * barcode / code lookup at the till, the discount split into negative lines per VAT rate, the receipt file for the
 * fiscal-printer software (.inp) and the till's Z-list columns.
 */
import { num, r2, r4 } from '../stock/num';

export interface PosCartLine { itemId: string; name?: string; qty: number; price: number; rate: number }

/** Legacy `itemByCode`: an active item by barcode (main or extra), else by code (case-insensitive). */
export function itemByCode<I extends { code?: string | null; barcodes?: readonly string[] | null; active?: boolean | null }>(items: readonly I[], v: string): I | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const lv = s.toLowerCase();
  const A = items.filter((i) => i.active !== false);
  return A.find((i) => (i.barcodes ?? []).map(String).includes(s)) ?? A.find((i) => String(i.code ?? '').toLowerCase() === lv) ?? null;
}

/** Scanned item into the cart: an existing line of the item gets the quantity added (legacy `posBc` Enter). */
export function cartScan<L extends { itemId: string; qty: number }>(cart: readonly L[], line: L): L[] {
  const k = cart.findIndex((c) => c.itemId === line.itemId);
  if (k < 0) return [...cart, line];
  return cart.map((c, i) => (i === k ? { ...c, qty: r4(num(c.qty) + num(line.qty)) } : c));
}

/** Cart total incl. VAT (legacy `d.cart.reduce(qty*price)`, rounded to cents). */
export const cartTotal = (cart: readonly { qty: number; price: number }[]): number => r2(cart.reduce((s, c) => s + num(c.qty) * num(c.price), 0));

/**
 * Legacy `posSell` wrapper 9940: the discount is spread over the VAT rates of the cart in proportion to their gross
 * (rates in ascending numeric order — JS object key order), the last rate takes the rounding rest; each part is a
 * line `qty 1 × −amount` named „Попуст (…)“ without an item.
 */
export function posDiscountLines(cart: readonly { qty: number; price: number; rate: number }[], disc: number, parts: readonly string[]): PosCartLine[] {
  const tot = cart.reduce((s, c) => s + num(c.qty) * num(c.price), 0);
  if (!(disc > 0) || !tot) return [];
  const by = new Map<number, number>();
  for (const c of cart) by.set(num(c.rate), (by.get(num(c.rate)) ?? 0) + num(c.qty) * num(c.price));
  const R = [...by.keys()].sort((a, b) => a - b);
  const name = 'Попуст (' + parts.join(', ') + ')';
  const out: PosCartLine[] = [];
  let left = disc;
  R.forEach((r, i) => {
    const a = i === R.length - 1 ? r2(left) : r2((disc * by.get(r)!) / tot);
    left = r2(left - a);
    if (a) out.push({ itemId: '', name, qty: 1, price: -a, rate: r });
  });
  return out;
}

/** VAT group number of the fiscal printer file: 18 % → 1, 5 % → 2, 10 % → 3, other → 4. */
export const inpGroup = (rate: number): number => (rate === 18 ? 1 : rate === 10 ? 3 : rate === 5 ? 2 : 4);

/** Legacy `ACT.posFile`: the receipt as an `.inp` file for the fiscal printer software (CRLF lines). */
export function fiscalInpFile(cart: readonly { name: string; qty: number; price: number; rate: number }[]): string {
  return cart.map((x) => `S,1,______,_,__;${String(x.name).slice(0, 32)};${num(x.price).toFixed(2)};${num(x.qty).toFixed(3)};${inpGroup(num(x.rate))};1;0;0;0`).join('\r\n') + '\r\nT,1,______,_,__;0;;;;;';
}

/** Legacy Z list of the till (5693): base and VAT summed over the VAT groups of the day. */
export function zBaseVat(groups: readonly { base: number; vat: number }[]): { base: number; vat: number } {
  return { base: r2(groups.reduce((a, g) => a + num(g.base), 0)), vat: r2(groups.reduce((a, g) => a + num(g.vat), 0)) };
}
