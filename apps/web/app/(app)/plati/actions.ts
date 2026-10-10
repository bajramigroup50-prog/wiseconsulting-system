'use server';
/**
 * Payroll run actions (legacy ACT `payNewM`, `ppMake`, `savePay2`, `payDelM`, `payLockM`, `payCalcAll`, pay notes `pn*`,
 * payslip e-mail `pdMailGo`). Everything goes through the `@wise/db` payroll service (one write path, FIX #18).
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, asc, desc, eq, like, lt } from 'drizzle-orm';
import { z } from 'zod';
import { payCopyPrev, payDraft, type PayEmp, type PayParams } from '@wise/core';
import {
  audit, deleteRun, employees, getOfficeProfile, loadRun, payrollNotes, payrollRuns, payrollSettings, postRun, saveRun, setRunLocked, textMailHtml, unpostRun, type PdfMailJob,
} from '@wise/db';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { dispatchMail, queueMail, splitAddresses, validAddresses } from '@/lib/mail';
import { dispatchPdfMail, queuePdfMail } from '@/lib/pdf-mail';
import { fname, mmYYYY, monthName } from '@/lib/payroll/html';
import { coreEmp, firmEmployees, isMonth, payAction, payCtx, payError } from '@/lib/payroll/server';
import { slipHtml } from '@/lib/payroll/slip';

const rev = (month?: string) => {
  revalidatePath('/plati');
  if (month) revalidatePath(`/plati/${month}`);
};

/** New month (legacy `payNewM` / `ppMake`): calendar proposal or "like the previous month". Existing month → open it. */
export async function createRun(_prev: ActionState, form: FormData): Promise<ActionState> {
  const month = String(form.get('month') ?? '').trim();
  const mode = form.get('mode') === 'prev' ? 'prev' : 'cal';
  try {
    if (!isMonth(month)) return { error: 'Внесете месец во облик ГГГГ-ММ.' };
    const { u, firm } = await payAction('payNewM');
    await db().transaction(async (tx) => {
      const [ex] = await tx.select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.firmId, firm.id), eq(payrollRuns.month, month))).limit(1);
      if (ex) return;
      const ctx = await payCtx(firm, tx);
      const E = (await firmEmployees(firm.id, tx)).map(coreEmp);
      const d = payDraft(month, E, ctx.overrides);
      let emps: PayEmp[] = d.emps.map((e) => ({ ...e, lines: e.lines!.map((l) => ({ ...l, cat: 'reg' as const })) }));
      if (mode === 'prev') {
        const [p] = await tx.select({ id: payrollRuns.id }).from(payrollRuns)
          .where(and(eq(payrollRuns.firmId, firm.id), lt(payrollRuns.month, month))).orderBy(desc(payrollRuns.month)).limit(1);
        const prev = p ? await loadRun(tx, firm.id, { id: p.id }) : null;
        if (prev?.emps.length) emps = payCopyPrev(month, prev.emps, d.params);
      }
      await saveRun(tx, { firmId: firm.id, month, params: d.params, emps, userId: u.id, source: mode });
    });
  } catch (e) { return payError(e); }
  rev(month);
  redirect(`/plati/${month}`);
}

const RunInput = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  runId: z.string().uuid().nullable(),
  params: z.record(z.string(), z.unknown()),
  emps: z.array(z.object({ empId: z.string(), name: z.string().min(1), lines: z.array(z.object({ type: z.string() }).passthrough()) }).passthrough()).max(2000),
  post: z.boolean(),
});

export interface RunResult extends ActionState { runId?: string; number?: string }

