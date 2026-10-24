/**
 * UX Phase 3 (docs/ux-rindertim.md P31): re-posting after a change of the posting schemes, the bank kontos or the
 * chart — in the BACKGROUND (worker job `books.repost`), OPEN periods only, with a „разлики“ report.
 *
 * - {@link noteRepostChange}: called by the screens that save such a change. Per firm: when the owner switched the
 *   step on (`firms.settings.autoSteps.repost`, OFF by default) a run is queued (the caller enqueues the returned
 *   runs after its commit); otherwise the firm gets a „Прекнижи“ suggestion (`due`), nothing is re-posted.
 * - {@link requestRepost}: „Прекнижи“ on the suggestion (a person confirmed) → a queued run.
 * - {@link runFirmRepost}: the job. ONE transaction per firm: the konto totals of the year before, the existing
 *   re-posting (`repostYear`: invoices, purchases, daily turnover, payroll; each document in its savepoint, a locked
 *   period / closed VAT period / locked payroll is skipped) and the bank statements of the year (`postStatement`,
 *   a locked period / nalog skipped), the totals after → the differences per konto. Audited `autoRepost`.
 * State per firm in `app_settings` (`repost:<firmId>`): the pending suggestion and the last run with its report.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { autoSteps } from '@wise/core';
import { repostDiffs, type KontoDiff, type KontoTotals, type RepostReason } from '@wise/core/repost';
import { audit, type Tx } from './audit';
import { bankKontaAllFirms, statementLockTest } from './bank/konta-all';
import { loadBankEnv } from './bank/context';
import { postStatement } from './bank/posting';
import { repostYear } from './repost';
import { appSettings, bankStatements, firms, journalLines, journals } from './schema/index';

export const REPOST_JOB = 'books.repost';
export const repostKey = (firmId: string) => `repost:${firmId}`;

export interface RepostRun {
  runId: string;
  status: 'queued' | 'running' | 'done' | 'error';
  reason: RepostReason;
  year: number;
  userId: string | null;
  /** Queued automatically (owner switch) or confirmed by a person. */
  auto: boolean;
  at: string;
  finishedAt?: string | null;
  error?: string | null;
  result?: {
    docs: number; statements: number; locked: number; failed: number; errors: string[];
    /** Kontos whose totals of the year changed (before → after). */
    diffs: KontoDiff[];
  };
  /** The notice was closed by a user. */
  seen?: boolean;
}

export interface RepostState {
  /** „Прекнижи“ suggestion (switch off): what changed, when. */
  due?: { reason: RepostReason; year: number; at: string; by: string | null } | null;
  run?: RepostRun | null;
}

export async function repostState(tx: Tx, firmId: string): Promise<RepostState> {
  const [r] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, repostKey(firmId))).limit(1);
  return (r?.v as RepostState | undefined) ?? {};
}

async function putState(tx: Tx, firmId: string, s: RepostState, userId: string | null): Promise<void> {
  await tx.insert(appSettings).values({ key: repostKey(firmId), value: s, updatedBy: userId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: s, updatedBy: userId } });
}

/** A run still going (queued / running, updated in the last 30 minutes). */
export const repostBusy = (s: RepostState, now = Date.now()): boolean =>
  !!s.run && (s.run.status === 'queued' || s.run.status === 'running') && now - Date.parse(s.run.at) < 30 * 60_000;

/** Firms with posted journals in the year (nothing to re-post otherwise). */
async function firmsWithBooks(tx: Tx, ids: readonly string[], year: number): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const R = await tx.select({ id: journals.firmId }).from(journals)
    .where(and(inArray(journals.firmId, [...ids]), sql`${journals.date} between ${year + '-01-01'} and ${year + '-12-31'}`)).groupBy(journals.firmId);
  return new Set(R.map((r) => r.id));
}

export interface RepostNote { queue: { firmId: string; runId: string }[]; due: number }

/**
 * A change that may make posted documents differ. `firmIds: 'all'` = every real firm (the schemes are office-wide).
 * Switch on → queued run (enqueue `queue` after the commit); off → „Прекнижи“ suggestion. Audited `autoRepostNote`.
 */
