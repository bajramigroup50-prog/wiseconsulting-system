/**
 * Posting service — the only writer of `journals` / `journal_lines`.
 *
 * Every module that books something (manual nalozi, opening balance, year-end, and in later phases
 * invoices, purchases, bank statements, VAT, payroll, stock…) computes its lines and calls:
 *
 *   await db.transaction(async (tx) => {
 *     // … save the source document …
 *     await postJournal(tx, { firmId, date, kind: 'izlez', sourceType: 'invoice', sourceId: inv.id,
 *                             description: 'Фактура 12', lines, userId });
 *   });
 *
 * Guarantees (all inside the caller's transaction, together with an `audit_log` row):
 * - the journal is balanced to the cent (also enforced at COMMIT by the deferred trigger, migration 0002);
 * - the firm's period lock (`firms.lock_date`) is respected for the new date *and* for any journal being replaced/removed;
 *   explicitly `locked` journals cannot be changed;
 * - every account exists in the firm's effective chart (global + overrides, not hidden);
 * - partners belong to the firm, and partner accounts 120–128 / 220–228 carry one (`needsPartner`);
 * - numbering is assigned once (`@wise/core` `nalogNumber`) and never changes when other journals are added.
 *
 * Re-posting a source replaces its journal in place (same id; the counter number is kept).
 */
