/**
 * Schema — the office's own sales CRM (`/crm`): leads (potential clients of БАЈРАМИ ГРОУП / WISE CONSULTING) moving
 * through the pipeline Нов → Контакт → Понуда → Преговори → Добиен / Изгубен, their notes and the offers
 * („Понуда за сметководствени услуги“). Office level (owner / admin), never per client firm and never in the portal.
 * „Конвертирај во клиент“ creates the firm (`firmId`). Web-form submissions of the public website land here (`source = 'web'`).
 */
import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const crmLeads = pgTable('crm_leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  company: text('company').notNull(),
  edb: text('edb'),
  contact: text('contact'),
  phone: text('phone'),
  email: text('email'),
  city: text('city'),
  address: text('address'),
  /** `web` | `preporaka` | `telefon` | `drugo` (`CRM_SOURCES`). */
  source: text('source').notNull().default('drugo'),
  /** Who recommended / which campaign. */
  sourceNote: text('source_note'),
  activity: text('activity'),
  employees: integer('employees'),
  /** Estimated monthly fee, MKD without VAT. */
  fee: numeric('fee', { precision: 14, scale: 2 }),
  /** `nov` | `kontakt` | `ponuda` | `pregovori` | `dobien` | `izguben` (`CRM_STAGES`). */
  stage: text('stage').notNull().default('nov'),
  lostReason: text('lost_reason'),
  nextStep: text('next_step'),
  nextDate: date('next_date'),
  note: text('note'),
  /** Free data (web-form message, VAT payer…). */
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  /** The firm created by „Конвертирај во клиент“. */
  firmId: uuid('firm_id').references(() => firms.id, { onDelete: 'set null' }),
  closedAt: ts('closed_at'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [index('crm_leads_stage_idx').on(t.stage), index('crm_leads_next_idx').on(t.nextDate)]);
export type CrmLead = typeof crmLeads.$inferSelect;

export const crmNotes = pgTable('crm_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  leadId: uuid('lead_id').notNull().references(() => crmLeads.id, { onDelete: 'cascade' }),
  /** `note` | `call` | `meeting` | `mail` | `stage` (automatic: stage changed). */
  kind: text('kind').notNull().default('note'),
  text: text('text').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('crm_notes_lead_idx').on(t.leadId)]);
export type CrmNote = typeof crmNotes.$inferSelect;

export const crmOffers = pgTable('crm_offers', {
  id: uuid('id').primaryKey().defaultRandom(),
  leadId: uuid('lead_id').notNull().references(() => crmLeads.id, { onDelete: 'cascade' }),
  /** „ПН-001/2026“ (office counter `crmPon`). */
  number: text('number').notNull(),
  date: date('date').notNull(),
  validUntil: date('valid_until'),
  /** `draft` | `sent` | `accepted` | `declined`. */
  status: text('status').notNull().default('draft'),
  /** `CrmOffer` fields (services, fees, note). */
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [index('crm_offers_lead_idx').on(t.leadId)]);
export type CrmOfferRow = typeof crmOffers.$inferSelect;