export async function noteRepostChange(tx: Tx, a: { firmIds: readonly string[] | 'all'; reason: RepostReason; year: number; userId: string | null }): Promise<RepostNote> {
  const F = await bankKontaAllFirms(tx, a.firmIds === 'all' ? undefined : a.firmIds);
  const has = await firmsWithBooks(tx, F.map((f) => f.id), a.year);
  const S = has.size ? await tx.select({ id: firms.id, settings: firms.settings }).from(firms).where(inArray(firms.id, [...has])) : [];
  const out: RepostNote = { queue: [], due: 0 };
  const at = new Date().toISOString();
  for (const f of S) {
    const st = await repostState(tx, f.id);
    if (autoSteps(f.settings).repost) {
      if (repostBusy(st)) continue; // the running job reads the new rules anyway when it reaches the documents
      const run: RepostRun = { runId: randomUUID(), status: 'queued', reason: a.reason, year: a.year, userId: a.userId, auto: true, at };
      await putState(tx, f.id, { ...st, due: null, run }, a.userId);
      out.queue.push({ firmId: f.id, runId: run.runId });
    } else {
      await putState(tx, f.id, { ...st, due: { reason: a.reason, year: a.year, at, by: a.userId } }, a.userId);
      out.due++;
    }
  }
  if (S.length) await audit(tx, { userId: a.userId, firmId: a.firmIds === 'all' || a.firmIds.length !== 1 ? null : a.firmIds[0]!, action: 'autoRepostNote', entityType: 'repost', data: { reason: a.reason, year: a.year, queued: out.queue.length, due: out.due } });
  return out;
}

/** „Прекнижи“ (a person confirmed the suggestion): queue a run of the firm. Null when one is already running. */
export async function requestRepost(tx: Tx, a: { firmId: string; userId: string | null; year: number; /** a run of exactly this year; the pending suggestion stays */ forceYear?: boolean }): Promise<string | null> {
  const st = await repostState(tx, a.firmId);
  if (repostBusy(st)) return null;
  const run: RepostRun = { runId: randomUUID(), status: 'queued', reason: a.forceYear ? 'manual' : st.due?.reason ?? 'manual', year: a.forceYear ? a.year : st.due?.year ?? a.year, userId: a.userId, auto: !!a.forceYear, at: new Date().toISOString() };
  await putState(tx, a.firmId, { ...st, due: a.forceYear ? st.due : null, run }, a.userId);
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'autoRepostRequest', entityType: 'repost', entityId: run.runId, data: { reason: run.reason, year: run.year } });
  return run.runId;
}

/** Close the notice of the last run / drop the suggestion. */
export async function dismissRepost(tx: Tx, a: { firmId: string; userId: string | null; due?: boolean }): Promise<void> {
  const st = await repostState(tx, a.firmId);
  await putState(tx, a.firmId, a.due ? { ...st, due: null } : { ...st, run: st.run ? { ...st.run, seen: true } : null }, a.userId);
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'autoRepostDismiss', entityType: 'repost', data: { due: !!a.due } });
}

/** Debit / credit per konto of the firm's journals in the year (cents). */
export async function kontoTotals(tx: Tx, firmId: string, year: number): Promise<Map<string, KontoTotals>> {
  const R = await tx.select({ k: journalLines.account, d: sql<string>`coalesce(sum(${journalLines.debit}), 0)`, c: sql<string>`coalesce(sum(${journalLines.credit}), 0)` })
    .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
    .where(and(eq(journals.firmId, firmId), sql`${journals.date} between ${year + '-01-01'} and ${year + '-12-31'}`)).groupBy(journalLines.account);
  const C = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100);
  return new Map(R.map((r) => [r.k, { d: C(r.d), c: C(r.c) }]));
}

/** The re-posting of one firm and year (open periods only) with the „разлики“; inside the caller's transaction. */
export async function repostFirmYear(tx: Tx, a: { firmId: string; userId: string | null; year: number }): Promise<NonNullable<RepostRun['result']>> {
  const before = await kontoTotals(tx, a.firmId, a.year);
  const R = await repostYear(tx, { firmId: a.firmId, userId: a.userId }, a.year);
  const S = await tx.select().from(bankStatements).where(and(eq(bankStatements.firmId, a.firmId), sql`${bankStatements.date} between ${a.year + '-01-01'} and ${a.year + '-12-31'}`)).orderBy(asc(bankStatements.date));
  let statements = 0, locked = R.locked;
  if (S.length) {
    const env = await loadBankEnv(tx, a.firmId);
    const lockOf = await statementLockTest(tx, a.firmId);
    for (const st of S) {
      if (lockOf(st)) { locked++; continue; }
      await postStatement(tx, st.id, a.userId, env);
      statements++;
    }
  }
  const diffs = repostDiffs(before, await kontoTotals(tx, a.firmId, a.year));
  return { docs: R.n, statements, locked, failed: R.failed, errors: R.errors, diffs };
}

