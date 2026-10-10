/**
 * Schema — Phase 3 "sales & purchases": outgoing documents (invoice, credit note, proforma, dispatch note, advance
 * invoice), purchases with VAT groups / stock lines / landed costs, supplier returns & credits. Stock movements go to
 * Phase 7's `stock_moves` through `replaceSourceMoves` (source types `purchase`, `invoice`, `dispatch`, `supplier_credit`).
 *
 * Documents are saved and posted in one transaction by `src/sales/*.ts` through the posting service; their journals
 * are found by (`source_type`, `source_id`): `invoice`, `purchase`, `supplier_credit`; cost of goods sold / returned is the
 * stock journal `stock:invoice` / `stock:dispatch` posted by `replaceSourceMoves`.
 *
 * Status: `posted` (booked), `pending` (entered by a klient-role user, not booked until the office approves it),
 * `draft` (never booked — proformas).
 *
 * FIX (LEGACY-MAP 3.4 item 14): legacy persisted transient UI fields (`fuelOk`, `calcAuto`, `autoShift`, `lateOk`,
 * `_scan`, `_newSup`, `auto`…). Here every stored field is an explicit column or a documented `data` key; the editors
 * keep their transient state client-side.
 */
import { sql } from 'drizzle-orm';
import {
  bigserial, boolean, check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';
import { codes, items, partners } from './books';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date());
const money = (name: string) => numeric(name, { precision: 18, scale: 2 });
const qty = (name: string) => numeric(name, { precision: 18, scale: 4 });
const unitPrice = (name: string) => numeric(name, { precision: 18, scale: 4 });

export const DOC_STATUSES = ['draft', 'posted', 'pending'] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];
export type InvoiceKind = 'invoice' | 'credit' | 'proforma' | 'dispatch';

/* ---------------- Outgoing documents ---------------- */

/** Header fields without their own column (legacy `data-if` fields of `invHeader`, 4077–4139). */
/** State of the production made from a sales invoice: the plan (materials per produced line) and the orders made. */
export interface InvoiceProdState {
  wh: string | null; extra: number; saveBom: boolean; mat: number;
  lines: { lineNo: number; productId: string; qty: number; materials: { itemId: string; qty: number }[] }[];
  orders: { id: string; number: string; productId: string; lineNo: number; mat: number; lab: number }[];
}

export interface InvoiceData {
  oe?: string; payerId?: string; days?: string; refDoc?: string; dispNo?: string; archNo?: string; priceList?: string;
  icd?: string; decl?: string; distrib?: string; gdisc?: string; payMethod?: string; salePlace?: string; city?: string;
  workOrder?: string; prio?: string; attachNote?: string; saldo?: string; prod?: string; prodCost?: string;
  grp1?: string; grp2?: string; costType?: string; placeFrom?: string; placeTo?: string; domestic?: string; repro?: string;
  parity?: string; pay1?: string; pay2?: string; pay3?: string; carrierId?: string; trailer?: string; loadDate?: string;
  unloadDate?: string; dAddr?: string; loadPlace?: string; vehicle?: string; driver?: string;
  /** Production run from the invoice („Производство = Да“, `sales/invoice-production.ts`). */
  prodRun?: InvoiceProdState;
  /** Buyer as read from a scanned sales invoice (before a partner is chosen). */
  buyer?: { name: string; edb: string; address: string; city: string };
  /** Phase 10 travel agency: margin scheme (чл. 38) — maps to core `InvoiceDoc.tourM` / `arrangementId` for the VAT source. */
  tourM?: boolean;
  arrangementId?: string;
  /** Phase 10: industry document the invoice was issued from (`hotel_reservation`, `rent_rental`, `travel_booking`, …). */
  source?: { type: string; id: string };
}

/**
 * Invoices, credit notes (`kind = 'credit'`, `ref_invoice_id`), proformas and dispatch notes (legacy `invoices` +
 * `docs` of type proforma/dispatch). Item prices are in `currency`; posting converts with `fx`.
 */
