/**
 * Schema — legal compliance (docs/legal/COMPLIANCE.md): the register of inspections / decisions („Анализа на
 * решение / записник од контрола“), their findings with the office's analysis, and the corrective actions.
 *
 * Personal-data processing activities and data-subject requests use the existing `gdpr_records`
 * (`kind = 'activity' | 'request'`, firm-scoped, details in `data`). The append-only protection of `audit_log` is
 * custom SQL in `compliance.sql` (also appended to the migration).
 */
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date());
const money = (name: string) => numeric(name, { precision: 18, scale: 2 });
const by = (name: string) => uuid(name).references(() => users.id, { onDelete: 'set null' });

/** `file_links.entity_type` of the uploaded record / decision and the evidence attached to an inspection. */
export const KONTROLA_FILE_ENTITY = 'kontrola';

/** One inspection / decision (record → decision → appeal are tracked as one case; `doc` is the latest act). */
export const kontroli = pgTable('kontroli', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'restrict' }),
  /** `KONTROLA_AUTH` (@wise/core/compliance): ujp | dpi | dit | ufr | carina | dzlp | other */
  auth: text('auth').notNull(),
  /** `KONTROLA_DOC`: zapisnik | reshenie | vtor | platen | zakl */
  doc: text('doc').notNull(),
  docNo: text('doc_no'),
  docDate: date('doc_date'),
  /** Day the act was delivered — the remedy deadline counts from it. */
  delivered: date('delivered'),
  /** Deadline written in the act's „правна поука“ — prevails over the computed one. */
  dueOverride: date('due_override'),
  periodFrom: date('period_from'),
  periodTo: date('period_to'),
  subject: text('subject'),
  /** `KONTROLA_STATUS` */
  status: text('status').notNull().default('record'),
  /** Day the objection / appeal was filed (stops the deadline alarm). */
  filedOn: date('filed_on'),
  /** The client sees this inspection in the portal (office decision, default off). */
  clientVisible: boolean('client_visible').notNull().default(false),
  /** AI read that produced the findings, if any. */
  aiDocId: uuid('ai_doc_id'),
  /** Edited draft text of the objection and other free data. */
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  createdBy: by('created_by'),
  updatedBy: by('updated_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('kontroli_firm_idx').on(t.firmId, t.docDate),
  check('kontroli_auth_chk', sql`${t.auth} in ('ujp','dpi','dit','ufr','carina','dzlp','other')`),
  check('kontroli_doc_chk', sql`${t.doc} in ('zapisnik','reshenie','vtor','platen','zakl')`),
  check('kontroli_status_chk', sql`${t.status} in ('open','record','decision','objected','appeal','closed')`),
]);

/** A finding of the inspection with the office's analysis. Amounts are `numeric(18,2)`. */
export const kontrolaFindings = pgTable('kontrola_findings', {
  id: uuid('id').primaryKey().defaultRandom(),
  kontrolaId: uuid('kontrola_id').notNull().references(() => kontroli.id, { onDelete: 'cascade' }),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'restrict' }),
  no: integer('no').notNull(),
  /** `FINDING_AREA` */
  area: text('area').notNull().default('other'),
  text: text('text').notNull(),
  article: text('article'),
  claimed: money('claimed').notNull().default('0'),
  interest: money('interest').notNull().default('0'),
  fine: money('fine').notNull().default('0'),
  /** Recalculated from our books; null = not recalculated. */
  ours: money('ours'),
  /** How `ours` was obtained (e.g. „ДДВ-04 01.2026–03.2026, поле 31“, „конто 4700“). */
  oursSource: text('ours_source'),
  /** Optional account (prefix) whose turnover in the period is the evidence. */
  account: text('account'),
  verdict: text('verdict'),
  officeOk: boolean('office_ok'),
  systemError: boolean('system_error'),
  analysis: text('analysis'),
  recommendation: text('recommendation'),
  evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('kontrola_findings_k_idx').on(t.kontrolaId, t.no),
  check('kontrola_findings_verdict_chk', sql`${t.verdict} is null or ${t.verdict} in ('correct','partly','incorrect','unclear')`),
  check('kontrola_findings_rec_chk', sql`${t.recommendation} is null or ${t.recommendation} in ('accept','object','partial','review')`),
]);

/** Corrective action after an inspection, with owner and due date. */
export const kontrolaActions = pgTable('kontrola_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  kontrolaId: uuid('kontrola_id').notNull().references(() => kontroli.id, { onDelete: 'cascade' }),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'restrict' }),
  findingId: uuid('finding_id').references(() => kontrolaFindings.id, { onDelete: 'set null' }),
  text: text('text').notNull(),
  ownerId: by('owner_id'),
  ownerName: text('owner_name'),
  due: date('due'),
  doneOn: date('done_on'),
  note: text('note'),
  createdBy: by('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('kontrola_actions_k_idx').on(t.kontrolaId), index('kontrola_actions_due_idx').on(t.firmId, t.due)]);

export type Kontrola = typeof kontroli.$inferSelect;
export type KontrolaFinding = typeof kontrolaFindings.$inferSelect;
export type KontrolaAction = typeof kontrolaActions.$inferSelect;
