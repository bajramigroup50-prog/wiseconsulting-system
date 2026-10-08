/**
 * Schema — Phase 9 "office": firm dossier (documents, contacts, deadlines), tasks, reminders, inbox and
 * client portal entries, Word templates, document packages, AML and GDPR records, company formation,
 * accounting-service contracts, inspection readiness, autopilot, recurring invoice definitions and the
 * generic `firm_docs` table for the remaining polymorphic legacy `docs` types (PLAN Step 3).
 *
 * Files never live in these rows: they are `files` + `file_links(entity_type, entity_id)` (MinIO).
 */
import { sql } from 'drizzle-orm';
import {
  bigserial, boolean, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { files, firms, users } from './foundation';
import { partners } from './books';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date());
const money = (name: string) => numeric(name, { precision: 18, scale: 2 });
const by = (name: string) => uuid(name).references(() => users.id, { onDelete: 'set null' });
const firmFk = (name = 'firm_id') => uuid(name).references(() => firms.id, { onDelete: 'cascade' });

/** Entity types used in `file_links.entity_type` by this module. */
export const OFFICE_FILE_ENTITY = {
  dossier: 'dossier_doc', task: 'office_task', inbox: 'inbox_item', clientEntry: 'client_entry',
  template: 'word_template', gdpr: 'gdpr_record', formation: 'formation_case', contract: 'service_contract', package: 'doc_package',
} as const;

/* ---------------- Dossier ---------------- */

/** Legacy `docs` `type='arch' && dos` (6597, 8073): one dossier document of a firm; pages are linked files. */
export const dossierDocs = pgTable('dossier_docs', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk().notNull(),
  /** Legacy `sub` — one of `DOS_CAT`. */
  category: text('category').notNull(),
  title: text('title'),
  number: text('number'),
  date: date('date'),
  validTo: date('valid_to'),
  partnerName: text('partner_name'),
  note: text('note'),
  /** Created from a client inbox item (legacy `fromInbox`). */
  fromInboxId: uuid('from_inbox_id'),
  createdBy: by('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('dossier_docs_firm_cat_idx').on(t.firmId, t.category), index('dossier_docs_valid_idx').on(t.validTo)]);

/** Saved contacts of a firm (legacy `firm.contacts`, used by the mail dialog). */
export const firmContacts = pgTable('firm_contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk().notNull(),
  name: text('name').notNull(),
  role: text('role'),
  email: text('email'),
  phone: text('phone'),
  note: text('note'),
  createdAt: createdAt(),
}, (t) => [index('firm_contacts_firm_idx').on(t.firmId)]);

/** Firm deadlines (licences, ЦРМ renewals, agreed dates) shown in the dossier and picked up by reminders. */
export const firmDeadlines = pgTable('firm_deadlines', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk().notNull(),
  title: text('title').notNull(),
  due: date('due').notNull(),
  /** Days before `due` to raise a reminder. */
  remindDays: integer('remind_days').notNull().default(7),
  done: boolean('done').notNull().default(false),
  note: text('note'),
  createdBy: by('created_by'),
  createdAt: createdAt(),
}, (t) => [index('firm_deadlines_due_idx').on(t.done, t.due), index('firm_deadlines_firm_idx').on(t.firmId)]);

/* ---------------- Tasks & reminders ---------------- */

/** Legacy `office_tasks` (3886–3913). */
export const officeTasks = pgTable('office_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  /** `TASK_STATUS`: new | assigned | progress | done | problem. */
  status: text('status').notNull().default('new'),
  prio: text('prio').notNull().default('normal'),
  firmId: uuid('firm_id').references(() => firms.id, { onDelete: 'set null' }),
  formationId: uuid('formation_id'),
  due: date('due'),
  inst: text('inst'),
  type: text('type'),
  assigneeId: by('assignee_id'),
  description: text('description'),
  /** Documents to carry (legacy `docs[{name, html}]`). */
  docs: jsonb('docs').$type<{ name: string; html: string }[]>().notNull().default([]),
  hist: jsonb('hist').$type<{ at: string; by: string; st: string; note: string }[]>().notNull().default([]),
  received: text('received'),
  /** Autopilot finding key that created the task (dedupe). */
  sourceKey: text('source_key'),
  doneAt: ts('done_at'),
  createdBy: by('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('office_tasks_status_idx').on(t.status, t.due),
  index('office_tasks_assignee_idx').on(t.assigneeId),
  uniqueIndex('office_tasks_source_uq').on(t.sourceKey).where(sql`${t.sourceKey} is not null`),
]);