export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'restrict' }),
  legacyId: text('legacy_id'),
  kind: text('kind').$type<InvoiceKind>().notNull(),
  status: text('status').$type<DocStatus>().notNull().default('posted'),
  number: text('number').notNull(),
  date: date('date').notNull(),
  /** Tax point / delivery date (датум на промет). */
  pdate: date('pdate'),
  due: date('due'),
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
  /** Issued from warehouse/store (null = main warehouse). */
  warehouseId: uuid('warehouse_id').references(() => codes.id, { onDelete: 'restrict' }),
  art32: boolean('art32').notNull().default(false),
  /** Advance invoice (авансна). */
  advance: boolean('advance').notNull().default(false),
  export: boolean('export').notNull().default(false),
  /** Written in service mode (free-text services) → listed under Услуги. */
  svc: boolean('svc').notNull().default(false),
  currency: text('currency').notNull().default('MKD'),
  fx: numeric('fx', { precision: 18, scale: 6 }).notNull().default('1'),
  /** Credit note → the invoice it corrects. */
  refInvoiceId: uuid('ref_invoice_id').references((): AnyPgColumn => invoices.id, { onDelete: 'restrict' }),
  /** Credit note kind: `price` (по ставки), `gross` (бруто износ), `ret` (повратница — goods back to stock). */
  creditKind: text('credit_kind').$type<'price' | 'gross' | 'ret'>(),
  creditGross: money('credit_gross'),
  /** Invoice made from a proforma / dispatch note (`toInvoice`). */
  fromDocId: uuid('from_doc_id').references((): AnyPgColumn => invoices.id, { onDelete: 'set null' }),
  /** Proforma / dispatch → the invoice it was converted into. */
  invoicedId: uuid('invoiced_id').references((): AnyPgColumn => invoices.id, { onDelete: 'set null' }),
  note: text('note'),
  /** Totals in document currency (cache for lists; recomputed on every save). */
  base: money('base').notNull().default('0'),
  vat: money('vat').notNull().default('0'),
  total: money('total').notNull().default('0'),
  scanned: boolean('scanned').notNull().default(false),
  data: jsonb('data').$type<InvoiceData>().notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  approvedAt: ts('approved_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('invoices_firm_date_idx').on(t.firmId, t.date),
  index('invoices_firm_kind_idx').on(t.firmId, t.kind),
  index('invoices_ref_idx').on(t.refInvoiceId),
  index('invoices_partner_idx').on(t.firmId, t.partnerId),
  // Service invoices share the invoice sequence (`kind = 'invoice'`), so one number per kind and year.
  uniqueIndex('invoices_number_uq').on(t.firmId, t.kind, sql`(extract(year from ${t.date}))`, t.number),
  check('invoices_kind_chk', sql`${t.kind} in ('invoice','credit','proforma','dispatch')`),
  check('invoices_status_chk', sql`${t.status} in ('draft','posted','pending')`),
]);

export const invoiceLines = pgTable('invoice_lines', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  lineNo: integer('line_no').notNull(),
  itemId: uuid('item_id').references(() => items.id, { onDelete: 'restrict' }),
  code: text('code'),
  name: text('name').notNull(),
  unit: text('unit'),
  qty: qty('qty').notNull(),
  /** Net unit price in document currency. */
  price: unitPrice('price').notNull(),
  disc: numeric('disc', { precision: 8, scale: 4 }).notNull().default('0'),
  rate: integer('rate').notNull(),
  /** Revenue konto. */
  account: text('account').notNull(),
}, (t) => [index('invoice_lines_invoice_idx').on(t.invoiceId), index('invoice_lines_item_idx').on(t.itemId)]);

/** Advance invoices deducted on a final invoice (legacy `advances = {advInvId: base}`). */
export const invoiceAdvances = pgTable('invoice_advances', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  advanceId: uuid('advance_id').notNull().references(() => invoices.id, { onDelete: 'restrict' }),
  /** Base amount (without VAT) used on this invoice. */
  amount: money('amount').notNull(),
}, (t) => [uniqueIndex('invoice_advances_uq').on(t.invoiceId, t.advanceId), index('invoice_advances_adv_idx').on(t.advanceId)]);

