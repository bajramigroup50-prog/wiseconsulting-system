/**
 * Price calculator (legacy `VIEWS.kalkCalc` 5611): purchase price + landed costs + margin % → net price, VAT and
 * retail price; and the margin of an item's selling price over its unit cost.
 */
import { num, r2 } from '../stock/num';

export interface PriceCalcInput {
  /** Supplier's invoice price without VAT. */
  cost: number | string;
  /** Landed costs (transport, customs). */
  trans?: number | string;
  /** Price difference (margin) in percent of the purchase price. */
  margin?: number | string;
  rate?: number | string;
}

export interface PriceCalc { nab: number; marg: number; net: number; vat: number; retail: number }

/** Legacy `kalkCalc`: `nab = cost + trans`, `marg = nab × m%`, `net = nab + marg`, `vat = net × rate%`. */
export function priceCalc(k: PriceCalcInput): PriceCalc {
  const nab = num(k.cost) + num(k.trans);
  const marg = r2((nab * num(k.margin)) / 100);
  const net = r2(nab + marg);
  const vat = r2((net * num(k.rate)) / 100);
  return { nab: r2(nab), marg, net, vat, retail: r2(net + vat) };
}

/** Margin of a net selling price over a unit cost, in percent (legacy `(price − c) / price × 100`); 0 without a price. */
export const marginPct = (price: number | string | null | undefined, cost: number): number => {
  const p = num(price);
  return p ? r2(((p - cost) / p) * 100) : 0;
};

/** Pill class of a margin (legacy: < 10 bad, < 20 warn, else good). */
export const marginTone = (pct: number): 'bad' | 'warn' | 'good' => (pct < 10 ? 'bad' : pct < 20 ? 'warn' : 'good');
