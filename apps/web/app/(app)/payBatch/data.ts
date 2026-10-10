import 'server-only';
/**
 * Payroll for all firms (legacy `pbBuild` / `pbStatus` / `pbTot` 15283–15297). The draft is the same as „Нов месец“
 * on Плати (`payDraft`, or `payCopyPrev` for "like the previous month": same employees and fixed deductions, hours by
 * the calendar, no overtime / bonuses).
 */
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { empCalc, payCopyPrev, payDraft, payNotesOpen, type PayEmp, type PayParams } from '@wise/core';
import { loadRun, payrollNotes, payrollRuns, type Firm, type Tx } from '@wise/db';
import { db } from '@/lib/db';
import { coreEmp, firmEmployees, payCtx } from '@/lib/payroll/server';

export type PbMode = 'prev' | 'cal';
export type PbSt = 'ready' | 'auto' | 'done' | 'notes' | 'excel' | 'lock' | 'noemp';
export const PB_ST: Record<PbSt, [string, string]> = {
  ready: ['🟢 Преглед – чека потврда', 'good'], auto: ['🤖 Автоматски подготвена', 'info'], done: ['✓ Пресметана', 'good'], notes: ['⛔ Чека промени', 'bad'],
  excel: ['📥 Секој месец од Excel', 'warn'], lock: ['🔒 Периодот е заклучен', 'warn'], noemp: ['— Нема вработени', ''],
};

export interface PbTot { g: number; n: number; k: number }
export const pbTot = (emps: readonly PayEmp[], P: PayParams): PbTot => {
  let g = 0, n = 0;
  for (const e of emps) { try { const c = empCalc(e, P); g += c.T.gross + (c.T.dopl || 0); n += c.T.net; } catch { /* incomplete employee */ } }
  return { g, n, k: emps.length };
};

/** Legacy `pbBuild` (without saving). Null when there is nobody to pay. */
export async function pbBuild(tx: Tx, firm: Firm, month: string, mode: PbMode): Promise<{ params: PayParams; emps: PayEmp[] } | null> {
  const ctx = await payCtx(firm, tx);
  const E = (await firmEmployees(firm.id, tx)).map(coreEmp);
  const d = payDraft(month, E, ctx.overrides);
  let emps: PayEmp[] = d.emps.map((e) => ({ ...e, lines: e.lines!.map((l) => ({ ...l, cat: 'reg' as const })) }));
  if (mode === 'prev') {
    const [p] = await tx.select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.firmId, firm.id), lt(payrollRuns.month, month))).orderBy(desc(payrollRuns.month)).limit(1);
    const prev = p ? await loadRun(tx, firm.id, { id: p.id }) : null;
    if (prev?.emps.length) emps = payCopyPrev(month, prev.emps, d.params);
  }
  return emps.length ? { params: d.params, emps } : null;
}

export interface PbRow { f: Firm; st: PbSt; notes: { type: string; empName: string | null; text: string | null }[]; act: number; tot: PbTot | null; source?: string; locked?: boolean; preview?: PayEmp[]; params?: PayParams }

/** Legacy `pbStatus` for every firm (+ the preview of the ready ones). */
export async function pbScan(F: readonly Firm[], month: string, mode: PbMode): Promise<PbRow[]> {
  const ids = F.map((f) => f.id);
  if (!ids.length) return [];
  const [runs, notes] = await Promise.all([
    db().select().from(payrollRuns).where(and(inArray(payrollRuns.firmId, ids), eq(payrollRuns.month, month))),
    db().select().from(payrollNotes).where(and(inArray(payrollNotes.firmId, ids), eq(payrollNotes.done, false))),
  ]);
  const ms = month + '-01', me = month + '-31';
  const out: PbRow[] = [];
  for (const f of F) {
    const run = runs.find((r) => r.firmId === f.id);
    const N = payNotesOpen(notes.filter((n) => n.firmId === f.id), month).map((n) => ({ type: n.type, empName: n.empName, text: n.text }));
    const E = await firmEmployees(f.id);
    const act = E.filter((e) => e.active && (!e.start || e.start <= me) && (!e.end || e.end >= ms)).length;
    if (run) {
      const R = await loadRun(db(), f.id, { id: run.id });
      out.push({ f, st: run.source.startsWith('auto') ? 'auto' : 'done', notes: N, act, tot: R ? pbTot(R.emps, R.params) : null, source: run.source, locked: run.locked });
      continue;
    }
    if (N.length) { out.push({ f, st: 'notes', notes: N, act, tot: null }); continue; }
    if (!act) { out.push({ f, st: 'noemp', notes: N, act, tot: null }); continue; }
    if (f.lockDate && f.lockDate >= ms) { out.push({ f, st: 'lock', notes: N, act, tot: null }); continue; }
    if ((f.settings as { payManual?: boolean }).payManual) { out.push({ f, st: 'excel', notes: N, act, tot: null }); continue; }
    const d = await pbBuild(db(), f, month, mode).catch(() => null);
    out.push({ f, st: d ? 'ready' : 'noemp', notes: N, act, tot: d ? pbTot(d.emps, d.params) : null, ...(d ? { preview: d.emps, params: d.params } : {}) });
  }
  return out.sort((a, b) => a.f.name.localeCompare(b.f.name, 'mk'));
}