/** The worker job: runs the queued run `runId` of the firm (a newer request or a finished run → nothing). */
export async function runFirmRepost(db: Tx, firmId: string, runId: string): Promise<boolean> {
  const s = await repostState(db, firmId);
  if (!s.run || s.run.runId !== runId || s.run.status !== 'queued') return false;
  const run: RepostRun = { ...s.run, status: 'running', at: new Date().toISOString() };
  await putState(db, firmId, { ...s, run }, run.userId);
  try {
    const result = await db.transaction(async (t) => {
      const tx = t as unknown as Tx;
      const r = await repostFirmYear(tx, { firmId, userId: run.userId, year: run.year });
      await audit(tx, { userId: run.userId, firmId, action: 'autoRepost', entityType: 'repost', entityId: runId,
        data: { reason: run.reason, year: run.year, auto: run.auto, docs: r.docs, statements: r.statements, locked: r.locked, failed: r.failed, diffs: r.diffs.length } });
      return r;
    });
    const cur = await repostState(db, firmId);
    await putState(db, firmId, { ...cur, run: { ...run, status: 'done', result, finishedAt: new Date().toISOString() } }, run.userId);
  } catch (e) {
    const cur = await repostState(db, firmId);
    await putState(db, firmId, { ...cur, run: { ...run, status: 'error', error: (e as Error).message, finishedAt: new Date().toISOString() } }, run.userId);
  }
  return true;
}

/**
 * Firms that are NOT VAT payers but whose posted invoices / purchases of `year` still carry VAT or the чл. 24 receivable
 * (output VAT 23…, 1200009 on invoices; input VAT 13… on purchases) – posted while the card said „ДДВ обврзник“, or
 * before the card was corrected. Each gets a re-posting run (open periods only) with the current setting; the runs
 * are returned for the caller to enqueue. Called by the autopilot, so the books never keep a mix of the two.
 */
export async function queueNonVatRepairs(tx: Tx, year: number, firmIds?: readonly string[]): Promise<{ firmId: string; runId: string }[]> {
  // only output / input VAT kontos (230…, 130…), 1200009 and the VAT bases (994 / 999) of invoices and purchases; only
  // firms with no VAT period closed or filed in WISE this year and no locked books this year (a firm that changed its
  // VAT status mid-year keeps its earlier documents as they were)
  const R = await tx.execute(sql`select distinct j.firm_id as id from ${journalLines} jl join ${journals} j on j.id = jl.journal_id join ${firms} f on f.id = j.firm_id
    where f.vat_registered = false and f.active and j.date between ${year + '-01-01'} and ${year + '-12-31'}
      and (f.lock_date is null or f.lock_date < ${year + '-01-01'})
      and coalesce(f.settings->>'vatFrom', '') not between ${year + '-01-02'} and ${year + '-12-31'}
      and not exists (select 1 from vat_periods v where v.firm_id = f.id and v.date_to >= ${year + '-01-01'} and v.date_from <= ${year + '-12-31'} and (v.status = 'closed' or v.submitted_at is not null))
      and ((j.source_type = 'invoice' and (jl.account like '230%' or jl.account = '1200009')) or (j.source_type = 'purchase' and jl.account like '130%')
        or (j.source_type in ('invoice', 'purchase') and (jl.account like '994%' or jl.account like '999%')))
      ${firmIds?.length ? sql`and j.firm_id in (${sql.join(firmIds.map((x) => sql`${x}::uuid`), sql`, `)})` : sql``}`);
  const out: { firmId: string; runId: string }[] = [];
  for (const r of ((R as unknown as { rows?: { id: string }[] }).rows ?? (R as unknown as { id: string }[]))) {
    // once a day at most: a line a re-post cannot change (a manual correction, a locked journal) never makes a loop
    const st = await repostState(tx, r.id);
    const last = st.run?.finishedAt ?? st.run?.at;
    if (last && Date.now() - Date.parse(last) < 24 * 3600 * 1000) continue;
    const runId = await requestRepost(tx, { firmId: r.id, userId: null, year, forceYear: true });
    if (runId) out.push({ firmId: r.id, runId });
  }
  return out;
}
