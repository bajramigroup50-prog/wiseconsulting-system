/**
 * Journal lines for stock documents that legacy posts outside `postOut`: transfers, levelling, production.
 * Every builder returns balanced `{account, debit, credit}` lines (cents) or `[]`.
 */
import type { LevellingDoc, StockContext, StockItem, StockJournalLine, StockScheme } from './types';
import { num, r2 } from './num';
import { locationKind, normalizeLines, retailAccount, retailOn, stockAccount, stockAccountForType, whOf } from './accounts';
import { itemById, postingRate, priceAt } from './retail';

/**
 * Production receipt (legacy `runProd` 5669 / `reaverage` 5108), Macedonian chart practice (costs by nature):
 *   1. the materials were issued as a cost by nature: D prodMat 4000 / C stock (the `prod-out` moves, see `runProduction`);
 *   2. every cost of the order (materials + labour / other / overhead) is transferred into production:
 *      D prodWip 6000 / C prodLabour 4900 „Распоред на директни трошоци на производи“;
 *   3. the finished product is received: D product 6300 / C prodWip 6000.
 * At the year close 4000 (debit) and 4900 (credit) both go to 8000; the ЦРМ income statement (by nature) shows 4000
 * in AOP 208 and the stock change of 60/63 in AOP 204/205, while 49 and 700 stay out of it (see `ZS_BY_NATURE_SKIP`),
 * so the income statement equals the ledger result and the balance sheet balances.
 *
 * FIX (production firm could not close its year): legacy posted D 6000 / C 3100 for the materials and only the labour
 * to 4900. The materials never reached class 4, so the ЦРМ income statement (by nature + stock change) differed from
 * the ledger by the materials value and АОП 063 ≠ АОП 111.
 * `labour` is kept for the callers' signature; the transfer is always the total.
 */
export function productionLines(sch: Pick<StockScheme, 'product' | 'prodWip' | 'prodLabour'>, total: number, _labour?: number): StockJournalLine[] {
  return [
    { account: sch.prodWip, debit: total, credit: 0 },
    { account: sch.prodLabour, debit: 0, credit: total },
    { account: sch.product, debit: total, credit: 0 },
    { account: sch.prodWip, debit: 0, credit: total },
  ];
}

export interface TransferLineArgs {
  item: StockItem;
  qty: number;
  /** Retail unit price incl. VAT at the destination. */
  retailUnitPrice: number;
  /** Cost value moved out of the source location. */
  cost: number;
  from: string;
  to: string;
}

/**
 * Journal lines for the receiving side of a transfer (legacy `prnLines`, index.html 17414):
 * into a retail-value location D retail stock (retail value incl. VAT) / C source stock (cost) / C margin / C VAT.
 *
 * DELIBERATE FIXES (LEGACY-MAP §7.4 items 4–5):
 * - one predicate for "kept at retail value" (`retailOn`) for issues, transfers and levelling. Legacy posted
 *   transfers into ANY store but sold out of stores at retail value only when `retailMethod` was on, so with the
 *   defaults 6630 was debited by transfers and never cleared by sales.
 * - accounts resolve like `postOut` (location override → scheme), so the margin account is the same 6694 for
 *   sales, transfers and levelling (legacy `prnKonta` read `firm.sch` raw and defaulted to 6690).
 * - transfers between cost-value locations with different stock accounts post D destination / C source at cost
 *   (legacy posted nothing).
 * - VAT follows `vatRegistered` in every path.
 */
export function transferLines(ctx: StockContext, a: TransferLineArgs): StockJournalLine[] {
  const fromK = transferCostAccount(ctx, a.from, a.to, a.item);
  const val = r2(a.cost);
  if (retailOn(ctx, a.to)) {
    const rv = r2(num(a.qty) * num(a.retailUnitPrice));
    const rate = postingRate(ctx, a.item);
    const vt = rate ? r2((rv * rate) / (100 + rate)) : 0;
    return normalizeLines([
      { account: retailAccount(ctx, a.to, 'Stock'), debit: rv, credit: 0 },
      { account: fromK, debit: 0, credit: val },
      { account: retailAccount(ctx, a.to, 'Marg'), debit: 0, credit: r2(rv - vt - val) },
      { account: retailAccount(ctx, a.to, 'Vat'), debit: 0, credit: vt },
    ]);
  }
  const toK = stockAccount(ctx, a.to, a.item);
  if (toK !== fromK)
    return normalizeLines([
      { account: toK, debit: val, credit: 0 },
      { account: fromK, debit: 0, credit: val },
    ]);
  return [];
}