/* ---------------- Purchases ---------------- */

/** Header fields without their own column (legacy `data-pf` fields of `purHeader`). */
export interface PurchaseData {
  oe?: string; terk?: string; extraCost?: string; rabReg?: string; rabQty?: string; rabSez?: string; days?: string;
  retNo?: string; distrib?: string; odobr?: string; evKurs?: string; evCur?: string; saldo?: string; memo?: string;
  fxAmt?: string; fxMark?: string; ecd?: string; grp1?: string; grp2?: string; costType?: string; driver?: string;
  truck?: string; trailer?: string; withVat?: boolean;
}

export const purchases = pgTable('purchases', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'restrict' }),
  legacyId: text('legacy_id'),
  status: text('status').$type<DocStatus>().notNull().default('posted'),
  /** Supplier's invoice number. */
  number: text('number').notNull().default(''),
  /** Booking (receipt) date. */
  date: date('date').notNull(),
  /** Date printed on the document (differs when the VAT period was already closed). */
  docDate: date('doc_date'),
  due: date('due'),
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
  supplierName: text('supplier_name'),
  supplierEdb: text('supplier_edb'),
  /** `stock` (приемница / калкулација) or `cost` (direct cost, no items). */
  ptype: text('ptype').$type<'stock' | 'cost'>().notNull().default('cost'),
  art32: boolean('art32').notNull().default(false),
  /** Import (увозна, девизна): VAT on import kontos, supplier on `supplier_account`. */
  imp: boolean('imp').notNull().default(false),
  /** Paid in cash (fiscal receipt). */
  cash: boolean('cash').notNull().default(false),
  /** No input-VAT deduction (travel prior services). */
  noDed: boolean('no_ded').notNull().default(false),
  warehouseId: uuid('warehouse_id').references(() => codes.id, { onDelete: 'restrict' }),
  supplierAccount: text('supplier_account'),
  currency: text('currency').notNull().default('MKD'),
  fx: numeric('fx', { precision: 18, scale: 6 }).notNull().default('1'),
  calcNo: text('calc_no'),
  /** Landed-cost allocation: `val`, `cn`, `multi`. */
  distMode: text('dist_mode').$type<'val' | 'cn' | 'multi'>().notNull().default('val'),
  /** Customs amounts per tariff line (index = stock line `cn`). */
  cnames: jsonb('cnames').$type<string[]>().notNull().default([]),
  base: money('base').notNull().default('0'),
  vat: money('vat').notNull().default('0'),
  total: money('total').notNull().default('0'),
  scanned: boolean('scanned').notNull().default(false),
  data: jsonb('data').$type<PurchaseData>().notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  approvedAt: ts('approved_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('purchases_firm_date_idx').on(t.firmId, t.date),
  index('purchases_partner_idx').on(t.firmId, t.partnerId),
  check('purchases_status_chk', sql`${t.status} in ('draft','posted','pending')`),
]);

export const purchaseVatGroups = pgTable('purchase_vat_groups', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  purchaseId: uuid('purchase_id').notNull().references(() => purchases.id, { onDelete: 'cascade' }),
  lineNo: integer('line_no').notNull(),
  account: text('account').notNull(),
  rate: integer('rate').notNull(),
  base: money('base').notNull(),
  vat: money('vat').notNull(),
}, (t) => [index('purchase_vat_groups_pur_idx').on(t.purchaseId)]);

export const purchaseStockLines = pgTable('purchase_stock_lines', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  purchaseId: uuid('purchase_id').notNull().references(() => purchases.id, { onDelete: 'cascade' }),
  lineNo: integer('line_no').notNull(),
  itemId: uuid('item_id').notNull().references(() => items.id, { onDelete: 'restrict' }),
  name: text('name'),
  /** Supplier's item code and barcode as printed. */
  code: text('code'),
  barcode: text('barcode'),
  qty: qty('qty').notNull(),
  /** Unit price (in currency for imports). */
  price: unitPrice('price').notNull(),
  rab: numeric('rab', { precision: 8, scale: 4 }).notNull().default('0'),
  amount: money('amount'),
  /** Customs tariff index into `purchases.cnames`. */
  cn: integer('cn'),
  /** Manual landed cost (null = automatic allocation). */
  dep: money('dep'),
  cvat: money('cvat').notNull().default('0'),
  /** New retail price incl. VAT. */
  sp: unitPrice('sp'),
  /** Stock value incl. landed cost, whole denars. */
  value: money('value').notNull(),
  /** `goods` | `material` | `product` (line override of the item type). */
  type: text('type'),
}, (t) => [index('purchase_stock_lines_pur_idx').on(t.purchaseId), index('purchase_stock_lines_item_idx').on(t.itemId)]);

