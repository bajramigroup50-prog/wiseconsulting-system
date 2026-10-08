/**
 * Journal lines for stock documents that legacy posts outside `postOut`: transfers, levelling, production.
 * Every builder returns balanced `{account, debit, credit}` lines (cents) or `[]`.
 */
import type { LevellingDoc, StockContext, StockItem, StockJournalLine, StockScheme } from './types';
import { num, r2 } from './num';
import { locationKind, normalizeLines, retailAccount, retailOn, stockAccount, whOf } from './accounts';
import { itemById, postingRate } from './retail';

/**
 * Production receipt (legacy `runProd` 5669 / `reaverage` 5108): D product / C production-in-progress for the
 * total cost, preceded by D in-progress / C labour for the labour part.
 * DELIBERATE FIX: accounts come from the scheme (`product`, `prodWip`, `prodLabour`) instead of hard-coded 6300/6000/4900.
 */
export function productionLines(sch: Pick<StockScheme, 'product' | 'prodWip' | 'prodLabour'>, total: number, labour: number): StockJournalLine[] {
  const lines: StockJournalLine[] = [
    { account: sch.product, debit: total, credit: 0 },
    { account: sch.prodWip, debit: 0, credit: total },
  ];
  if (labour) lines.unshift({ account: sch.prodWip, debit: labour, credit: 0 }, { account: sch.prodLabour, debit: 0, credit: labour });
  return lines;
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
  const fromK = stockAccount(ctx, a.from, a.item);
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