/** Is the issuing side of a transfer out of a location kept at retail value (goods, like `postOut`)? */
const retailSource = (ctx: StockContext, from: string, item: Pick<StockItem, 'type'>): boolean => retailOn(ctx, from) && item.type === 'goods';

/**
 * The account the cost of a transfer moves through: the source's stock account at cost; out of a store kept at retail
 * value (whose stock account is the retail one) the receiving side's stock account at cost, or — into another store
 * kept at retail value — the cost stock account of the item type (debited by the issue, credited by the receipt).
 */
export function transferCostAccount(ctx: StockContext, from: string, to: string, item: StockItem): string {
  if (!retailSource(ctx, from, item)) return stockAccount(ctx, from, item);
  return retailOn(ctx, to) ? stockAccountForType(ctx, item.type) || '6600' : stockAccount(ctx, to, item);
}

/**
 * Journal lines of the issuing side of a transfer out of a location kept at retail value (posted like a retail issue):
 * D cost (`transferCostAccount`) / D margin / D embedded VAT, C retail stock at the retail value of the date. `[]` when
 * the source is kept at cost (the receiving side's `transferLines` carry the whole entry).
 *
 * FIX: a transfer out of a store kept at retail value never cleared 6630 / 6694 / 6640 — the issue had no lines and
 * the receipt credited the cost stock account 6600, which the store never had.
 */
export function transferOutLines(ctx: StockContext, a: TransferLineArgs & { date: string }): StockJournalLine[] {
  if (!retailSource(ctx, a.from, a.item)) return [];
  const rv = r2(num(a.qty) * priceAt(ctx, a.item, a.from, a.date));
  const rate = postingRate(ctx, a.item);
  const vt = rate ? r2((rv * rate) / (100 + rate)) : 0;
  const val = r2(a.cost);
  return normalizeLines([
    { account: transferCostAccount(ctx, a.from, a.to, a.item), debit: val, credit: 0 },
    { account: retailAccount(ctx, a.from, 'Marg'), debit: r2(rv - vt - val), credit: 0 },
    { account: retailAccount(ctx, a.from, 'Vat'), debit: vt, credit: 0 },
    { account: retailAccount(ctx, a.from, 'Stock'), debit: 0, credit: rv },
  ]);
}

/** Total retail difference of a levelling: Σ qty × (new − old), cents. */
export function levellingDiff(lines: LevellingDoc['lines']): number {
  return r2(lines.reduce((s, l) => s + num(l.qty) * (num(l.new) - num(l.old)), 0));
}

/**
 * Journal lines of a levelling (legacy `ledger()` nivel block, index.html 3461):
 * D retail stock Σ qty·(new−old) / C margin (difference without VAT) / C VAT contained in the difference;
 * a price cut posts the mirror image.
 *
 * DELIBERATE FIX: posted only where the location is kept at retail value (`retailOn`) and with the same accounts as
 * sales and transfers (see `transferLines`). Legacy also posted every store levelling to 6630/6690 when the store was
 * kept at cost, while its sales were credited to 6600.
 */
export function levellingEntries(ctx: StockContext, doc: LevellingDoc): StockJournalLine[] {
  const W = whOf(doc);
  if (!retailOn(ctx, W)) return [];
  let a = 0;
  let v = 0;
  for (const l of doc.lines ?? []) {
    const it = itemById(ctx, l.item) ?? ({ id: l.item } as StockItem);
    const rate = postingRate(ctx, it);
    const dd = num(l.qty) * (num(l.new) - num(l.old));
    a += dd;
    v += rate ? (dd * rate) / (100 + rate) : 0;
  }
  a = r2(a);
  v = r2(v);
  if (!a) return [];
  return normalizeLines([
    { account: retailAccount(ctx, W, 'Stock'), debit: a, credit: 0 },
    { account: retailAccount(ctx, W, 'Marg'), debit: 0, credit: r2(a - v) },
    { account: retailAccount(ctx, W, 'Vat'), debit: 0, credit: v },
  ]);
}

/** Legacy predicate (for reference/migration): legacy posted a levelling when `retailOn(wh) || kind === 'store'`. */
export const legacyLevellingPosted = (ctx: StockContext, wh: string | undefined): boolean =>
  retailOn(ctx, wh) || locationKind(ctx, wh) === 'store';
