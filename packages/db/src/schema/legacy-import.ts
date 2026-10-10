/**
 * Schema — legacy import (`packages/legacy-import`): import runs started by an admin from Систем › 📥 Увоз од
 * старата програма, and the legacy-id → new-id map that makes re-importing the same firm idempotent.
 *
 * `legacy_id_map` is written for every imported record (firm, partner, invoice, journal, …): re-importing a backup
 * updates the mapped rows in place instead of inserting duplicates. `firm_id IS NULL` rows are office-wide records
 * (users, office settings). `kind` is the importer's record kind (`partner`, `invoice`, `journal:invoice`, …),
 * `entity_id` the id of the row in its table (uuid as text; journals and moves included).
 */
import { sql } from 'drizzle-orm';
import { bigserial, check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const LEGACY_IMPORT_STATUS = ['queued', 'running', 'done', 'failed'] as const;
export type LegacyImportStatus = (typeof LEGACY_IMPORT_STATUS)[number];

/** Progress of a running import (shown on the page while the worker runs). */
export interface LegacyImportProgress {
  /** Firms finished / total firms found in the uploaded files. */
  done: number;
  total: number;
  /** Firm being imported now. */
  firm?: string;
  /** Step inside the firm (`партнери`, `налози 120/450`, …). */
  step?: string;
}

export const legacyImportRuns = pgTable('legacy_import_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: text('status').$type<LegacyImportStatus>().notNull().default('queued'),
  /** Uploaded backup files (`files.id`) and their names, in upload order. */
  files: jsonb('files').$type<{ id: string; name: string; size: number }[]>().notNull().default([]),
  /** Options chosen on the page (`users`, `vatBaseLines`, `onlyFirms`, …). */
  options: jsonb('options').$type<Record<string, unknown>>().notNull().default({}),
  progress: jsonb('progress').$type<LegacyImportProgress>().notNull().default({ done: 0, total: 0 }),
  /** Per-firm report (`ImportReport` of `@wise/legacy-import`). */
  report: jsonb('report').$type<Record<string, unknown>>(),
  error: text('error'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  startedAt: ts('started_at'),
  finishedAt: ts('finished_at'),
}, (t) => [
  index('legacy_import_runs_created_idx').on(t.createdAt),
  check('legacy_import_runs_status_chk', sql`${t.status} in ('queued','running','done','failed')`),
]);

export const legacyIdMap = pgTable('legacy_id_map', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  /** Null for office-wide records (users, settings). */
  firmId: uuid('firm_id').references(() => firms.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  legacyId: text('legacy_id').notNull(),
  entityId: text('entity_id').notNull(),
  /** Import run that last wrote this record. */
  runId: uuid('run_id').references(() => legacyImportRuns.id, { onDelete: 'set null' }),
  updatedAt: ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('legacy_id_map_uq').on(sql`coalesce(${t.firmId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.kind, t.legacyId),
  index('legacy_id_map_entity_idx').on(t.kind, t.entityId),
]);

export type LegacyImportRun = typeof legacyImportRuns.$inferSelect;
export type LegacyIdMapRow = typeof legacyIdMap.$inferSelect;