/** Reminders (user, firm, deadline, autopilot). Sent by the `reminders` job; e-mail via Phase 6 `mail.send`. */
export const reminders = pgTable('reminders', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').references(() => firms.id, { onDelete: 'cascade' }),
  userId: by('user_id'),
  title: text('title').notNull(),
  body: text('body'),
  dueAt: ts('due_at').notNull(),
  /** `app` | `mail` | `portal` */
  channel: text('channel').notNull().default('app'),
  /** `pending` | `sent` | `dismissed` */
  status: text('status').notNull().default('pending'),
  sentAt: ts('sent_at'),
  /** Dedupe key (e.g. `deadline:<id>`). */
  key: text('key'),
  createdBy: by('created_by'),
  createdAt: createdAt(),
}, (t) => [index('reminders_due_idx').on(t.status, t.dueAt), uniqueIndex('reminders_key_uq').on(t.key).where(sql`${t.key} is not null`)]);

/* ---------------- Inbox & client portal ---------------- */

/** Legacy `docs.type='inbox'` + global `appinbox` mirror (9070, 13994–14015). Files via `file_links`. */
export const inboxItems = pgTable('inbox_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk().notNull(),
  /** true = message from the office to the client (legacy `office`). */
  fromOffice: boolean('from_office').notNull().default(false),
  subject: text('subject'),
  note: text('note'),
  fromUserId: by('from_user_id'),
  fromName: text('from_name'),
  done: boolean('done').notNull().default(false),
  doneBy: by('done_by'),
  doneAt: ts('done_at'),
  /** Where the office routed the item (legacy `irRoute`: purchase, bank, dossier, …). */
  route: text('route'),
  routeRef: text('route_ref'),
  createdAt: createdAt(),
}, (t) => [index('inbox_items_firm_idx').on(t.firmId, t.done, t.createdAt)]);

/**
 * Entries made by `klient` users (legacy `pend:true` on invoices/purchases/sales/docs, 3301).
 * They never touch the books: the office approves (→ the owning module creates and posts the document)
 * or rejects them. Enforced server-side (FIX #1).
 */
export const clientEntries = pgTable('client_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk().notNull(),
  /** `CLIENT_ENTRY_KINDS`: purchase | invoice | sale | dossier */
  kind: text('kind').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  /** `pending` | `approved` | `rejected` */
  status: text('status').notNull().default('pending'),
  submittedBy: by('submitted_by'),
  submittedAt: ts('submitted_at').notNull().defaultNow(),
  decidedBy: by('decided_by'),
  decidedAt: ts('decided_at'),
  decisionNote: text('decision_note'),
  /** Document created on approval, e.g. (`dossier_doc`, id) or (`firm_doc`, id). */
  targetType: text('target_type'),
  targetId: text('target_id'),
}, (t) => [index('client_entries_firm_status_idx').on(t.firmId, t.status, t.submittedAt)]);

/* ---------------- Word templates & packages ---------------- */

