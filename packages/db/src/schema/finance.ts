/**
 * Schema — finance & books screens: ПДД payments (rent, bonuses, services from natural persons, legacy `docs` type `pdd`)
 * and loan contracts (legacy `docs` type `loan`, „Позајмици и заеми“). Their journals go through the posting service
 * (`sourceType` `pdd`); loans are only documents (their money moves are the bank / cash / manual journals on loan kontos).
 */
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';
import { partners } from './books';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date());
const money = (name: string) => numeric(name, { precision: 18, scale: 2 });
const by = (name: string) => uuid(name).references(() => users.id, { onDelete: 'set null' });

/** One row of a ПДД payment (whole denars, legacy `pddCalc`). */
export interface PddPaymentRow { tid: string; mode: 'n' | 'g'; amt: number; name: string; embg: string; acct: string; pid: string | null; G: number; ded: number; tax: number; net: number }

/** Legacy `docs` `type='pdd'` (8314–8380): payment of rent / bonuses / services to natural persons, booked as a direct cost. */
export const pddPayments = pgTable('pdd_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  /** Payment date (= booking date). */
  date: date('date').notNull(),
  note: text('note'),
  rows: jsonb('rows').$type<PddPaymentRow[]>().notNull().default([]),
  gross: money('gross').notNull().default('0'),
  deductions: money('deductions').notNull().default('0'),
  tax: money('tax').notNull().default('0'),
  net: money('net').notNull().default('0'),
  createdBy: by('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('pdd_payments_firm_date_idx').on(t.firmId, t.date)]);

/** Legacy `docs` `type='loan'` (16676–16880): loan contract given to / received from a partner. */
export const loans = pgTable('loans', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  /** `given` (the firm lends) or `received` (the firm borrows). */
  dir: text('dir').$type<'given' | 'received'>().notNull(),
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
  /** Counterparty name when there is no partner yet (legacy `pName`). */
  partnerName: text('partner_name'),
  number: text('number'),
  date: date('date').notNull(),
  amount: money('amount').notNull(),
  /** Annual contractual interest %, 0 = interest-free. */
  rate: numeric('rate', { precision: 9, scale: 4 }).notNull().default('0'),
  termDate: date('term_date'),
  installments: integer('installments').notNull().default(1),
  purpose: text('purpose'),
  cash: boolean('cash').notNull().default(false),
  signed: boolean('signed').notNull().default(false),
  konto: text('konto'),
  /** Ledger line ids (journal_lines.id) of the disbursements covered by this contract (legacy `bankIds`). */
  moveIds: jsonb('move_ids').$type<string[]>().notNull().default([]),
  /** Created from a detected disbursement (legacy `auto`). */
  auto: boolean('auto').notNull().default(false),
  createdBy: by('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('loans_firm_date_idx').on(t.firmId, t.date)]);

/** `file_links.entity_type` of a signed loan contract scan. */
export const LOAN_FILE_ENTITY = 'loan';

/**
 * Donation / sponsorship contract (Закон за донации и спонзорства во јавните дејности) and its confirmation
 * („Потврда за примена донација / спонзорство“, `conf*`). `role` `received`: the firm (здружение, фондација, клуб) is
 * the recipient; `given`: the firm is the donor / sponsor. The money moves are statement lines (`moveIds` =
 * bank_lines.id); an in-kind donation is booked by its own nalog (`journalId`, sourceType `donation`).
 */
export const donations = pgTable('donations', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'donation' | 'sponsorship'>().notNull(),
  role: text('role').$type<'received' | 'given'>().notNull(),
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
  partnerName: text('partner_name'),
  number: text('number'),
  date: date('date').notNull(),
  place: text('place'),
  amount: money('amount').notNull(),
  /** In kind (goods / services) instead of money; `inKindDesc` lists them. */
  inKind: boolean('in_kind').notNull().default(false),
  inKindDesc: text('in_kind_desc'),
  purpose: text('purpose'),
  /** Public-interest area (спорт, култура, …). */
  area: text('area'),
  /** Sponsorship: what the recipient does for the sponsor (name / logo on jerseys, banners, media…). */
  counter: text('counter'),
  /** Deadline for the payment / delivery. */
  termDate: date('term_date'),
  cash: boolean('cash').notNull().default(false),
  signed: boolean('signed').notNull().default(false),
  konto: text('konto'),
  moveIds: jsonb('move_ids').$type<string[]>().notNull().default([]),
  /** Confirmation of the realised donation / sponsorship. */
  confNumber: text('conf_number'),
  confDate: date('conf_date'),
  /** Realised amount (money received / value of the goods handed over). */
  confAmount: money('conf_amount'),
  confNote: text('conf_note'),
  /** Nalog of an in-kind donation (`postJournal` sourceType `donation`). */
  journalId: uuid('journal_id'),
  /** Contract fulfilled (last delivery / payment) — the УЈП-ИДС/ПР is due 30 days later (ЗДС чл. 19). */
  fulfilledDate: date('fulfilled_date'),
  /** УЈП-ИДС/ПР submitted. */
  idsFiled: date('ids_filed'),
  createdBy: by('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('donations_firm_date_idx').on(t.firmId, t.date)]);

export const DONATION_FILE_ENTITY = 'donation';

export type PddPayment = typeof pddPayments.$inferSelect;
export type Loan = typeof loans.$inferSelect;
export type Donation = typeof donations.$inferSelect;