/** Save the run (legacy draft), and with `post` calculate and book it (legacy `savePay2`, F4). */
export async function saveRunAction(input: { month: string; runId: string | null; params: Partial<PayParams>; emps: PayEmp[]; post: boolean }): Promise<RunResult> {
  try {
    const v = RunInput.safeParse(input);
    if (!v.success) return { error: 'Неважечки податоци за пресметката.' };
    const { u, firm } = await payAction('savePay2');
    const r = await db().transaction(async (tx) => {
      const s = await saveRun(tx, { firmId: firm.id, month: input.month, params: input.params, emps: input.emps, userId: u.id, runId: input.runId });
      if (input.post && !s.posted) {
        const j = await postRun(tx, { firmId: firm.id, runId: s.id, userId: u.id });
        return { runId: s.id, number: j.number };
      }
      return { runId: s.id };
    });
    rev(input.month);
    return { ...r, ok: input.post ? `Платата за ${mmYYYY(input.month)} е пресметана и прокнижена${r.number ? ' (налог ' + r.number + ')' : ''}.` : 'Зачувано.' };
  } catch (e) { return payError(e); }
}

export async function unpostRunAction(runId: string): Promise<ActionState> {
  try {
    const { u, firm } = await payAction('payUnpost');
    await db().transaction((tx) => unpostRun(tx, { firmId: firm.id, runId, userId: u.id }));
  } catch (e) { return payError(e); }
  rev();
  return { ok: 'Налогот е отпокнижен; пресметката остана зачувана.' };
}

export async function deleteRunAction(runId: string): Promise<ActionState> {
  let month = '';
  try {
    const { u, firm } = await payAction('del');
    await db().transaction(async (tx) => {
      const r = await loadRun(tx, firm.id, { id: runId });
      month = r?.month ?? '';
      await deleteRun(tx, { firmId: firm.id, runId, userId: u.id });
    });
  } catch (e) { return payError(e); }
  rev(month);
  redirect('/plati');
}

export async function lockRunAction(runId: string, locked: boolean): Promise<ActionState> {
  try {
    const { u, firm } = await payAction('payLockM');
    await db().transaction((tx) => setRunLocked(tx, { firmId: firm.id, runId, locked, userId: u.id }));
  } catch (e) { return payError(e); }
  rev();
  return { ok: locked ? 'Месецот е заклучен.' : 'Месецот е отклучен.' };
}

/** Recalculate and re-post every unlocked, posted month of the year (legacy `payCalcAll`). */
export async function recalcAllAction(year: number): Promise<ActionState> {
  let n = 0;
  try {
    const { u, firm } = await payAction('payCalcAll');
    const runs = await db().select().from(payrollRuns)
      .where(and(eq(payrollRuns.firmId, firm.id), like(payrollRuns.month, `${year}-%`), eq(payrollRuns.locked, false))).orderBy(asc(payrollRuns.month));
    for (const r of runs) {
      await db().transaction(async (tx) => {
        if (r.status === 'posted') { await postRun(tx, { firmId: firm.id, runId: r.id, userId: u.id }); n++; }
      });
    }
  } catch (e) { return payError(e); }
  rev();
  return { ok: `Пресметани и прокнижени повторно: ${n} месеци.` };
}

/* ---------------- Pay-change notes (legacy pn*, FIX #4: own table) ---------------- */

const NoteInput = z.object({
  id: z.string().uuid().nullable(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Изберете месец.'),
  type: z.string().min(1).max(100),
  employeeId: z.string().uuid().nullable(),
  empName: z.string().trim().max(200),
  amount: z.string().trim().transform((s) => (s ? s.replace(',', '.') : null)).refine((s) => s == null || Number.isFinite(+s), 'Износ.'),
  text: z.string().trim().max(1000),
});

export async function saveNoteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await payAction('pnSaveGo');
    const g = (k: string) => String(form.get(k) ?? '');
    const v = NoteInput.safeParse({ id: g('id') || null, month: g('month'), type: g('type'), employeeId: g('employeeId') || null, empName: g('empName'), amount: g('amount'), text: g('text') });
    if (!v.success) return { error: v.error.issues[0]?.message ?? 'Неважечки податоци.' };
    const x = v.data;
    if (!x.text && !x.employeeId && !x.empName) return { error: 'Внесете опис или вработен.' };
    await db().transaction(async (tx) => {
      let empName = x.empName || null;
      if (x.employeeId) {
        const [e] = await tx.select({ name: employees.name }).from(employees).where(and(eq(employees.id, x.employeeId), eq(employees.firmId, firm.id))).limit(1);
        empName = e?.name ?? empName;
      }
      const row = { month: x.month, type: x.type, employeeId: x.employeeId, empName, amount: x.amount, text: x.text || null };
      if (x.id) await tx.update(payrollNotes).set(row).where(and(eq(payrollNotes.id, x.id), eq(payrollNotes.firmId, firm.id)));
      else await tx.insert(payrollNotes).values({ ...row, firmId: firm.id, createdBy: u.id });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'pnSaveGo', entityType: 'payroll_note', entityId: x.id ?? undefined, data: { type: x.type, empName, month: x.month } });
    });
  } catch (e) { return payError(e); }
  rev();
  return { ok: 'Зачувано.' };
}

