/**
 * Schema — office-wide firm screens ported after Phase 9: error register (`greski`), dunning letters (`opomeni`),
 * firm-from-registration-decision reads (`firmiResh`) and the request/letter templates of `baranja`.
 *
 * Settings that are one value for the whole office live in `app_settings` (keys `mailSig`, `mojIzvOwner`);
 * per-firm options in `firms.settings` (`payDays`, `opRate`, `opCost`, `payManual`, `ent`).
 * The year-end dossier (`zsDos`) needs no table: files are linked with `file_links` (`ye_dossier`, `<firmId>:<year>`).
 */
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** File-link entity of the year-end dossier (`entity_id` = `<firmId>:<year>`, `role` = ZY role). */
export const YE_DOSSIER_ENTITY = 'ye_dossier';

/** Legacy `apperrors` (errLog 17460): every error in the program, for quick fixing. */
export const appErrors = pgTable('app_errors', {
  id: uuid('id').primaryKey().defaultRandom(),
  at: ts('at').notNull().defaultNow(),
  ver: text('ver'),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  userName: text('user_name'),
  role: text('role'),
  firmId: uuid('firm_id').references(() => firms.id, { onDelete: 'set null' }),
  firmName: text('firm_name'),
  /** Screen (route path / legacy view id). */
  view: text('view'),
  /** `error` | `promise` | `render` | `server`. */
  src: text('src'),
  msg: text('msg').notNull(),
  stack: text('stack'),
  ua: text('ua'),
  /** De-duplication key (message + first stack frame); the same error is stored once per day. */
  key: text('key'),
  count: integer('count').notNull().default(1),
  fixed: boolean('fixed').notNull().default(false),
  fixedAt: ts('fixed_at'),
}, (t) => [index('app_errors_at_idx').on(t.at), index('app_errors_key_idx').on(t.key)]);

/** Legacy docs `type:'opomena'` (opLog 13335): one dunning letter sent / printed for a customer. */
export const dunningLetters = pgTable('dunning_letters', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  /** `partners.id` (no FK: partners can be merged / deleted, the history stays). */
  partnerId: uuid('partner_id'),
  partnerName: text('partner_name'),
  invoiceIds: jsonb('invoice_ids').$type<string[]>().notNull().default([]),
  /** 1, 2 or 3 (= last before lawsuit). */
  level: integer('level').notNull(),
  /** `е-пошта` | `PDF` | `WhatsApp/Viber`. */
  channel: text('channel').notNull(),
  /** Debt + interest + costs, MKD. */
  total: numeric('total', { precision: 18, scale: 2 }).notNull(),
  date: date('date').notNull(),
  mailId: uuid('mail_id'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  index('dunning_firm_partner_idx').on(t.firmId, t.partnerId),
  check('dunning_level_chk', sql`${t.level} between 1 and 3`),
]);

export type FirmReshStatus = 'queued' | 'reading' | 'done' | 'error' | 'saved';

/**
 * Legacy `firmiResh` (10540): a scanned registration decision read by the AI before the firm exists, so it is not an
 * `ai_documents` row (those belong to a firm). Files are office-wide (`files.firm_id` null).
 */
export const firmReshReads = pgTable('firm_resh_reads', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileIds: jsonb('file_ids').$type<string[]>().notNull(),
  status: text('status').$type<FirmReshStatus>().notNull().default('queued'),
  /** Parsed model JSON (`FS_PROMPT` shape). */
  result: jsonb('result'),
  error: text('error'),
  model: text('model'),
  /** The firm created / completed from this read. */
  firmId: uuid('firm_id').references(() => firms.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [index('firm_resh_reads_created_idx').on(t.createdBy, t.createdAt)]);

/** Legacy `office_tpl` text templates of `baranja` (`{фирма}` / `{?Поле}` placeholders); built-ins are in core. */
export const requestTemplates = pgTable('request_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Overrides the built-in template with this id (legacy kept the same id when editing a sample). */
  baseId: text('base_id'),
  inst: text('inst').notNull(),
  name: text('name').notNull(),
  to: text('recipient'),
  title: text('title').notNull().default(''),
  body: text('body').notNull().default(''),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AppError = typeof appErrors.$inferSelect;
export type DunningLetter = typeof dunningLetters.$inferSelect;
export type FirmReshRead = typeof firmReshReads.$inferSelect;
export type RequestTemplate = typeof requestTemplates.$inferSelect;
