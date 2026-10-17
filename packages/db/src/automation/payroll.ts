/**
 * P36 — „Плати – нацрти“: on the configured day the payroll of every firm is prepared as a DRAFT run, a copy of the
 * previous month's run (employees, hours by the calendar, parameters — legacy `pbBuild` „како претходниот месец“,
 * the same builder as „👥 Плати – сите фирми“) saved through the payroll service (`saveRun`). Nothing is posted:
 * „Прокнижи ги избраните“ posts only the ticked drafts through the existing `postRun`.
 *
 * Skipped (and reported): a run already exists for the month, the firm brings payroll from Excel, open pay-change
 * notes, rates for 2027 not confirmed, the period is locked, no previous run to copy, nobody to pay.
 */
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { payCopyPrev, payDraft, payNotesOpen, type PayEmp, type PayParams } from '@wise/core';
import { payRateWarnNeeded } from '@wise/core/payroll/params';
import { todaySkopje } from '@wise/core/office';
import { isAutoDay, ymPrev } from '@wise/core/office/automations';
import { audit, type Tx } from '../audit';
import { loadPayOverrides, loadRun, postRun, saveRun } from '../payroll';
import { employees, payrollNotes, payrollRuns, type Employee, type Firm } from '../schema/index';
import { autoFirms, autoSettings, decideDraft, listDrafts, noteAutoRun, upsertDraft } from './common';

export const PAY_KIND = 'payroll';
/** `payroll_runs.source` of a run the automation prepared (shown „🤖 Автоматски подготвена“ on the all-firms screen). */
export const PAY_AUTO_SOURCE = 'auto-draft';

/** Employee in the shape the `@wise/core` payroll functions take. */
export const payCoreEmp = (e: Employee) => ({
  id: e.id, no: e.no ?? '', name: e.name, embg: e.embg ?? '', netBase: Number(e.netBase), coef: Number(e.coef),
  start: e.start ?? undefined, end: e.end ?? undefined, stazPrev: e.stazPrev ?? undefined, stazY: e.stazY ?? undefined,
  hNorm: e.hNorm ?? undefined, active: e.active, city: e.city ?? '', address: e.address ?? '', mpOps: e.mpOps ?? '',
  mpZan: e.mpZan ?? '', mpC26: e.mpC26 ?? '', bankAcc: e.bankAcc ?? '', bank: e.bank ?? '', email: e.email ?? '',
  position: e.position ?? '', oe: e.oe ?? '',
});

export type PayBuildMode = 'prev' | 'cal';

/**
 * Legacy `pbBuild` (without saving): the calendar draft of the active employees, or — `prev` — a copy of the last run
 * before the month. Null when there is nobody to pay. `prevMonth` = the run copied (null = none).
 */
export async function payBuildDraft(tx: Tx, firm: Pick<Firm, 'id'>, month: string, mode: PayBuildMode): Promise<{ params: PayParams; emps: PayEmp[]; prevMonth: string | null } | null> {
  const overrides = await loadPayOverrides(tx, firm.id);
  const E = (await tx.select().from(employees).where(eq(employees.firmId, firm.id))).map(payCoreEmp);
  const d = payDraft(month, E, overrides);
  let emps: PayEmp[] = d.emps.map((e) => ({ ...e, lines: e.lines!.map((l) => ({ ...l, cat: 'reg' as const })) }));
  let prevMonth: string | null = null;
  if (mode === 'prev') {
    const [p] = await tx.select({ id: payrollRuns.id, month: payrollRuns.month }).from(payrollRuns).where(and(eq(payrollRuns.firmId, firm.id), lt(payrollRuns.month, month))).orderBy(desc(payrollRuns.month)).limit(1);
    const prev = p ? await loadRun(tx, firm.id, { id: p.id }) : null;
    if (prev?.emps.length) { emps = payCopyPrev(month, prev.emps as PayEmp[], d.params, [], ['sin']); prevMonth = prev.month; } // FIX(D11): legacy pbBuild copies only `sin` lines
  }
  return emps.length ? { params: d.params, emps, prevMonth } : null;
}

export type PaySkip = 'exists' | 'excel' | 'notes' | 'rates' | 'lock' | 'noprev' | 'noemp' | 'error';
export interface AutoPayrollResult { month: string; drafts: number; skipped: Partial<Record<PaySkip, number>>; errors: string[]; ran: boolean }

const tot = (t: Record<string, number> | null | undefined) => ({ gross: Number(t?.gross) || 0, net: Number(t?.net) || 0, emps: Number(t?.emps) || 0 });

/** The month the job prepares on `today`. */
export const autoPayMonth = (today: string, which: 'prev' | 'cur') => (which === 'cur' ? today.slice(0, 7) : ymPrev(today.slice(0, 7)));