export async function noteDoneAction(id: string, done: boolean, month: string | null): Promise<ActionState> {
  try {
    const { u, firm } = await payAction(done ? 'pnDone' : 'pnUndo');
    await db().transaction(async (tx) => {
      await tx.update(payrollNotes).set(done ? { done, doneAt: new Date(), doneBy: u.id, doneMonth: month } : { done, doneAt: null, doneBy: null, doneMonth: null })
        .where(and(eq(payrollNotes.id, id), eq(payrollNotes.firmId, firm.id)));
      await audit(tx, { userId: u.id, firmId: firm.id, action: done ? 'pnDone' : 'pnUndo', entityType: 'payroll_note', entityId: id });
    });
  } catch (e) { return payError(e); }
  rev();
  return { ok: 'Зачувано.' };
}

export async function deleteNoteAction(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await payAction('del');
    await db().transaction(async (tx) => {
      await tx.delete(payrollNotes).where(and(eq(payrollNotes.id, id), eq(payrollNotes.firmId, firm.id)));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'pnDel', entityType: 'payroll_note', entityId: id });
    });
  } catch (e) { return payError(e); }
  rev();
  return { ok: 'Избришано.' };
}

/* ---------------- Payslip e-mail (legacy pdMailAll / pdMailGo, Gmail → mail.send) ---------------- */

export interface MailSlipsInput {
  runId: string;
  mode: 'each' | 'one' | 'grp';
  /** mode `one`: addresses. */
  to?: string;
  /** mode `grp`: group by `oe` or `city`, and the address per group. */
  groupBy?: 'oe' | 'city';
  groups?: Record<string, string>;
}

/**
 * Queue payslip e-mails with the payslips as a PDF attachment (legacy `pdMailGo` 8288–8305: `Presmetki_<month>.pdf`,
 * `Presmetka_<month>_<name>.pdf`, per group `Presmetki_<month>_<group>.pdf`), rendered by the worker's `pdf.mail`.
 */