import { and, eq, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import {
  ACCOUNT_CODE_RE, MANUAL_COUNTER_BASE, lineTotals, nalogNumber, needsPartner, nextCounter, r2,
  type JournalKind, type NalogSettings,
} from '@wise/core';
import { audit, type Tx } from './audit';
import { assertVatPeriodOpen } from './vat-lock';
import { accounts, firms, journalLines, journals, partners, type Firm, type Journal } from './schema/index';
import { applyJournalOverride } from './journal-override';

export type PostingErrorCode =
  | 'firm_not_found' | 'bad_date' | 'empty' | 'unbalanced' | 'locked' | 'bad_account' | 'unknown_account'
  | 'partner_required' | 'unknown_partner' | 'not_found' | 'bbimp_conflict'
  /** Phase 5: the date is in a closed VAT period (`vat-lock.ts`); `vat_period`: VAT period service errors. */
  | 'vat_closed' | 'vat_period';

/** Domain error with a Macedonian message suitable for the UI. */
export class PostingError extends Error {
  constructor(readonly code: PostingErrorCode, message: string) {
    super(message);
    this.name = 'PostingError';
  }
}

export interface PostLineInput {
  account: string;
  /** Amounts as numbers or numeric strings; rounded to 2 decimals. May be negative (red storno). */
  debit?: number | string | null;
  credit?: number | string | null;
  partnerId?: string | null;
  note?: string | null;
  /** Document reference shown on the nalog (invoice number…). */
  doc?: string | null;
  currency?: string | null;
  amountCur?: number | string | null;
  locationId?: string | null;
}

export interface PostJournalInput {
  firmId: string;
  /** Booking date, `YYYY-MM-DD`. */
  date: string;
  /** Journal kind — drives numbering (see `@wise/core` `JournalKind`). */
  kind: JournalKind;
  description?: string | null;
  /** Origin document. With both set, posting again replaces the existing journal of that source. */
  sourceType?: string | null;
  sourceId?: string | null;
  lines: readonly PostLineInput[];
  /** Explicit nalog number (legacy manual `nalNo`, e.g. `6/10-12`); otherwise assigned automatically. */
  number?: string | null;
  /** Extra numbering inputs: bank account id for `bank`, payroll month for `plati` / `mpin`. */
  numbering?: { bankAccountId?: string | null; payMonth?: number };
  periodFrom?: string | null;
  periodTo?: string | null;
  meta?: Record<string, unknown>;
  /** Acting user (for `created_by` and the audit row); null for system jobs. */
  userId: string | null;
  /** Require a partner on 120–128 / 220–228 lines (default true). */
  requirePartner?: boolean;
  /** Audit action name (default `postJournal` / `repostJournal`). */
  auditAction?: string;
}

export interface PostedJournal { id: string; number: string; replaced: boolean }

/** A real calendar date `YYYY-MM-DD` (rejects 2026-02-30). */
export const isIsoDate = (d: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(d + 'T00:00:00Z');
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
};
const money = (v: number | string | null | undefined): number => r2(Number(v ?? 0) || 0);
const fmt = (n: number) => n.toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (d: string) => d.split('-').reverse().join('.');

/** Throw if `date` falls in the firm's locked period. */
export function assertOpenPeriod(firm: Pick<Firm, 'lockDate'>, date: string): void {
  if (firm.lockDate && date <= firm.lockDate) {
    throw new PostingError('locked', `Периодот до ${dmy(firm.lockDate)} е заклучен – налогот со датум ${dmy(date)} не може да се книжи, менува или брише.`);
  }
}

/** Numbering settings stored in `firms.settings` (legacy firm fields `nalCodes`, `nalogMode`, `nalogPer`, `nalPayPer`, `banks`). */
export const firmNalogSettings = (f: Pick<Firm, 'settings'>): NalogSettings => {
  const s = (f.settings ?? {}) as Record<string, unknown>;
  return {
    nalCodes: s.nalCodes as NalogSettings['nalCodes'],
    nalogMode: s.nalogMode === 'doc' ? 'doc' : 'period',
    nalogPer: s.nalogPer === 'month' ? 'month' : 'quarter',
    nalPayPer: s.nalPayPer === 'year' ? 'year' : 'month',
    banks: Array.isArray(s.banks) ? (s.banks as NalogSettings['banks']) : [],
  };
};

async function loadFirm(tx: Tx, firmId: string): Promise<Firm> {
  // FOR UPDATE: serializes postings against a concurrent change of the lock date.
  const [f] = await tx.select().from(firms).where(eq(firms.id, firmId)).for('update').limit(1);
  if (!f) throw new PostingError('firm_not_found', 'Фирмата не постои.');
  return f;
}

/** Codes from `codes` that are not in the firm's effective chart (global + overrides, minus hidden). */
export async function missingAccounts(tx: Tx, firmId: string, codes: readonly string[]): Promise<string[]> {
  const U = [...new Set(codes)];
  if (!U.length) return [];
  const rows = await tx.select({ code: accounts.code, firmId: accounts.firmId, hidden: accounts.hidden }).from(accounts)
    .where(and(inArray(accounts.code, U), or(isNull(accounts.firmId), eq(accounts.firmId, firmId))));
  const ok = new Set<string>();
  for (const c of U) {
    const own = rows.find((r) => r.code === c && r.firmId === firmId);
    if (own ? !own.hidden : rows.some((r) => r.code === c && r.firmId == null)) ok.add(c);
  }
  return U.filter((c) => !ok.has(c));
}

interface PreparedLine {
  lineNo: number; account: string; debit: string; credit: string; partnerId: string | null;
  note: string | null; doc: string | null; currency: string | null; amountCur: string | null; locationId: string | null;
}

async function prepareLines(tx: Tx, firmId: string, input: readonly PostLineInput[], requirePartner: boolean): Promise<{ lines: PreparedLine[]; total: number }> {
  const L = input
    .map((l) => ({ ...l, account: String(l.account ?? '').trim(), d: money(l.debit), p: money(l.credit) }))
    .filter((l) => l.d || l.p);
  if (!L.length) throw new PostingError('empty', 'Налогот нема ставки со износ.');
  const bad = L.find((l) => !ACCOUNT_CODE_RE.test(l.account));
  if (bad) throw new PostingError('bad_account', `Неважечко конто „${bad.account}“.`);
  const t = lineTotals(L.map((l) => ({ debit: l.d, credit: l.p })));
  if (!t.balanced) throw new PostingError('unbalanced', `Налогот не е изедначен: должи ${fmt(t.D)} ≠ побарува ${fmt(t.P)} (разлика ${fmt(t.diff)}).`);
  const missing = await missingAccounts(tx, firmId, L.map((l) => l.account));
  if (missing.length) throw new PostingError('unknown_account', `Контото „${missing.join(', ')}“ не постои во контниот план.`);
  const pids = [...new Set(L.map((l) => l.partnerId).filter((x): x is string => !!x))];
  if (pids.length) {
    const found = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.firmId, firmId), inArray(partners.id, pids)));
    if (found.length !== pids.length) throw new PostingError('unknown_partner', 'Комитентот не постои во оваа фирма.');
  }
  if (requirePartner) {
    const np = [...new Set(L.filter((l) => needsPartner(l.account) && !l.partnerId).map((l) => l.account))];
    if (np.length) throw new PostingError('partner_required', `Конто ${np.join(', ')} бара комитент – изберете го во колоната „Комитент“.`);
  }
  return {
    total: t.D,
    lines: L.map((l, i) => ({
      lineNo: i + 1, account: l.account, debit: l.d.toFixed(2), credit: l.p.toFixed(2), partnerId: l.partnerId || null,
      note: l.note?.trim() || null, doc: l.doc?.trim() || null, currency: l.currency || null,
      amountCur: l.amountCur == null || l.amountCur === '' ? null : money(l.amountCur).toFixed(2), locationId: l.locationId || null,
    })),
  };
}

