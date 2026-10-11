/**
 * Schema — shared AI infrastructure (owned by Phase 3): per-firm cost log and AI document reads.
 *
 * `ai_documents` is one uploaded file sent through the `ai.read-document` job. The worker stores the raw model
 * result and one draft per invoice found in the file (a PDF can hold several); the review UI turns each draft into a
 * purchase / invoice and records the saved id. Batch mode ("масовно") groups documents by `batch_id`.
 *
 * The other kinds (`blg` receipts, `emp` employee documents, `bank` statements, `fisk` fiscal reports, `classify`
 * office-inbox classification, `bom` BOM suggestion) store only the parsed model JSON in `result`; the screen that
 * started the read maps it (`@wise/core/ai/*`) and the user confirms before anything is saved. `bom` reads no file
 * (text-only prompt built from the firm's materials), so `file_id` is nullable.
 */
import { bigserial, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { files, firms, users } from './foundation';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Replaces the legacy `/api/ai/cost` counter: one row per model call. */
export const aiUsage = pgTable('ai_usage', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  at: ts('at').notNull().defaultNow(),
  firmId: uuid('firm_id').references(() => firms.id, { onDelete: 'set null' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  /** What the call was for: `purchase`, `sale`, `blg`, `emp`, … */
  purpose: text('purpose').notNull(),
  tier: text('tier').$type<'quick' | 'default' | 'complex'>().notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
  /** The `ai_documents` row (or other entity) the call belongs to. */
  refId: text('ref_id'),
}, (t) => [index('ai_usage_firm_at_idx').on(t.firmId, t.at)]);

export type AiDocKind = 'purchase' | 'sale' | 'blg' | 'emp' | 'scr' | 'bank' | 'fisk' | 'classify' | 'bom' | 'cmp' | 'imp' | 'ob' | 'rec' | 'bankcls'
  /** Auto service: vehicle registration certificate (legacy `DIG.vreg`). */
  | 'vreg'
  /** Rent-a-car: passport / ID card / driving licence of the customer (legacy `RC_DOC_PROMPT`). */
  | 'rcdoc' | 'rclic'
  /** Partner from a ЦРМ „тековна состојба“ extract (legacy v404 `tkRead`, `FS_PROMPT`). */
  | 'tk';
export type AiDocStatus = 'queued' | 'reading' | 'done' | 'error' | 'saved';

/** One invoice found in a read document, prepared for the review UI. */
export interface AiDraft {
  /** `ScanPurchaseDraft` / `ScanSaleDraft` from `@wise/core/sales`. */
  draft: Record<string, unknown>;
  /** Batch check: `ok` | `check` | `dup`. */
  status: 'ok' | 'check' | 'dup';
  msg: string;
  /** Id of the purchase / invoice saved from this draft. */
  savedId?: string;
}

export const aiDocuments = pgTable('ai_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  /** Null only for text-only reads (`bom`). */
  fileId: uuid('file_id').references(() => files.id, { onDelete: 'restrict' }),
  kind: text('kind').$type<AiDocKind>().notNull(),
  /** Groups the documents of one "масовно" run. */
  batchId: uuid('batch_id'),
  status: text('status').$type<AiDocStatus>().notNull().default('queued'),
  /** Batch options: `{cash, warehouseId, costOnly}`; `bom`: `{productId}`; `classify`: `{inboxId}`. */
  options: jsonb('options').$type<Record<string, unknown>>().notNull().default({}),
  /** Raw model / UBL result. */
  result: jsonb('result'),
  drafts: jsonb('drafts').$type<AiDraft[]>().notNull().default([]),
  error: text('error'),
  model: text('model'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [index('ai_documents_firm_created_idx').on(t.firmId, t.createdAt), index('ai_documents_batch_idx').on(t.batchId)]);

export type AiDocument = typeof aiDocuments.$inferSelect;
