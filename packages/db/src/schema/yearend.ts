/**
 * Schema — Phase 8 "year-end": fixed-asset register and depreciation runs, year closings, annual statements.
 *
 * Journals themselves (depreciation `dep-<Y>`, close `close-<Y>`, opening `open-<Y+1>`) are written by the posting
 * service only; these tables keep the documents and the state of the year around them.
 */
import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';
import { journals } from './books';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date());
const money = (name: string) => numeric(name, { precision: 18, scale: 2 });

/* ---------------- Fixed assets ---------------- */

/**
 * Fixed-asset register (legacy `assets`, saveAsset 7233). `konto` is the asset account (group 00x / 01x), which
 * decides the depreciation accounts (`@wise/core` `depAccounts`, fix D1). `vehicleOnly` = a fleet record that is
 * not an owned asset (not depreciated, fix D3); `disposed` = disposal / write-off date (depreciation stops).
 */
export const fixedAssets = pgTable('fixed_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'restrict' }),
  /** Legacy asset id, for the importer. */
  legacyId: text('legacy_id'),
  /** Inventory number (legacy 4-digit `invNo`). */
  invNo: text('inv_no'),
  name: text('name').notNull(),
  /** Asset group account (0110 buildings, 0120 equipment, 0136 vehicles, …). */
  konto: text('konto').notNull(),
  /** Annual depreciation rate in %. */
  rate: numeric('rate', { precision: 7, scale: 3 }).notNull().default('0'),
  /** Acquisition date (depreciation starts the month after). */
  date: date('date').notNull(),
  cost: money('cost').notNull().default('0'),
  vehicleOnly: boolean('vehicle_only').notNull().default(false),
  disposed: date('disposed'),
  serial: text('serial'),
  barcode: text('barcode'),
  supplier: text('supplier'),
  invDoc: text('inv_doc'),
  location: text('location'),
  note: text('note'),
  /** Vehicle and other legacy fields (plate, regExp, insExp, techExp, odo, fuelNorm, …). */
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('fixed_assets_firm_idx').on(t.firmId, t.konto),
  uniqueIndex('fixed_assets_inv_uq').on(t.firmId, t.invNo).where(sql`${t.invNo} is not null`),
]);