/** Daily 05:20: on the configured day, the payroll drafts of every firm. `force`: ignore switch and day (tests / run now). */
export async function runAutoPayroll(db: Tx, o: { today?: string; force?: boolean; month?: string } = {}): Promise<AutoPayrollResult> {
  const today = o.today ?? todaySkopje();
  const S = await autoSettings(db);
  const month = o.month ?? autoPayMonth(today, S.payMonth);
  const out: AutoPayrollResult = { month, drafts: 0, skipped: {}, errors: [], ran: false };
  if (!o.force && (!S.on.payroll || !isAutoDay(today, S.payDay))) return out;
  out.ran = true;
  const skip = (k: PaySkip) => { out.skipped[k] = (out.skipped[k] ?? 0) + 1; };
  const ms = month + '-01';
  for (const f of await autoFirms(db)) {
    try {
      const r = await db.transaction(async (tx): Promise<PaySkip | 'ok'> => {
        const [ex] = await tx.select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.firmId, f.id), eq(payrollRuns.month, month))).limit(1);
        if (ex) return 'exists';
        if ((f.settings as { payManual?: boolean }).payManual) return 'excel';
        // 🔒 nothing in a locked period
        if (f.lockDate && f.lockDate >= ms) return 'lock';
        if (payNotesOpen(await tx.select().from(payrollNotes).where(and(eq(payrollNotes.firmId, f.id), eq(payrollNotes.done, false))), month).length) return 'notes';
        if (payRateWarnNeeded(month, await loadPayOverrides(tx, f.id))) return 'rates';
        const d = await payBuildDraft(tx, f, month, 'prev');
        if (!d) return 'noemp';
        if (!d.prevMonth) return 'noprev';
        const s = await saveRun(tx, { firmId: f.id, month, params: d.params, emps: d.emps, userId: null, source: PAY_AUTO_SOURCE });
        const [cur] = await tx.select({ totals: payrollRuns.totals }).from(payrollRuns).where(eq(payrollRuns.id, s.id)).limit(1);
        const [pr] = await tx.select({ totals: payrollRuns.totals }).from(payrollRuns).where(and(eq(payrollRuns.firmId, f.id), eq(payrollRuns.month, d.prevMonth))).limit(1);
        await upsertDraft(tx, { kind: PAY_KIND, firmId: f.id, period: month, data: { runId: s.id, ...tot(cur?.totals), prevMonth: d.prevMonth, prev: tot(pr?.totals) } });
        return 'ok';
      });
      if (r === 'ok') out.drafts++; else skip(r);
    } catch (e) { skip('error'); out.errors.push(`${f.name}: ${(e as Error).message}`); }
  }
  const sk = Object.entries(out.skipped).map(([k, n]) => `${k} ${n}`).join(', ');
  await noteAutoRun(db, 'payroll', `${month}: нацрти ${out.drafts}${sk ? ` · прескокнати: ${sk}` : ''}`, { month, drafts: out.drafts });
  return out;
}

/** A waiting payroll draft with its run (null run = deleted / already posted elsewhere). */
export async function payDraftRows(tx: Pick<Tx, 'select'>, firmIds: readonly string[]) {
  const D = await listDrafts(tx, { kind: PAY_KIND, firmIds });
  const ids = D.map((d) => String(d.data.runId ?? '')).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const R = ids.length ? await tx.select({ id: payrollRuns.id, status: payrollRuns.status, totals: payrollRuns.totals, month: payrollRuns.month }).from(payrollRuns).where(inArray(payrollRuns.id, ids)) : [];
  return D.map((d) => ({ d, run: R.find((r) => r.id === d.data.runId) ?? null }));
}

/**
 * „Прокнижи ги избраните“: post exactly the ticked drafts (draft ids) through `postRun` (lock, notes, МПИН-double
 * checks inside), one transaction per firm; `allowed(firmId)` = the caller's permission on the firm.
 */
export async function postPayDrafts(db: Tx, a: { ids: readonly string[]; userId: string; allowed: (firmId: string) => boolean }): Promise<{ posted: string[]; skipped: string[] }> {
  const posted: string[] = [], skipped: string[] = [];
  const D = (await listDrafts(db, { kind: PAY_KIND })).filter((d) => a.ids.includes(d.id));
  for (const d of D) {
    if (!a.allowed(d.firmId)) { skipped.push(`${d.firmId}: немате право`); continue; }
    try {
      const n = await db.transaction(async (tx) => {
        const runId = String(d.data.runId ?? '');
        const [run] = await tx.select().from(payrollRuns).where(and(eq(payrollRuns.id, runId), eq(payrollRuns.firmId, d.firmId))).limit(1);
        if (!run) { await decideDraft(tx, d.id, 'dismissed', a.userId); throw new Error('пресметката е избришана'); }
        const j = run.status === 'posted' ? null : await postRun(tx, { firmId: d.firmId, runId, userId: a.userId });
        await decideDraft(tx, d.id, 'confirmed', a.userId, j ? { journal: j.number } : {});
        await audit(tx, { userId: a.userId, firmId: d.firmId, action: 'autoPayPost', entityType: 'payroll_run', entityId: runId, data: { month: d.period, journal: j?.number ?? null } });
        return j?.number ?? '';
      });
      posted.push(n);
    } catch (e) { skipped.push(`${d.period}: ${(e as Error).message}`); }
  }
  return { posted, skipped };
}
