/**
 * VAT period service (Phase 5): compute ДДВ-04 per period, close (file + post) and reopen periods.
 *
 * Legacy: `ACT.ddvPost` 7313 (`save('journal', {id:'ddv-'+period, kind:'ddv', …}, {force:true})`),
 * `ACT.ddvUnpost` 7315, the autopilot bulk close `apClBookOne` 16433, and `VIEWS.ddv` 5969.
 *
 * FIX (LEGACY-MAP 5.4 item 7): legacy had two posting paths — `ddvPost` via `save(…, {force:true})` and
 * `apClBookOne` writing `firms/{id}/journal` directly (no wrappers, permissions or audit). Here there
 * is exactly one: {@link closeVatPeriod}, which posts through `postJournal` (balance, lock, chart,
 * numbering, audit) in the caller's transaction. A future bulk close (Phase 9 autopilot) must call it.
 *
 * FIX (LEGACY-MAP 5.4 item 6, travel margin): the filed ДДВ-04 is frozen in `vat_periods.ddv04` at
 * closing time, so later costs on a travel arrangement can no longer silently change a closed period.
 *
 * FIX (LEGACY-MAP 5.4 item 9): `VIEWS.ddv` recomputed `ddvFor` for every period of the year on every
 * render (and again in `vbCheckHTML`). {@link vatYearOverview} loads the year's documents once and
 * uses the frozen snapshot for closed periods.
 */
import { and, eq, gte, isNull, lte, ne, or, sql } from 'drizzle-orm';
import {
  ddv04FromResult, ddvFor, periodDue, periodsOfYear, perRange, vatCloseEntries,
  type DdvResult, type Ddv04Fields, type JournalLine as CoreJournalLine, type LedgerLineLike, type PostingContext,
} from '@wise/core';
import { audit, type Tx } from './audit';
import { postJournal, PostingError, unpostSource, type PostedJournal } from './posting';
import { firms, journalLines, journals, vatPeriods, type Firm, type VatPeriodCorrections, type VatPeriodRow } from './schema/index';
import { loadVatPostingContext } from './vat-context';
import { defaultVatSource, VAT_CLOSE_SOURCE, type VatDocumentSource, type VatSourceData, type VatSourceOrigin } from './vat-source';

export type VatPeriodKind = 'month' | 'quarter';

const dmy = (d: string) => d.split('-').reverse().join('.');
const fail = (m: string): never => { throw new PostingError('vat_period', m); };

/** `YYYY-MM` → month, `YYYY-Тq` → quarter, anything else → null. Accepts a Latin `T` for the quarter. */
export function vatPeriodKindOf(p: string): VatPeriodKind | null {
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) return 'month';
  if (/^\d{4}-Т[1-4]$/.test(p)) return 'quarter';
  return null;
}
/** Normalise a period id from a URL / form (Latin `T` → Cyrillic `Т`). Returns null when invalid. */
export function normalizeVatPeriod(p: string | null | undefined): string | null {
  const s = String(p ?? '').trim().replace(/-T([1-4])$/i, '-Т$1');
  return vatPeriodKindOf(s) ? s : null;
}
export const firmVatPeriodKind = (f: Pick<Firm, 'vatPeriod'>): VatPeriodKind => (f.vatPeriod === 'month' ? 'month' : 'quarter');

/** Human label: `01.07.2026 – 30.09.2026`. */
export const vatPeriodLabel = (p: string) => { const [a, b] = perRange(p); return `${dmy(a)} – ${dmy(b)}`; };