/** Legacy `apptpl` (16101–16186): an uploaded .docx with `{{KEY}}` placeholders, bound to a document kind. */
export const wordTemplates = pgTable('word_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** `tplKinds()` key (`kd`, `ct`, `d:…`, `free`). */
  kind: text('kind').notNull().default('free'),
  fileId: uuid('file_id').notNull().references(() => files.id, { onDelete: 'restrict' }),
  version: integer('version').notNull().default(1),
  active: boolean('active').notNull().default(true),
  /** Placeholders found in the document at upload. */
  vars: jsonb('vars').$type<string[]>().notNull().default([]),
  createdBy: by('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('word_templates_kind_idx').on(t.kind, t.active)]);

/** Legacy `paket` (8158–8230): a named set of documents for a bank / institution, downloaded as a ZIP. */
export const docPackages = pgTable('doc_packages', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk().notNull(),
  name: text('name').notNull(),
  recipient: text('recipient'),
  /** `[{ dossierId?, fileId?, label }]` in order. */
  items: jsonb('items').$type<{ dossierId?: string; fileId?: string; label: string }[]>().notNull().default([]),
  coverNote: text('cover_note'),
  createdBy: by('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('doc_packages_firm_idx').on(t.firmId)]);

/* ---------------- AML & GDPR ---------------- */

/** Legacy `appaml/{fid}` (15869): the client's KYC file and current risk level. */
export const amlRecords = pgTable('aml_records', {
  firmId: uuid('firm_id').primaryKey().references(() => firms.id, { onDelete: 'cascade' }),
  /** `AmlFile` (beneficial owners, representative, PEP, indicators, …). */
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  level: text('level').notNull().default('high'),
  score: integer('score').notNull().default(0),
  lastReview: date('last_review'),
  nextReview: date('next_review'),
  updatedBy: by('updated_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** ЗЗЛП register: DPAs with clients, staff confidentiality statements, processing activities, breaches, requests. */
export const gdprRecords = pgTable('gdpr_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** `GDPR_KINDS` */
  kind: text('kind').notNull(),
  firmId: uuid('firm_id').references(() => firms.id, { onDelete: 'cascade' }),
  userId: by('user_id'),
  subject: text('subject').notNull(),
  date: date('date'),
  validTo: date('valid_to'),
  due: date('due'),
  status: text('status').notNull().default('open'),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  createdBy: by('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('gdpr_records_kind_idx').on(t.kind, t.status)]);

/* ---------------- Formation, contracts ---------------- */

/** Legacy `office_newco` (4001–4032, 14985–15747). */
export const formationCases = pgTable('formation_cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  form: text('form').notNull().default('ДООЕЛ'),
  /** `NC_STATUS` */
  status: text('status').notNull().default('prep'),
  /** `NF` fields (address, NKD, capital, …). */
  data: jsonb('data').$type<Record<string, string>>().notNull().default({}),
  capItems: jsonb('cap_items').$type<{ name: string; eur?: number; mkd?: number }[]>().notNull().default([]),
  founders: jsonb('founders').$type<Record<string, unknown>[]>().notNull().default([]),
  managers: jsonb('managers').$type<Record<string, unknown>[]>().notNull().default([]),
  /** `NC_CHECK` item → done. */
  checklist: jsonb('checklist').$type<Record<string, boolean>>().notNull().default({}),
  eurRate: numeric('eur_rate', { precision: 10, scale: 4 }).notNull().default('61.5'),
  /** Firm created from the case (legacy `ncCreateFirm`). */
  firmId: uuid('firm_id').references(() => firms.id, { onDelete: 'set null' }),
  createdBy: by('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('formation_cases_status_idx').on(t.status)]);

/** Accounting-service contract (legacy `docs.type='kdog'`, 10326–10397). */
export const serviceContracts = pgTable('service_contracts', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk().notNull(),
  /** `СУ-001/2026` — allocated from `office_counters` in the save transaction (FIX #8). */
  number: text('number').notNull(),
  date: date('date').notNull(),
  start: date('start'),
  end: date('end'),
  fee: money('fee').notNull().default('0'),
  /** `draft` | `signed` | `ended` */
  status: text('status').notNull().default('draft'),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  createdBy: by('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('service_contracts_number_uq').on(t.number), index('service_contracts_firm_idx').on(t.firmId)]);

/** Per-year counters for office numbering (contracts, …). Incremented with `UPDATE … RETURNING` in a transaction. */
export const officeCounters = pgTable('office_counters', {
  key: text('key').notNull(),
  year: integer('year').notNull(),
  value: integer('value').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.key, t.year] })]);

/* ---------------- Inspection readiness ---------------- */

/** Manual confirmations per firm and check (legacy `firm.insp[id] = {d | na}`). */
export const inspectionStates = pgTable('inspection_states', {
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull(),
  doneDate: date('done_date'),
  na: boolean('na').notNull().default(false),
  note: text('note'),
  byName: text('by_name'),
  updatedBy: by('updated_by'),
  updatedAt: updatedAt(),
}, (t) => [primaryKey({ columns: [t.firmId, t.itemId] })]);

/* ---------------- Autopilot ---------------- */

export const autopilotRuns = pgTable('autopilot_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
  /** `cron` | `manual` */
  trigger: text('trigger').notNull().default('cron'),
  firms: integer('firms').notNull().default(0),
  findings: integer('findings').notNull().default(0),
  error: text('error'),
});

/** Current findings per firm (legacy `alCompute` + `apExtra` results). Upserted by key each run. */
export const autopilotFindings = pgTable('autopilot_findings', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  firmId: firmFk().notNull(),
  key: text('key').notNull(),
  lvl: text('lvl').notNull(),
  cat: text('cat').notNull(),
  txt: text('txt').notNull(),
  go: text('go'),
  firstSeen: ts('first_seen').notNull().defaultNow(),
  lastSeen: ts('last_seen').notNull().defaultNow(),
  /** Set when a run no longer reports it. */
  resolvedAt: ts('resolved_at'),
  /** Acknowledged by the office (legacy `firm.alAck`). */
  ackBy: by('ack_by'),
  ackAt: ts('ack_at'),
}, (t) => [uniqueIndex('autopilot_findings_key_uq').on(t.firmId, t.key), index('autopilot_findings_open_idx').on(t.resolvedAt, t.lvl)]);

/** Per-firm metrics and risk score of the latest run (legacy `apRisk`). */
export const autopilotMetrics = pgTable('autopilot_metrics', {
  firmId: uuid('firm_id').primaryKey().references(() => firms.id, { onDelete: 'cascade' }),
  runId: uuid('run_id'),
  metrics: jsonb('metrics').$type<Record<string, unknown>>().notNull().default({}),
  risk: integer('risk').notNull().default(0),
  riskWhy: jsonb('risk_why').$type<string[]>().notNull().default([]),
  updatedAt: updatedAt(),
});

/** Client messages proposed by the autopilot and their sending log (legacy `office_apsent`). */
export const autopilotMessages = pgTable('autopilot_messages', {
  key: text('key').primaryKey(),
  firmId: firmFk().notNull(),
  type: text('type').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  /** `proposed` | `sent` | `skipped` */
  status: text('status').notNull().default('proposed'),
  channels: text('channels'),
  sentBy: text('sent_by'),
  sentAt: ts('sent_at'),
  createdAt: createdAt(),
}, (t) => [index('autopilot_messages_firm_idx').on(t.firmId, t.status)]);

/* ---------------- Recurring invoices ---------------- */

/** Legacy `docs.type='recur'` (10184, 13483–13598). The job issues *draft* invoices through Phase 3. */
export const recurringInvoices = pgTable('recurring_invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk().notNull(),
  partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'restrict' }),
  /** month | quarter | half | year */
  every: text('every').notNull().default('month'),
  /** Day of month `1`–`31` or `L` (last working day). */
  day: text('day').notNull().default('1'),
  next: date('next'),
  end: date('end'),
  dueDays: integer('due_days').notNull().default(15),
  items: jsonb('items').$type<{ itemId?: string | null; name: string; qty: number; price: number; vat: number; unit?: string }[]>().notNull().default([]),
  note: text('note'),
  active: boolean('active').notNull().default(true),
  /** Send the issued invoice by e-mail (Phase 6 `mail.send`). */
  mail: boolean('mail').notNull().default(false),
  last: date('last'),
  lastRef: text('last_ref'),
  createdBy: by('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('recurring_invoices_due_idx').on(t.active, t.next), index('recurring_invoices_firm_idx').on(t.firmId)]);

/* ---------------- Generic polymorphic legacy docs ---------------- */

/**
 * Remaining legacy `docs.type` records that don't have their own table yet (PLAN Step 3): loans, payment
 * orders, maillog, invoice drafts from recurring definitions until Phase 3 is merged, …
 */
export const firmDocs = pgTable('firm_docs', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk().notNull(),
  type: text('type').notNull(),
  number: text('number'),
  date: date('date'),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  status: text('status').notNull().default('active'),
  createdBy: by('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('firm_docs_firm_type_idx').on(t.firmId, t.type, t.date)]);

export type DossierDoc = typeof dossierDocs.$inferSelect;
export type OfficeTask = typeof officeTasks.$inferSelect;
export type InboxItem = typeof inboxItems.$inferSelect;
export type ClientEntry = typeof clientEntries.$inferSelect;
export type WordTemplate = typeof wordTemplates.$inferSelect;
export type RecurringInvoice = typeof recurringInvoices.$inferSelect;
export type FormationCase = typeof formationCases.$inferSelect;
export type ServiceContract = typeof serviceContracts.$inferSelect;
