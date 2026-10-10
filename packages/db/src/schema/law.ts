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
import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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

/* ---------------- ⚖️ Законски промени (legacy `applaw`, v464) ---------------- */

/**
 * One law change found by the daily robot (worker `law.robot`) or entered by hand (legacy `applaw` documents).
 * `key` dedupes the robot's findings (normalised source URL).
 */
export const lawChanges = pgTable('law_changes', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull(),
  /** `LAW_INST` key (UJP, SV, …). */
  inst: text('inst').notNull(),
  title: text('title').notNull(),
  what: text('what'),
  /** Who is affected (free text, legacy `who`). */
  who: text('who'),
  /** `LAW_IMP` keys (ddv, plati, site, …). */
  impact: jsonb('impact').$type<string[]>().notNull().default([]),
  /** Published (YYYY-MM-DD). */
  date: text('date'),
  /** Valid from / to (YYYY-MM-DD). */
  from: text('from'),
  to: text('to'),
  urls: jsonb('urls').$type<string[]>().notNull().default([]),
  /** Where it shows in the program (legacy `prog`). */
  prog: text('prog'),
  /** false = secondary source, to be confirmed. */
  verified: boolean('verified').notNull().default(true),
  /** Machine rule (legacy `rule`, e.g. `{kind:'vatRate', match:'gorivo', rate:10}`). */
  rule: jsonb('rule').$type<Record<string, unknown> | null>(),
  source: text('source').notNull().default('robot'),
  createdBy: by('created_by'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('law_changes_key_uq').on(t.key), index('law_changes_date_idx').on(t.date)]);

/** Per user: law changes read up to (legacy `localStorage lk_lawSeen`). */
export const lawSeen = pgTable('law_seen', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  seenAt: ts('seen_at').notNull(),
});

/** Questions to the law assistant (legacy `ACT.lawAsk`), answered by the worker (`law.ask`). */
export const lawAsks = pgTable('law_asks', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  question: text('question').notNull(),
  answer: text('answer'),
  status: text('status').$type<'queued' | 'done' | 'error'>().notNull().default('queued'),
  error: text('error'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('law_asks_user_idx').on(t.userId, t.createdAt)]);

/** Pages the robot watches: the links seen last time (to find new ones) and the last check. */
export const lawSources = pgTable('law_sources', {
  url: text('url').primaryKey(),
  inst: text('inst').notNull(),
  name: text('name').notNull(),
  links: jsonb('links').$type<string[]>().notNull().default([]),
  checkedAt: ts('checked_at'),
  changedAt: ts('changed_at'),
  error: text('error'),
});

/** One robot run (legacy: the scheduled task that wrote `applaw`). */
export const lawRuns = pgTable('law_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
  sources: integer('sources').notNull().default(0),
  found: integer('found').notNull().default(0),
  added: integer('added').notNull().default(0),
  errors: jsonb('errors').$type<string[]>().notNull().default([]),
});

export type LawChangeRow = typeof lawChanges.$inferSelect;