/** Ledger lines of [from, to] on all accounts, without VAT-close journals (input for `vatCloseEntries`). */
export async function vatLedgerLines(tx: Tx, firmId: string, from: string, to: string): Promise<LedgerLineLike[]> {
  const rows = await tx.select({ account: journalLines.account, date: journals.date, debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
    .where(and(eq(journalLines.firmId, firmId), sql`${journals.date} between ${from} and ${to}`,
      or(isNull(journals.sourceType), ne(journals.sourceType, VAT_CLOSE_SOURCE))));
  return rows.map((r) => ({ account: r.account, date: r.date, debit: Number(r.debit), credit: Number(r.credit) }));
}

export interface VatPeriodComputation {
  period: string; kind: VatPeriodKind; from: string; to: string; due: string;
  ctx: PostingContext; data: VatSourceData; result: DdvResult; fields: Ddv04Fields;
  /** Preview of the VAT-close journal and its net (debt > 0 / claim < 0). */
  close: { lines: CoreJournalLine[]; diff: number };
}

/** Compute ДДВ-04 and the closing journal of one period (nothing is written). */
export async function computeVatPeriod(
  tx: Tx, firm: Firm, period: string, source: VatDocumentSource = defaultVatSource, corrections: VatPeriodCorrections = {}, ctx?: PostingContext,
): Promise<VatPeriodComputation> {
  const kind = vatPeriodKindOf(period) ?? fail(`Неважечки ДДВ период „${period}“.`);
  const [from, to] = perRange(period);
  const C = ctx ?? await loadVatPostingContext(tx, firm);
  const data = await source.load(tx, firm, from, to, C);
  const result = ddvFor(data.docs, period, kind, C, { travel: data.travel });
  const fields = ddv04FromResult(result, corrections.field30 ?? 0);
  const close = vatCloseEntries(await vatLedgerLines(tx, firm.id, from, to), from, to, C);
  return { period, kind, from, to, due: periodDue(period), ctx: C, data, result, fields, close };
}

async function lockFirm(tx: Tx, firmId: string): Promise<Firm> {
  const [f] = await tx.select().from(firms).where(eq(firms.id, firmId)).for('update').limit(1);
  return f ?? fail('Фирмата не постои.');
}
async function periodRow(tx: Tx, firmId: string, period: string): Promise<VatPeriodRow | null> {
  const [r] = await tx.select().from(vatPeriods).where(and(eq(vatPeriods.firmId, firmId), eq(vatPeriods.period, period))).for('update').limit(1);
  return r ?? null;
}

export interface CloseVatPeriodInput {
  firmId: string;
  period: string;
  userId: string | null;
  /** Default: `defaultVatSource` (documents + manual VAT journals). */
  source?: VatDocumentSource;
  /** Corrections to file with (default: the ones saved on the period). */
  corrections?: VatPeriodCorrections;
}
export interface CloseVatPeriodResult { row: VatPeriodRow; journal: PostedJournal | null; fields: Ddv04Fields; diff: number }

/**
 * File and close a VAT period: post the VAT-close journal (`vatCloseEntries`, dated the last day of the
 * period, kind `ddv`, source `vatPeriod`/row id), freeze the ДДВ-04 snapshot and mark the period closed.
 * A period without VAT balances is closed without a journal (zero return).
 */
export async function closeVatPeriod(tx: Tx, a: CloseVatPeriodInput): Promise<CloseVatPeriodResult> {
  const firm = await lockFirm(tx, a.firmId);
  if (!firm.vatRegistered) fail('Фирмата не е регистрирана за ДДВ – нема ДДВ период за затворање.');
  const kind = vatPeriodKindOf(a.period) ?? fail(`Неважечки ДДВ период „${a.period}“.`);
  if (kind !== firmVatPeriodKind(firm)) {
    fail(`Фирмата пријавува ${firmVatPeriodKind(firm) === 'month' ? 'месечно' : 'тромесечно'} – периодот ${a.period} не одговара.`);
  }
  const [from, to] = perRange(a.period);
  const existing = await periodRow(tx, firm.id, a.period);
  if (existing?.status === 'closed') fail(`ДДВ периодот ${vatPeriodLabel(a.period)} е веќе затворен.`);
  const [overlap] = await tx.select({ period: vatPeriods.period }).from(vatPeriods).where(and(
    eq(vatPeriods.firmId, firm.id), eq(vatPeriods.status, 'closed'), lte(vatPeriods.dateFrom, to), gte(vatPeriods.dateTo, from), ne(vatPeriods.period, a.period),
  )).limit(1);
  if (overlap) fail(`Периодот се преклопува со веќе затворениот ДДВ период ${overlap.period}.`);

  const corrections = a.corrections ?? existing?.corrections ?? {};
  const C = await computeVatPeriod(tx, firm, a.period, a.source ?? defaultVatSource, corrections);
  const values = { firmId: firm.id, period: a.period, periodKind: kind, dateFrom: from, dateTo: to, corrections };
  const row = existing
    ? (await tx.update(vatPeriods).set(values).where(eq(vatPeriods.id, existing.id)).returning())[0]!
    : (await tx.insert(vatPeriods).values({ ...values, status: 'open' }).returning())[0]!;

  let journal: PostedJournal | null = null;
  if (C.close.lines.length) {
    journal = await postJournal(tx, {
      firmId: firm.id, date: to, kind: 'ddv', sourceType: VAT_CLOSE_SOURCE, sourceId: row.id,
      description: `ДДВ-04 ${vatPeriodLabel(a.period)}`, lines: C.close.lines, periodFrom: from, periodTo: to,
      meta: { period: a.period, field31: C.fields['31'], diff: C.close.diff }, userId: a.userId, requirePartner: false, auditAction: 'ddvPost',
    });
  }
  const snapshot = {
    fields: C.fields, origin: C.data.origin as VatSourceOrigin, closeDiff: C.close.diff,
    totals: { outV: C.result.outV, inV: C.result.inV, net: C.result.net }, computedAt: new Date().toISOString(),
  };
  const [closed] = await tx.update(vatPeriods).set({
    status: 'closed', closingJournalId: journal?.id ?? null, ddv04: snapshot, submittedAt: new Date(), submittedBy: a.userId,
  }).where(eq(vatPeriods.id, row.id)).returning();
  await audit(tx, {
    userId: a.userId, firmId: firm.id, action: 'ddvClose', entityType: 'vatPeriod', entityId: row.id,
    data: { period: a.period, from, to, journal: journal?.number ?? null, field31: C.fields['31'], diff: C.close.diff, corrections },
  });
  return { row: closed!, journal, fields: C.fields, diff: C.close.diff };
}

/** Reopen a closed VAT period: remove its VAT-close journal and mark it open (the last snapshot stays for reference). */
export async function reopenVatPeriod(tx: Tx, a: { firmId: string; period: string; userId: string | null }): Promise<VatPeriodRow> {
  const firm = await lockFirm(tx, a.firmId);
  const row = await periodRow(tx, firm.id, a.period);
  if (!row || row.status !== 'closed') fail(`ДДВ периодот ${a.period} не е затворен.`);
  const removed = await unpostSource(tx, { firmId: firm.id, sourceType: VAT_CLOSE_SOURCE, sourceId: row!.id, userId: a.userId });
  const [open] = await tx.update(vatPeriods).set({ status: 'open', closingJournalId: null, reopenedAt: new Date(), reopenedBy: a.userId })
    .where(eq(vatPeriods.id, row!.id)).returning();
  await audit(tx, {
    userId: a.userId, firmId: firm.id, action: 'ddvReopen', entityType: 'vatPeriod', entityId: row!.id,
    data: { period: a.period, journalsRemoved: removed, filed: row!.ddv04?.fields ?? null },
  });
  return open!;
}

/** Save the corrections (field 30, note, amendment number) of a period that is still open. */
export async function saveVatCorrections(tx: Tx, a: { firmId: string; period: string; corrections: VatPeriodCorrections; userId: string | null }): Promise<VatPeriodRow> {
  const firm = await lockFirm(tx, a.firmId);
  const kind = vatPeriodKindOf(a.period) ?? fail(`Неважечки ДДВ период „${a.period}“.`);
  const row = await periodRow(tx, firm.id, a.period);
  if (row?.status === 'closed') fail('Периодот е затворен – отворете го за да ги смените корекциите.');
  const c: VatPeriodCorrections = {
    field30: Math.round(Number(a.corrections.field30) || 0),
    ...(a.corrections.note?.trim() ? { note: a.corrections.note.trim().slice(0, 500) } : {}),
    ...(a.corrections.amendmentNo?.trim() ? { amendmentNo: a.corrections.amendmentNo.trim().slice(0, 50) } : {}),
  };
  const [from, to] = perRange(a.period);
  const [r] = row
    ? await tx.update(vatPeriods).set({ corrections: c }).where(eq(vatPeriods.id, row.id)).returning()
    : await tx.insert(vatPeriods).values({ firmId: firm.id, period: a.period, periodKind: kind, dateFrom: from, dateTo: to, status: 'open', corrections: c }).returning();
  await audit(tx, { userId: a.userId, firmId: firm.id, action: 'ddvCorrections', entityType: 'vatPeriod', entityId: r!.id, data: { period: a.period, ...c } });
  return r!;
}

export interface VatPeriodOverview {
  period: string; kind: VatPeriodKind; from: string; to: string; due: string;
  status: 'open' | 'closed';
  /** Filed snapshot for closed periods, live computation otherwise. */
  fields: Ddv04Fields;
  row: VatPeriodRow | null;
}

/**
 * All VAT periods of a year for the firm's filing frequency, plus closed periods filed under the other
 * frequency (after a month ↔ quarter switch). Documents are loaded once for the whole year.
 */
export async function vatYearOverview(tx: Tx, firm: Firm, year: number, source: VatDocumentSource = defaultVatSource): Promise<{ periods: VatPeriodOverview[]; ctx: PostingContext; data: VatSourceData }> {
  const kind = firmVatPeriodKind(firm);
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const ctx = await loadVatPostingContext(tx, firm);
  const [rows, data] = await Promise.all([
    tx.select().from(vatPeriods).where(and(eq(vatPeriods.firmId, firm.id), lte(vatPeriods.dateFrom, to), gte(vatPeriods.dateTo, from))),
    source.load(tx, firm, from, to, ctx),
  ]);
  const byP = new Map(rows.map((r) => [r.period, r]));
  const one = (p: string, k: VatPeriodKind): VatPeriodOverview => {
    const row = byP.get(p) ?? null;
    const [a, b] = perRange(p);
    const fields = row?.status === 'closed' && row.ddv04
      ? row.ddv04.fields
      : ddv04FromResult(ddvFor(data.docs, p, k, ctx, { travel: data.travel }), row?.corrections.field30 ?? 0);
    return { period: p, kind: k, from: a, to: b, due: periodDue(p), status: row?.status === 'closed' ? 'closed' : 'open', fields, row };
  };
  const list = periodsOfYear(year, kind).map((p) => one(p, kind));
  for (const r of rows) if (r.status === 'closed' && r.periodKind !== kind) list.push(one(r.period, r.periodKind));
  list.sort((x, y) => (x.from < y.from ? -1 : x.from > y.from ? 1 : x.to < y.to ? -1 : 1));
  return { periods: list, ctx, data };
}
