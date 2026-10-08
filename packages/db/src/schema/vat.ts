/**
 * Schema — Phase 5 "VAT" (ДДВ): filed VAT periods.
 *
 * A row exists once a period has been closed at least once (an open period without a row is simply
 * "not filed yet"). Closing posts the VAT-close journal (`@wise/core` `vatCloseEntries`) through the
 * posting service with `source_type = 'vatPeriod'`, `source_id = vat_periods.id`, and freezes the
 * ДДВ-04 that was filed in `ddv04`.
 *
 * FIX (LEGACY-MAP 5.4 item 8): legacy decided "is this date in a closed VAT period?" with the firm's
 * *current* month/quarter setting (`ddvClosed` → `periodOf(date, firm.per)`), so switching the filing
 * frequency misaligned already closed periods. The closed date range is stored here (`date_from` /
 * `date_to`) and the posting lock uses the range, independent of today's `firms.vat_period`.
 */
import { sql } from 'drizzle-orm';
import { check, date, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';
import { journals } from './books';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const VAT_PERIOD_STATUS = ['open', 'closed'] as const;
export type VatPeriodStatus = (typeof VAT_PERIOD_STATUS)[number];

/** Corrections entered on the return (field 30 "Останати корекции") and the amendment reference. */
export interface VatPeriodCorrections {
  /** Field 30 in whole denars (+ reduces the debt in field 31). */
  field30?: number;
  /** Explanation of the correction. */
  note?: string;
  /** "Исправка на ДДВ-04 — Број" when this filing amends an earlier one. */
  amendmentNo?: string;
}

/** Frozen copy of what was filed (fields 01–31 in whole denars, plus the inputs that produced them). */
export interface Ddv04Snapshot {
  fields: Record<string, number>;
  /** Where the documents came from: real document tables, the ledger fallback, or a fixture. */
  origin: string;
  /** Net VAT of the closing journal (debt > 0 / claim < 0), in denars. */
  closeDiff: number;
  /** Selected `ddvFor` totals for later reconciliation. */
  totals: { outV: number; inV: number; net: number };
  computedAt: string;
}

export const vatPeriods = pgTable('vat_periods', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  /** `YYYY-MM` (monthly filer) or `YYYY-Тq` (quarterly filer, Cyrillic Т) — `@wise/core` `periodOf`. */
  period: text('period').notNull(),
  /** Filing frequency the period was filed under. */
  periodKind: text('period_kind').$type<'month' | 'quarter'>().notNull(),
  dateFrom: date('date_from').notNull(),
  dateTo: date('date_to').notNull(),
  status: text('status').$type<VatPeriodStatus>().notNull().default('open'),
  /** The VAT-close journal; null when the period had no VAT balances (a zero return). */
  closingJournalId: uuid('closing_journal_id').references(() => journals.id, { onDelete: 'set null' }),
  ddv04: jsonb('ddv04').$type<Ddv04Snapshot>(),
  corrections: jsonb('corrections').$type<VatPeriodCorrections>().notNull().default({}),
  submittedAt: ts('submitted_at'),
  submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
  reopenedAt: ts('reopened_at'),
  reopenedBy: uuid('reopened_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('vat_periods_firm_period_uq').on(t.firmId, t.period),
  index('vat_periods_firm_range_idx').on(t.firmId, t.dateFrom, t.dateTo),
  check('vat_periods_status_chk', sql`${t.status} in ('open','closed')`),
  check('vat_periods_kind_chk', sql`${t.periodKind} in ('month','quarter')`),
  check('vat_periods_range_chk', sql`${t.dateFrom} <= ${t.dateTo}`),
]);

export type VatPeriodRow = typeof vatPeriods.$inferSelect;