export async function mailSlipsAction(input: MailSlipsInput): Promise<ActionState> {
  let ids: PdfMailJob[] = [];
  let skipped: string[] = [];
  try {
    const { u, firm } = await payAction('pdMailGo');
    ids = await db().transaction(async (tx) => {
      const run = await loadRun(tx, firm.id, { id: input.runId });
      if (!run) throw new MailErr('Пресметката не постои.');
      if (run.status !== 'posted') throw new MailErr('Прво пресметајте и прокнижете ја платата (F4), па испратете ги пресметките.');
      const ctx = await payCtx(firm, tx);
      const E = new Map((await firmEmployees(firm.id, tx)).map((e) => [e.id, e]));
      const mm = mmYYYY(run.month);
      const O = (await getOfficeProfile(tx)) as { rep?: string; brand?: string; name?: string; sig?: string | null };
      const slip = (e: PayEmp) => slipHtml(run, e, ctx.firm, E.get(e.empId) ?? null, { rep: O.rep, brand: O.brand || O.name, sig: O.sig, user: u.name });
      const pdf = (title: string, emps: PayEmp[]) => ({ title, html: `<div class="pdfdoc">${emps.map((e, i) => (i ? '<div style="page-break-before:always"></div>' : '') + slip(e)).join('')}</div>` });
      const out: PdfMailJob[] = [];
      const base = { firmId: firm.id, userId: u.id };
      if (input.mode === 'one') {
        const to = splitAddresses(input.to ?? '');
        if (!validAddresses(to)) throw new MailErr('Внесете валидна е-пошта.');
        out.push(await queuePdfMail(tx, { ...base, to, subject: `Пресметки на плата ${mm} – ${ctx.firm.name}`, html: textMailHtml(`Почитувани,\n\nВо прилог се пресметките на плата за ${mm} за сите вработени (${run.emps.length}).\n\nСо почит,\n${u.name}`), entityType: 'payroll_run', entityId: run.id },
          pdf(`Presmetki_${run.month}`, run.emps)));
      } else if (input.mode === 'grp') {
        const by = input.groupBy === 'city' ? 'city' : 'oe';
        const G = new Map<string, PayEmp[]>();
        for (const e of run.emps) {
          const k = String(E.get(e.empId)?.[by] ?? '').trim() || `(без ${by === 'city' ? 'град' : 'ОЕ'})`;
          (G.get(k) ?? G.set(k, []).get(k)!).push(e);
        }
        const map = { ...((await tx.select().from(payrollSettings).where(eq(payrollSettings.firmId, firm.id)))[0]?.groupMail ?? {}) };
        for (const [k, v] of Object.entries(input.groups ?? {})) map[`${by}:${k}`] = v.trim();
        const bad = [...G.keys()].filter((k) => map[`${by}:${k}`] && !validAddresses(map[`${by}:${k}`]!));
        if (bad.length) throw new MailErr('Неточна е-пошта за: ' + bad.join(', '));
        await tx.insert(payrollSettings).values({ firmId: firm.id, groupMail: map, updatedBy: u.id })
          .onConflictDoUpdate({ target: payrollSettings.firmId, set: { groupMail: map, updatedBy: u.id } });
        for (const [k, emps] of G) {
          const to = map[`${by}:${k}`];
          if (!to) { skipped.push(k); continue; }
          out.push(await queuePdfMail(tx, { ...base, to, subject: `Пресметки на плата ${mm} – ${k} – ${ctx.firm.name}`, html: textMailHtml(`Почитувани,\n\nВо прилог се пресметките на плата за ${mm} за вработените во ${k} (${emps.length}):\n${emps.map((e) => '• ' + e.name).join('\n')}\n\nСо почит,\n${u.name}`), entityType: 'payroll_run', entityId: run.id },
            pdf(`Presmetki_${run.month}_${fname(k).slice(0, 30)}`, emps)));
        }
        if (!out.length) throw new MailErr('Внесете е-пошта барем за една група.');
      } else {
        for (const e of run.emps) {
          const to = E.get(e.empId)?.email ?? '';
          if (!validAddresses(to)) { skipped.push(e.name); continue; }
          out.push(await queuePdfMail(tx, { ...base, to, subject: `Пресметка на плата ${mm} – ${e.name}`, html: textMailHtml(`Почитуван/а ${e.name},\n\nВо прилог е Вашата пресметка на плата за ${mm}.\n\nСо почит,\n${ctx.firm.name}`), entityType: 'payroll_emp', entityId: `${run.id}:${e.empId}` },
            pdf(`Presmetka_${run.month}_${fname(e.name)}`, [e])));
        }
        if (!out.length) throw new MailErr('Ниту еден вработен нема внесена е-пошта.');
      }
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'pdMailGo', entityType: 'payroll_run', entityId: run.id, data: { mode: input.mode, messages: out.length, skipped } });
      return out;
    });
  } catch (e) {
    if (e instanceof MailErr) return { error: e.message };
    return payError(e);
  }
  const failed = await dispatchPdfMail(ids);
  rev();
  return { ok: `Ставени во ред за испраќање: ${ids.length} пораки со PDF во прилог${failed ? ' (редот е недостапен – ќе се испратат за неколку минути)' : ''}.${skipped.length ? ' Прескокнати (без е-пошта): ' + skipped.join(', ') + '.' : ''}` };
}

class MailErr extends Error {}
