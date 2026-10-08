/**
 * Print a registered HR document exactly as saved (legacy `hrPdf` 7784 / `ctPdf` / `diPdf`).
 * FIX(#15): dispatch on the kind — legacy called `extHTML(e, d.snap.c, …)` for every non-contract entry and threw on
 * disciplinary documents (their snapshot has no contract).
 */
import { and, eq } from 'drizzle-orm';
import type { HrContract, HrDiDoc, HrExtension } from '@wise/core';
import { employees, hrDocs } from '@wise/db';
import { db } from '@/lib/db';
import { contractHtml, diHtml, extHtml, leaveHtml, sickHtml } from '@/lib/payroll/docs';
import { fname, htmlResponse, printDoc } from '@/lib/payroll/html';
import { payCtx, payRoute } from '@/lib/payroll/server';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  const g = await payRoute('hrPdf');
  if (g instanceof Response) return g;
  const [d] = await db().select().from(hrDocs).where(and(eq(hrDocs.id, id), eq(hrDocs.firmId, g.firm.id))).limit(1);
  if (!d) return new Response('Документот не постои.', { status: 404 });
  const [e] = d.employeeId ? await db().select().from(employees).where(eq(employees.id, d.employeeId)).limit(1) : [];
  const emp = { name: d.empName, embg: e?.embg, address: e?.address, position: d.position ?? e?.position, end: e?.end };
  const f = (await payCtx(g.firm)).firm;
  const snap = d.snap as { c?: Partial<HrContract>; x?: HrExtension & HrDiDoc; start?: string; end?: string; days?: number; note?: string; year?: string };
  const code = d.code ?? '';
  let body: string;
  if (d.kind === 'contract') body = contractHtml(f, emp, { ...(snap.c ?? {}), no: d.no }, { code });
  else if (d.kind === 'annex' || d.kind === 'odluka') body = extHtml(f, emp, snap.c ?? {}, { ...(snap.x as unknown as HrExtension), no: d.no, doc: d.kind }, code);
  else if (d.kind.startsWith('di-')) body = diHtml(f, { ...emp, ctNo: null }, { ...(snap.x as unknown as HrDiDoc), no: d.no }, code);
  else if (d.kind === 'leave') body = leaveHtml(f, emp, { no: d.no, date: d.date, start: d.start, end: d.end, days: d.days, year: snap.year }, code);
  else if (d.kind === 'sick') body = sickHtml(f, emp, { no: d.no, date: d.date, start: d.start, end: d.end, days: d.days, note: snap.note }, code);
  else return new Response('Непознат вид документ.', { status: 400 });
  return htmlResponse(printDoc(`${fname(d.title || d.kind)}_${fname(d.no)}_${fname(d.empName)}`, body));
}
