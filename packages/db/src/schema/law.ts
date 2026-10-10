/**
 * Schema — Фирми › МПИН од УЈП and the law views (legacy v451–v541 runtime additions).
 *
 * МПИН од УЈП (legacy `S.mpinIn.rows` in memory + `appmpin` index + `docs/mpin-{month}` / `docs/mpinack-{month}`):
 * - `mpin_inbox`: one uploaded acceptance PDF of the office-wide inbox, read by the worker (`mpin.read`). Kept
 *   until the user clears the list, so a reload does not lose the reads (legacy kept them only in memory).
 * - `mpin_acks`: the accepted declaration stored for a firm and month (legacy `appmpin/{fid}_{month}`); a correction
 *   marks the previous row `replaced` (legacy renamed the dossier document „(заменет)“).
 */
import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { files, firms, users } from './foundation';
import { journals } from './books';
import { payrollRuns } from './payroll';
import { dossierDocs } from './office';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date());
const money = (name: string) => numeric(name, { precision: 18, scale: 2 });
const by = (name: string) => uuid(name).references(() => users.id, { onDelete: 'set null' });

export type MpinInboxStatus = 'queued' | 'reading' | 'ok' | 'notm' | 'error' | 'done';

/** One uploaded МПИН („Декларација за прием“) in the all-firms inbox. */
export const mpinInbox = pgTable('mpin_inbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileId: uuid('file_id').notNull().references(() => files.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  status: text('status').$type<MpinInboxStatus>().notNull().default('queued'),
  /** Normalised read (`@wise/core/law` `MpinRead`). */
  result: jsonb('result').$type<Record<string, unknown> | null>(),
  /** Firm found by ЕДБ / name or chosen by the user. */
  firmId: uuid('firm_id').references(() => firms.id, { onDelete: 'set null' }),
  error: text('error'),
  /** Outcome text after distribution (legacy `r.res`). */
  res: text('res'),
  ackId: uuid('ack_id'),
  /** Removed from the list (legacy „Исчисти листа“). */
  cleared: boolean('cleared').notNull().default(false),
  model: text('model'),
  createdBy: by('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('mpin_inbox_user_idx').on(t.createdBy, t.cleared, t.createdAt)]);

/** Accepted МПИН of a firm and month (legacy `appmpin` index + `mpinack` document). */
export const mpinAcks = pgTable('mpin_acks', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  /** YYYY-MM */
  month: text('month').notNull(),
  no: text('no'),
  date: text('date'),
  status: text('status'),
  gross: money('gross').notNull().default('0'),
  total: money('total').notNull().default('0'),
  net: money('net').notNull().default('0'),
  due: text('due'),
  folio: text('folio'),
  /** Full normalised read. */
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  fileId: uuid('file_id').references(() => files.id, { onDelete: 'set null' }),
  dossierId: uuid('dossier_id').references(() => dossierDocs.id, { onDelete: 'set null' }),
  /** Journal booked from the declaration (kind `mpin`) when the payroll was not calculated in the program. */
  journalId: uuid('journal_id').references(() => journals.id, { onDelete: 'set null' }),
  /** Payroll run of the month marked „МПИН прифатен“. */
  runId: uuid('run_id').references(() => payrollRuns.id, { onDelete: 'set null' }),
  /** This acceptance replaced an earlier one (legacy `corr`). */
  corr: boolean('corr').notNull().default(false),
  /** Superseded by a correction. */
  replaced: boolean('replaced').notNull().default(false),
  createdBy: by('created_by'),
  byName: text('by_name'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('mpin_acks_firm_month_uq').on(t.firmId, t.month).where(sql`not ${t.replaced}`),
  index('mpin_acks_month_idx').on(t.month),
]);

export type MpinInboxRow = typeof mpinInbox.$inferSelect;
export type MpinAckRow = typeof mpinAcks.$inferSelect;
