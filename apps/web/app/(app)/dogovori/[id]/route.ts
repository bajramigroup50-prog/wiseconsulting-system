/**
 * Print a registered HR document exactly as saved (legacy `hrPdf` 7784 / `ctPdf` / `diPdf`).
 * FIX(#15): dispatch on the kind — legacy called `extHTML(e, d.snap.c, …)` for every non-contract entry and threw on
 * disciplinary documents (their snapshot has no contract).
 * With an active own Word template for the document („📄 Шаблони“: `ct` for the contract, `d:<title>` for disciplinary
 * documents) the print view and `?word=1` come from the template (legacy `ctPdf` / `diPdf` / `ctWordT` wrappers);
 * `?builtin=1` prints the program's own document.
 */
import { and, eq } from 'drizzle-orm';
import { hrCtTypeName, type HrContract, type HrDiDoc, type HrExtension } from '@wise/core';
import { hrDocTplKeys, tplCtVars, tplDiVars } from '@wise/core/office';
import { employees, hrDocs } from '@wise/db';
import { db } from '@/lib/db';
import { DOCX_MIME, attachmentName, fillOwnTemplate, ownTemplate } from '@/lib/own-template';
import { contractHtml, diDoc, diHtml, extHtml, leaveHtml, sickHtml } from '@/lib/payroll/docs';
import { fname, htmlResponse, printDoc } from '@/lib/payroll/html';
import { payCtx, payRoute } from '@/lib/payroll/server';
import { HR_LOCK_MSG, hrOfficeLocked } from '@/lib/hr-lock';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  const g = await payRoute('hrPdf');
  if (g instanceof Response) return g;
  if (await hrOfficeLocked(g.firm, g.u)) return new Response(HR_LOCK_MSG, { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const [d] = await db().select().from(hrDocs).where(and(eq(hrDocs.id, id), eq(hrDocs.firmId, g.firm.id))).limit(1);
  if (!d) return new Response('Документот не постои.', { status: 404 });
  const [e] = d.employeeId ? await db().select().from(employees).where(eq(employees.id, d.employeeId)).limit(1) : [];
  const emp = { name: d.empName, embg: e?.embg, address: e?.address, position: d.position ?? e?.position, end: e?.end };
  const f = (await payCtx(g.firm)).firm;
  const snap = d.snap as { c?: Partial<HrContract>; x?: HrExtension & HrDiDoc; start?: string; end?: string; days?: number; note?: string; year?: string };
  const code = d.code ?? '';
  const name = `${fname(d.title || d.kind)}_${fname(d.no)}_${fname(d.empName)}`;
  const q = new URL(req.url).searchParams;
  if (!q.has('builtin') && (d.kind === 'contract' || d.kind.startsWith('di-'))) {
    const x = { ...(snap.x as unknown as HrDiDoc), no: d.no };
    const t = await ownTemplate(hrDocTplKeys(d.kind, d.kind === 'contract' ? null : diDoc(f, { ...emp, ctNo: null }, x).t));
    if (t) {
      const c = snap.c ?? {};
      const vars = d.kind === 'contract'
        ? tplCtVars(emp, { ...c, no: d.no, typeName: hrCtTypeName(c.type), rep: c.rep || f.signer, repRole: c.repRole || f.signerRole })
        : tplDiVars(emp, { no: d.no, date: x.date || d.date, facts: x.facts }, { rep: f.signer, role: f.signerRole });
      const R = await fillOwnTemplate(t, g.firm, vars);
      if (q.has('word')) return new Response(Buffer.from(R.docx), { headers: { 'content-type': DOCX_MIME, 'content-disposition': attachmentName(name + '.docx') } });
      return htmlResponse(printDoc(name, R.html()));
    }
  }
  let body: string;
  if (d.kind === 'contract') body = contractHtml(f, emp, { ...(snap.c ?? {}), no: d.no }, { code });
  else if (d.kind === 'annex' || d.kind === 'odluka') body = extHtml(f, emp, snap.c ?? {}, { ...(snap.x as unknown as HrExtension), no: d.no, doc: d.kind }, code);
  else if (d.kind.startsWith('di-')) body = diHtml(f, { ...emp, ctNo: null }, { ...(snap.x as unknown as HrDiDoc), no: d.no }, code);
  else if (d.kind === 'leave') body = leaveHtml(f, emp, { no: d.no, date: d.date, start: d.start, end: d.end, days: d.days, year: snap.year }, code);
  else if (d.kind === 'sick') body = sickHtml(f, emp, { no: d.no, date: d.date, start: d.start, end: d.end, days: d.days, note: snap.note }, code);
  else return new Response('Непознат вид документ.', { status: 400 });
  return htmlResponse(printDoc(name, body));
}
