/**
 * Schema — „🏛 Институции – барања и плаќања“ (`@wise/core/office/institutions`): what a state institution sent to or
 * demands from a client firm (барање, решение, записник, опомена…), its deadline, the amount to pay with the payment
 * details, who handles it, and how it ended (answered / paid from a bank-statement line / closed). Attached scans are
 * `file_links` with `entity_type = 'inst_item'`; the deadline also appears in the deadline calendar (`rokovi` type `inst`).
 */
import { sql } from 'drizzle-orm';
import { check, date, index, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const by = (name: string) => uuid(name).references(() => users.id, { onDelete: 'set null' });

/** `file_links.entity_type` of the documents attached to an item. */
export const INST_FILE_ENTITY = 'inst_item';

export const instItems = pgTable('inst_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  /** `INSTITUTIONS` id (ujp, dpi, dit, afv, fpiom…; `other` with `inst_name`). */
  inst: text('inst').notNull(),
  /** The name as written on the document (regional office, municipality, court…). */
  instName: text('inst_name'),
  /** `INST_TYPES` */
  type: text('type').notNull(),
  refNo: text('ref_no'),
  /** Date of the document. */
  docDate: date('doc_date'),
  /** Day it was received (delivered) — deadlines „во рок од N дена“ count from it. */
  received: date('received'),
  due: date('due'),
  subject: text('subject'),
  amount: numeric('amount', { precision: 18, scale: 2 }),
  payRecip: text('pay_recip'),
  payAccount: text('pay_account'),
  payUplSm: text('pay_upl_sm'),
  payPrihod: text('pay_prihod'),
  payRef: text('pay_ref'),
  payPurpose: text('pay_purpose'),
  /** `INST_STATUS`: new | work | answered | paid | closed */
  status: text('status').notNull().default('new'),
  assigneeId: by('assignee_id'),
  note: text('note'),
  paidOn: date('paid_on'),
  /** „✓ платено (извод бр. …)“ or the colleague's note. */
  paidNote: text('paid_note'),
  /** The bank-statement line that paid it (matched automatically). */
  bankLineId: uuid('bank_line_id'),
  /** `INST_SOURCES`: manual | upload | incoming | mail */
  source: text('source').notNull().default('manual'),
  /** The incoming-inbox row the item was made from. */
  incomingId: uuid('incoming_id'),
  /** Linked inspection analysis (`kontroli`) for a записник / решение. */
  kontrolaId: uuid('kontrola_id'),
  /** AI reads of the attached documents: `{ reads: [{ id, applied }] }`. */
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  createdBy: by('created_by'),
  updatedBy: by('updated_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index('inst_items_firm_idx').on(t.firmId, t.status, t.due),
  index('inst_items_due_idx').on(t.due),
  check('inst_items_status_chk', sql`${t.status} in ('new','work','answered','paid','closed')`),
]);
export type InstItem = typeof instItems.$inferSelect;