/** One depreciation run per firm and year (legacy journal `dep-YYYY` with `detail: depFor().rows`). */
export const depreciationRuns = pgTable('depreciation_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'restrict' }),
  year: integer('year').notNull(),
  journalId: uuid('journal_id').references(() => journals.id, { onDelete: 'set null' }),
  total: money('total').notNull().default('0'),
  /** `depFor` rows: [{id, year, acc, konto}] */
  rows: jsonb('rows').$type<{ id: string; year: number; acc: number; konto: string }[]>().notNull().default([]),
  runBy: uuid('run_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('depreciation_runs_uq').on(t.firmId, t.year)]);

/* ---------------- Year closing ---------------- */

export const YEAR_STATUSES = ['open', 'closed', 'carried', 'locked'] as const;
export type YearStatus = (typeof YEAR_STATUSES)[number];

/**
 * State of a firm's business year: closed (`close-<Y>`, nalog 999), carried forward (`open-<Y+1>`, nalog 0), locked
 * (firm lock date ≥ 31.12.Y). `db` keeps the snapshot the close was computed from (ДБ/ДБ-ВП/ДЛД result, tax source).
 */
export const yearClosings = pgTable('year_closings', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'restrict' }),
  year: integer('year').notNull(),
  status: text('status').$type<YearStatus>().notNull().default('open'),
  /** Entity the year was closed as (co / tp / sd / npo). */
  entity: text('entity'),
  closeJournalId: uuid('close_journal_id').references(() => journals.id, { onDelete: 'set null' }),
  openJournalId: uuid('open_journal_id').references(() => journals.id, { onDelete: 'set null' }),
  profit: money('profit'),
  tax: money('tax'),
  net: money('net'),
  /** The close was rebuilt from a trial balance imported after the close (legacy `obRebuild`, `imported: true`). */
  imported: boolean('imported').notNull().default(false),
  /** ДБ snapshot: {taxSource, V (ДБ AOPs), base, tax, ak, diff, …} */
  db: jsonb('db').$type<Record<string, unknown>>().notNull().default({}),
  closedAt: ts('closed_at'),
  closedBy: uuid('closed_by').references(() => users.id, { onDelete: 'set null' }),
  openedAt: ts('opened_at'),
  openedBy: uuid('opened_by').references(() => users.id, { onDelete: 'set null' }),
  lockedAt: ts('locked_at'),
  lockedBy: uuid('locked_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('year_closings_uq').on(t.firmId, t.year)]);

/* ---------------- Annual statements ---------------- */

export const STATEMENT_STATUSES = ['draft', 'ready', 'submitted', 'accepted'] as const;
export type StatementStatus = (typeof STATEMENT_STATUSES)[number];

/**
 * The annual account of a firm for a year (ЦРМ forms 35–38) and the inputs of the tax returns.
 * Legacy kept all of this on the firm document, keyed by year (`zsMan`, `deMan`, `f35Raw`, `dbAdj`, `vpAdj`,
 * `dldAdj`, `zsNotes`, `zsAck`, `crmPeriod`); here it is one row per firm and year.
 */
export const annualStatements = pgTable('annual_statements', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'restrict' }),
  year: integer('year').notNull(),
  status: text('status').$type<StatementStatus>().notNull().default('draft'),
  /** Last computed AOP values {bs001…, bu201…} (snapshot at save / submit). */
  aop: jsonb('aop').$type<Record<string, number>>().notNull().default({}),
  /** Manual AOP overrides (legacy `zsMan[Y]`). */
  zsMan: jsonb('zs_man').$type<Record<string, number>>().notNull().default({}),
  /** Form 38 manual values (legacy `deMan[Y]`). */
  deMan: jsonb('de_man').$type<Record<string, number>>().notNull().default({}),
  /** Form 35 amounts from an imported XML (legacy `f35Raw[Y]`). */
  f35Raw: jsonb('f35_raw').$type<Record<string, number>>().notNull().default({}),
  /** What the last ЦРСМ XML import replaced, so it can be undone exactly (fix C1). */
  crmImport: jsonb('crm_import').$type<Record<string, unknown> | null>(),
  crmPeriod: integer('crm_period').notNull().default(1),
  /** ДБ inputs by AOP (legacy `dbAdj[Y]`). */
  dbAdj: jsonb('db_adj').$type<Record<string, number>>().notNull().default({}),
  /** ДБ-ВП inputs (legacy `vpAdj[Y]`) + `on` = the firm pays the tax on total income this year. */
  vpAdj: jsonb('vp_adj').$type<Record<string, unknown>>().notNull().default({}),
  /** ДЛД-ДБ inputs for sole traders (legacy `dldAdj[Y]`). */
  dldAdj: jsonb('dld_adj').$type<Record<string, number>>().notNull().default({}),
  /** Explanatory notes text by note id (legacy `zsNotes[Y]`). */
  notes: jsonb('notes').$type<Record<string, string>>().notNull().default({}),
  /** Acknowledged phase-gate findings (legacy `zsAck[Y]`): key → {note, by, at}. */
  ack: jsonb('ack').$type<Record<string, { note?: string; by?: string; at?: string }>>().notNull().default({}),
  submittedAt: ts('submitted_at'),
  submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('annual_statements_uq').on(t.firmId, t.year)]);

export type FixedAsset = typeof fixedAssets.$inferSelect;
export type NewFixedAsset = typeof fixedAssets.$inferInsert;
export type DepreciationRun = typeof depreciationRuns.$inferSelect;
export type YearClosing = typeof yearClosings.$inferSelect;
export type AnnualStatement = typeof annualStatements.$inferSelect;
