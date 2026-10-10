/** Legacy `payContent` 6176 → 14409 ("Содржина на пресметка"), with `payDoneModal` / slips / MPIN / orders actions. */
import Link from 'next/link';
import { and, asc, desc, eq, gte, like, sql } from 'drizzle-orm';
import { monthHours, monthSplit, mpinParamDiff, payNotesOpen, resolvePayParams } from '@wise/core';
import { payRateWarnNeeded } from '@wise/core/payroll/params';
import { auditLog, journals, lawChanges, loadRun, mailLog, payrollExports, payrollNotes } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { coreEmp, firmEmployees, monthOr404, payCtx, payPage } from '@/lib/payroll/server';
import { dmyHm, Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { NewMonth } from '../new-month';
import { RunEditor } from './run-editor';

export default async function RunPage({ params, searchParams }: { params: Promise<{ month: string }>; searchParams: Promise<{ e?: string }> }) {
  const month = monthOr404((await params).month);
  const initialEmp = (await searchParams).e;
  const { u, firm } = await payPage('plati');
  if (!firm) return <NoFirm t="Пресметка на плата" />;
  const run = await loadRun(db(), firm.id, { month });
  if (!run) {
    return (
      <>
        <Hd t="Содржина на пресметка" sub={month.split('-').reverse().join('/') + ' · не е креирана'}><Link className="btn" href="/plati">← Избор на месец</Link></Hd>
        {canDo(u, 'write', firm.id) ? <NewMonth next={month} full /> : <div className="card empty">Платата за овој месец не е пресметана.</div>}
      </>
    );
  }
  const [ctx, emps, notes, mails, exportsRows, jr] = await Promise.all([
    payCtx(firm), firmEmployees(firm.id),
    db().select().from(payrollNotes).where(and(eq(payrollNotes.firmId, firm.id), eq(payrollNotes.done, false))),
    db().select({ entityId: mailLog.entityId, entityType: mailLog.entityType, status: mailLog.status, error: mailLog.error, to: mailLog.to, createdAt: mailLog.createdAt })
      .from(mailLog).where(and(eq(mailLog.firmId, firm.id), like(mailLog.entityId, `${run.id}%`))).orderBy(desc(mailLog.createdAt)).limit(500),
    db().select({ id: payrollExports.id, kind: payrollExports.kind, name: payrollExports.name, createdAt: payrollExports.createdAt, info: payrollExports.info })
      .from(payrollExports).where(eq(payrollExports.runId, run.id)).orderBy(desc(payrollExports.createdAt)).limit(10),
    run.journalId ? db().select({ number: journals.number }).from(journals).where(eq(journals.id, run.journalId)).limit(1) : Promise.resolve([]),
  ]);
  const [imp] = run.status === 'draft' ? await db().select({ data: auditLog.data }).from(auditLog)
    .where(and(eq(auditLog.firmId, firm.id), eq(auditLog.action, 'plxImp'), eq(auditLog.entityId, run.id))).orderBy(desc(auditLog.at)).limit(1) : [];
  const importNote = imp?.data ? { file: String(imp.data.file ?? ''), warn: (Array.isArray(imp.data.warn) ? imp.data.warn : []).map(String) } : null;
  let rateWarn: { law: string | null } | null = null;
  if (payRateWarnNeeded(month, ctx.overrides)) {
    const [law] = await db().select({ title: lawChanges.title }).from(lawChanges)
      .where(and(gte(lawChanges.from, '2027-01'), sql`${lawChanges.impact} ? 'plati'`)).orderBy(asc(lawChanges.from)).limit(1);
    rateWarn = { law: law?.title ?? null };
  }
  const official = { ...resolvePayParams({}, month, ctx.overrides), hours: monthHours(month) };
  const mailByEmp: Record<string, { status: string; error: string | null; at: string; to: string }> = {};
  for (const m of mails) {
    const k = m.entityType === 'payroll_emp' ? (m.entityId ?? '').split(':')[1] ?? '' : '*';
    if (!mailByEmp[k]) mailByEmp[k] = { status: m.status, error: m.error, at: dmyHm(m.createdAt), to: m.to.join(', ') };
  }
  const E = emps.map(coreEmp);
  return (
    <RunEditor
      run={{ id: run.id, month: run.month, status: run.status, locked: run.locked, params: run.params, emps: run.emps }}
      employees={E}
      psif={ctx.psif}
      official={official}
      split={monthSplit(month)}
      journalNumber={jr[0]?.number ?? null}
      openNotes={payNotesOpen(notes, month).map((n) => `${n.type}${n.empName ? ' – ' + n.empName : ''}${n.text ? ': ' + n.text : ''}`)}
      mpinDiff={mpinParamDiff(month, run.params)}
      mails={mailByEmp}
      exports={exportsRows.map((x) => ({ id: x.id, kind: x.kind, name: x.name, at: dmyHm(x.createdAt) }))}
      groupMail={ctx.settings.groupMail}
      firmEmail={ctx.firm.email}
      canWrite={canDo(u, 'write', firm.id)}
      canDel={canDo(u, 'del', firm.id)}
      importNote={importNote}
      rateWarn={rateWarn}
      initialEmp={initialEmp}
    />
  );
}
