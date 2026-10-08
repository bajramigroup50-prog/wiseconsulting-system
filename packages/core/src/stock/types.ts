/** Shapes used by the stock module. Field names follow the legacy documents (see docs/LEGACY-MAP.md §7.2). */

export type StockItemType = 'goods' | 'material' | 'product' | 'service' | (string & {});

export interface StockItem {
  id: string;
  name?: string;
  code?: string;
  unit?: string;
  type?: StockItemType;
  /** Net sale price (without VAT). */
  price?: number | string;
  /** VAT rate in percent. Legacy treats a missing rate as 18 in postings and as 0 in `retailP`. */
  rate?: number | string | null;
  /** Retail price incl. VAT per location id. */
  sp?: Record<string, number | string | null | undefined>;
  cost?: number | string;
  /** Raw-material items are not tracked; issues are booked to `rawK` at `costPrice` or `costPct` of the price. */
  rawK?: string;
  costPrice?: number | string;
  costPct?: number | string;
}

/** One balanced-journal line. `debit`/`credit` are non-negative and rounded to cents. */
export interface StockJournalLine {
  account: string;
  debit: number;
  credit: number;
  note?: string;
  partner?: string;
}

export type StockMoveType =
  | 'in'
  | 'sale'
  | 'transfer'
  | 'transfer-in'
  | 'prod-out'
  | 'prod-in'
  | 'mat-out'
  | 'return'
  | 'writeoff'
  | 'popis'
  | 'popis-in'
  | 'supret'
  | 'dispatch'
  | 'use';

/** A stock move. `qty` and `value` are signed: negative = out. There is no stored price (`avg = value / qty`). */
export interface StockMove {
  id: string;
  date: string;
  item: string;
  qty: number;
  value: number;
  type: StockMoveType | (string & {});
  src?: string;
  label?: string;
  /** Location id; missing = the virtual main warehouse `'main'`. */
  wh?: string;
  lines?: StockJournalLine[];
  /** Client-submitted, not yet approved: ignored by every stock computation. */
  pend?: boolean;
  partner?: string;
}

export interface StockLocation {
  id: string;
  kind: 'warehouse' | 'store';
  code?: string;
  name?: string;
  /** Stock account override (goods only for `stockAccount`; always for the retail stock account). */
  konto?: string;
  /** Price-difference (margin) account override. */
  kMarg?: string;
  /** VAT-in-stock account override. */
  kVat?: string;
}

export interface LevellingLine {
  item: string;
  qty: number;
  old: number;
  new: number;
  /** Quantity came from an Excel import rather than from stock. */
  qtyImp?: boolean;
}

/** `docs.type = 'nivel'`. */
export interface LevellingDoc {
  id?: string;
  number?: string;
  date: string;
  wh?: string;
  lines: LevellingLine[];
  note?: string;
  akTo?: string;
  akBack?: string;
}

/** Stock-related posting accounts (legacy `SCH0` keys). Override per firm via `StockContext.scheme`. */
export interface StockScheme {
  stock: string;
  material: string;
  product: string;
  cogs: string;
  cogsP: string;
  /** Stores are kept at retail value (6630 / 6694 / 6640). */
  retailMethod: boolean;
  /** Warehouses are kept at retail value. */
  whSaleMethod: boolean;
  retailStock: string;
  retailMarg: string;
  retailVat: string;
  whStock: string;
  whMarg: string;
  whVat: string;
  /** Production in progress (legacy hard-coded 6000). */
  prodWip: string;
  /** Labour absorbed into production (legacy hard-coded 4900). */
  prodLabour: string;
}

export interface StockContext {
  moves: readonly StockMove[];
  items?: readonly StockItem[];
  /** Warehouse / store rows (`codes` with `cb` warehouse|store). The virtual `'main'` warehouse is implicit. */
  locations?: readonly StockLocation[];
  /** Firm overrides; empty strings and `undefined` fall back to the defaults. */
  scheme?: Partial<StockScheme>;
  /** `nivel` documents, used for the retail price on a date. */
  levellings?: readonly LevellingDoc[];
  /** `firm.ddv`. Default true. A non-VAT firm has no VAT in retail prices. */
  vatRegistered?: boolean;
}
