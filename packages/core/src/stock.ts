/**
 * Stock & retail domain logic (Phase 7), ported from the final effective legacy definitions — see
 * docs/LEGACY-MAP.md "Phase 7 — Stock & retail" and "Phase 3" (landed costs). Pure: no I/O, no globals.
 *
 * Every function takes the data it needs (a `StockContext` snapshot of moves, items, locations, scheme overrides
 * and levelling documents) and returns values or new documents; persisting them is the caller's job.
 */
export type {
  StockItemType,
  StockItem,
  StockJournalLine,
  StockMoveType,
  StockMove,
  StockLocation,
  LevellingLine,
  LevellingDoc,
  StockScheme,
  StockContext,
} from './stock/types';

export {
  STOCK_SCHEME_DEFAULTS,
  stockScheme,
  whOf,
  locationRow,
  locationKind,
  retailOn,
  retailAccount,
  stockAccountForType,
  cogsAccount,
  stockAccount,
  normalizeLines,
  stockLinesBalanced,
  toLegacyLines,
  fromLegacyLines,
} from './stock/accounts';
export type { RetailAccountKey } from './stock/accounts';

export { itemById, trackedItems, postingRate, retailPrice, priceAt, vatInGross, retailBreakdown, retailPostingSplit } from './stock/retail';
export type { RetailBreakdown } from './stock/retail';

export { stock, stockAt, postOut, postIn, revalueLines, reaverage, issueAccount } from './stock/average';
export type {
  StockBalance,
  StockAtBalance,
  StockAtQuery,
  PostOutArgs,
  PostOutWarning,
  PostOutResult,
  PostInArgs,
  ProductionRecord,
  ReaverageResult,
} from './stock/average';

export { productionLines, transferLines, levellingDiff, levellingEntries, legacyLevellingPosted } from './stock/journal';
export type { TransferLineArgs } from './stock/journal';

export {
  levellingLines,
  nextYearNumber,
  levellingReversal,
  promotionPrice,
  promotionLevellingLines,
  promotionCostFloor,
  postTransfer,
  transferShortages,
} from './stock/levelling';
export type { LevellingDraft, PromotionLine, Promotion, TransferArgs, TransferResult } from './stock/levelling';

export {
  LANDED_COST_SLOTS,
  costVat,
  costsOf,
  stockLineValue,
  allocAuto,
  allocCosts,
  roundPurchase,
  finalizeStockLines,
  calculationRows,
} from './stock/landed';
export type {
  LandedCostSlot,
  CostVatLine,
  LandedCost,
  PurchaseStockLine,
  PurchaseLike,
  AllocMode,
  CostOf,
  Allocation,
  FinalStockLine,
  CalculationRow,
} from './stock/landed';

export { fkAlloc, fkIssuePlan, fkSpread, kdfiDay, kdfiRows, dfiDays, dfiControl } from './stock/fiscal';
export type {
  FkMethod,
  FkLine,
  FkAllocArgs,
  FkAllocResult,
  FkRow,
  FkPlanDay,
  FiscalSalesDay,
  FiscalSales,
  KdfiDay,
  DfiDay,
  DfiLedgerLine,
  DfiOptions,
  DfiControlInput,
  DfiSeverity,
  DfiFinding,
} from './stock/fiscal';