/** Landed-cost slots (legacy `COSTS`: car, t1, t2, sped, trans, dr, dev). */
export const purchaseCosts = pgTable('purchase_costs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  purchaseId: uuid('purchase_id').notNull().references(() => purchases.id, { onDelete: 'cascade' }),
  slot: text('slot').$type<'car' | 't1' | 't2' | 'sped' | 'trans' | 'dr' | 'dev'>().notNull(),
  /** Amount without VAT (in currency for `dev`). */
  amount: money('amount').notNull().default('0'),
  fx: numeric('fx', { precision: 18, scale: 6 }),
  doc: text('doc'),
  date: date('date'),
  due: date('due'),
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
  byQty: boolean('by_qty').notNull().default(false),
  foreign: boolean('foreign').notNull().default(false),
  /** Up to three VAT lines of the cost document. */
  lines: jsonb('lines').$type<{ base: number; rate: number; vat: number }[]>().notNull().default([]),
}, (t) => [uniqueIndex('purchase_costs_slot_uq').on(t.purchaseId, t.slot)]);

/* ---------------- Supplier returns & credits ---------------- */

/** Legacy `docs.type = 'supcr'`: goods returned to the supplier (`ret`) or a supplier discount (`disc`). */
export const supplierCredits = pgTable('supplier_credits', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'restrict' }),
  legacyId: text('legacy_id'),
  status: text('status').$type<DocStatus>().notNull().default('posted'),
  kind: text('kind').$type<'ret' | 'disc'>().notNull(),
  number: text('number').notNull(),
  date: date('date').notNull(),
  /** The supplier's credit-note number. */
  supNo: text('sup_no'),
  partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'restrict' }),
  refPurchaseId: uuid('ref_purchase_id').references(() => purchases.id, { onDelete: 'restrict' }),
  warehouseId: uuid('warehouse_id').references(() => codes.id, { onDelete: 'restrict' }),
  note: text('note'),
  base: money('base').notNull().default('0'),
  vat: money('vat').notNull().default('0'),
  total: money('total').notNull().default('0'),
  scanned: boolean('scanned').notNull().default(false),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('supplier_credits_firm_date_idx').on(t.firmId, t.date),
  uniqueIndex('supplier_credits_number_uq').on(t.firmId, sql`(extract(year from ${t.date}))`, t.number),
]);

export const supplierCreditLines = pgTable('supplier_credit_lines', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  creditId: uuid('credit_id').notNull().references(() => supplierCredits.id, { onDelete: 'cascade' }),
  lineNo: integer('line_no').notNull(),
  itemId: uuid('item_id').references(() => items.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  qty: qty('qty').notNull(),
  price: unitPrice('price').notNull(),
  rate: integer('rate').notNull(),
  /** Credited konto (stock for returns, discount/expense konto for discounts). */
  account: text('account').notNull(),
}, (t) => [index('supplier_credit_lines_credit_idx').on(t.creditId)]);

export type Invoice = typeof invoices.$inferSelect;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type Purchase = typeof purchases.$inferSelect;
export type PurchaseVatGroup = typeof purchaseVatGroups.$inferSelect;
export type PurchaseStockLineRow = typeof purchaseStockLines.$inferSelect;
export type PurchaseCost = typeof purchaseCosts.$inferSelect;
export type SupplierCredit = typeof supplierCredits.$inferSelect;
export type SupplierCreditLine = typeof supplierCreditLines.$inferSelect;