const yearOf = (date: string) => date.slice(0, 4);

async function assignNumber(tx: Tx, f: Firm, input: PostJournalInput, keep: Journal | null): Promise<string> {
  if (input.number?.trim()) return input.number.trim();
  const settings = firmNalogSettings(f);
  const n = nalogNumber({
    kind: input.kind, date: input.date, settings, bankAccountId: input.numbering?.bankAccountId,
    payMonth: input.numbering?.payMonth, vatPeriod: f.vatPeriod === 'month' ? 'month' : 'quarter',
  });
  if (n.no) return n.no;
  // Counter: keep the existing number when re-posting within the same year (numbers never move).
  if (keep && yearOf(keep.date) === yearOf(input.date) && !/\//.test(keep.number)) return keep.number;
  const y = yearOf(input.date);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'nalog:' + f.id + ':' + y}))`);
  const used = await tx.select({ n: journals.number }).from(journals)
    .where(and(eq(journals.firmId, f.id), sql`${journals.date} between ${y + '-01-01'} and ${y + '-12-31'}`));
  return nextCounter(used.map((r) => r.n), settings.nalogMode === 'doc' ? 0 : MANUAL_COUNTER_BASE);
}

async function assertNoBbimpConflict(tx: Tx, firmId: string, input: PostJournalInput, selfId: string | null): Promise<void> {
  if (input.kind !== 'bbimp') return;
  const y = yearOf(input.date);
  const [x] = await tx.select({ id: journals.id }).from(journals).where(and(
    eq(journals.firmId, firmId), sql`${journals.date} between ${y + '-01-01'} and ${y + '-12-31'}`,
    notInArray(journals.kind, ['open', 'close', 'bbimp']), selfId ? ne(journals.id, selfId) : undefined,
  )).limit(1);
  // FIX(#12): an imported full-year trial balance must not be mixed with real turnover of the same year.
  if (x) throw new PostingError('bbimp_conflict', `За ${y} веќе има книжени документи – увезениот бруто биланс би ги дуплирал прометите.`);
}

async function writeJournal(tx: Tx, existing: Journal | null, input: PostJournalInput): Promise<PostedJournal> {
  if (!isIsoDate(input.date)) throw new PostingError('bad_date', 'Неважечки датум на налогот.');
  const f = await loadFirm(tx, input.firmId);
  assertOpenPeriod(f, input.date);
  if (existing) {
    if (existing.locked) throw new PostingError('locked', `Налогот ${existing.number} е заклучен.`);
    assertOpenPeriod(f, existing.date);
  }
  // Phase 5: closed VAT periods (new date and lines; the replaced journal's date and lines).
  await assertVatPeriodOpen(tx, f, { date: input.date, sourceType: input.sourceType, accounts: input.lines.map((l) => String(l.account ?? '')) });
  if (existing) await assertVatPeriodOpen(tx, f, { date: existing.date, sourceType: existing.sourceType, journalId: existing.id });
  await assertNoBbimpConflict(tx, f.id, input, existing?.id ?? null);
  // Finance parity: manual line corrections of document journals (legacy `ed`/`edAdd`) are re-applied on every re-post.
  input = await applyJournalOverride(tx, f.id, input);
  const { lines, total } = await prepareLines(tx, f.id, input.lines, input.requirePartner ?? true);
  const number = await assignNumber(tx, f, input, existing);
  const header = {
    firmId: f.id, date: input.date, kind: input.kind, number, description: input.description?.trim() || null,
    sourceType: input.sourceType ?? null, sourceId: input.sourceId ?? null,
    periodFrom: input.periodFrom || null, periodTo: input.periodTo || null, meta: input.meta ?? {}, updatedBy: input.userId,
  };
  let id: string;
  if (existing) {
    await tx.update(journals).set(header).where(eq(journals.id, existing.id));
    await tx.delete(journalLines).where(eq(journalLines.journalId, existing.id));
    id = existing.id;
  } else {
    const [j] = await tx.insert(journals).values({ ...header, createdBy: input.userId }).returning({ id: journals.id });
    id = j!.id;
  }
  await tx.insert(journalLines).values(lines.map((l) => ({ ...l, journalId: id, firmId: f.id })));
  await audit(tx, {
    userId: input.userId, firmId: f.id, action: input.auditAction ?? (existing ? 'repostJournal' : 'postJournal'),
    entityType: 'journal', entityId: id,
    data: { number, kind: input.kind, date: input.date, total, lines: lines.length, sourceType: header.sourceType, sourceId: header.sourceId },
  });
  return { id, number, replaced: !!existing };
}

/**
 * Post a balanced journal. With `sourceType` + `sourceId`, an existing journal of that source is replaced
 * (same id; lock checks apply to both the old and the new date). Returns the journal id and its number.
 * Throws {@link PostingError} on any validation failure — the caller's transaction should then roll back.
 */
export async function postJournal(tx: Tx, input: PostJournalInput): Promise<PostedJournal> {
  let existing: Journal | null = null;
  if (input.sourceType && input.sourceId) {
    [existing = null] = await tx.select().from(journals).where(and(
      eq(journals.firmId, input.firmId), eq(journals.sourceType, input.sourceType), eq(journals.sourceId, input.sourceId),
    )).for('update').limit(1);
  }
  return writeJournal(tx, existing, input);
}

/**
 * Replace header and lines of an existing journal (manual correction of a nalog).
 * FIX(#9): legacy manual journals could not be edited (`saveJ` always created a new one; corrections were
 * written as `ed`/`edAdd` overlays into whatever source document). Here the journal itself is updated,
 * keeping its id and counter number, with per-line notes.
 */
export async function updateJournal(tx: Tx, journalId: string, input: PostJournalInput): Promise<PostedJournal> {
  const [existing] = await tx.select().from(journals).where(and(eq(journals.id, journalId), eq(journals.firmId, input.firmId))).for('update').limit(1);
  if (!existing) throw new PostingError('not_found', 'Налогот не постои.');
  return writeJournal(tx, existing, { ...input, sourceType: input.sourceType ?? existing.sourceType, sourceId: input.sourceId ?? existing.sourceId });
}

async function removeJournals(tx: Tx, firmId: string, rows: Journal[], userId: string | null, action: string): Promise<number> {
  if (!rows.length) return 0;
  const f = await loadFirm(tx, firmId);
  for (const j of rows) {
    if (j.locked) throw new PostingError('locked', `Налогот ${j.number} е заклучен.`);
    assertOpenPeriod(f, j.date);
    await assertVatPeriodOpen(tx, f, { date: j.date, sourceType: j.sourceType, journalId: j.id }); // Phase 5
  }
  await tx.delete(journals).where(inArray(journals.id, rows.map((j) => j.id)));
  for (const j of rows) {
    await audit(tx, { userId, firmId, action, entityType: 'journal', entityId: j.id,
      data: { number: j.number, kind: j.kind, date: j.date, sourceType: j.sourceType, sourceId: j.sourceId } });
  }
  return rows.length;
}

/** Remove the journal(s) posted for a source document (e.g. when the invoice is deleted or un-posted). Returns the count. */
export async function unpostSource(tx: Tx, a: { firmId: string; sourceType: string; sourceId: string; userId: string | null }): Promise<number> {
  const rows = await tx.select().from(journals).where(and(
    eq(journals.firmId, a.firmId), eq(journals.sourceType, a.sourceType), eq(journals.sourceId, a.sourceId),
  )).for('update');
  return removeJournals(tx, a.firmId, rows, a.userId, 'unpostJournal');
}

/** Delete one journal by id (manual nalog, opening balance…). */
export async function deleteJournal(tx: Tx, a: { firmId: string; journalId: string; userId: string | null }): Promise<void> {
  const rows = await tx.select().from(journals).where(and(eq(journals.firmId, a.firmId), eq(journals.id, a.journalId))).for('update');
  if (!rows.length) throw new PostingError('not_found', 'Налогот не постои.');
  await removeJournals(tx, a.firmId, rows, a.userId, 'deleteJournal');
}
