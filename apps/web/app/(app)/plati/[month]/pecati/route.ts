/**
 * Print views of a payroll month (legacy `payRecPdf` 7252, `paySlipsPdf` 7251, `paySlipPdf` 7250, `pdPrintAll` 8273):
 * `?d=rec` recap (landscape), `?d=slips` all payslips (one per page), `?d=slip&e=<employeeId>` one payslip.
 */
import { loadRun } from '@wise/db';
import { db } from '@/lib/db';
import { fname, htmlResponse, mmYYYY, printDoc } from '@/lib/payroll/html';
import { firmEmployees, isMonth, payCtx, payRoute } from '@/lib/payroll/server';
import { recapHtml, slipHtml } from '@/lib/payroll/slip';

export async function GET(req: Request, { params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  if (!isMonth(month)) return new Response('Not found', { status: 404 });
  const g = await payRoute('paySlipsPdf');
  if (g instanceof Response) return g;
  const { u, firm } = g;
  const run = await loadRun(db(), firm.id, { month });
  if (!run) return new Response('Пресметката не постои.', { status: 404 });
  const ctx = await payCtx(firm);
  const E = new Map((await firmEmployees(firm.id)).map((e) => [e.id, e]));
  const q = new URL(req.url).searchParams;
  const d = q.get('d') ?? 'slips';
  if (d === 'rec') return htmlResponse(printDoc(`Rekapitular_plati_${month}`, recapHtml(run, ctx.firm), { land: true }));
  const emps = d === 'slip' ? run.emps.filter((e) => e.empId === q.get('e')) : run.emps;
  if (!emps.length) return new Response('Вработениот не е во пресметката.', { status: 404 });
  const body = emps.map((e, i) => (i ? '<div class="pb"></div>' : '') + slipHtml(run, e, ctx.firm, E.get(e.empId) ?? null, u.name)).join('');
  const title = emps.length === 1 ? `Presmetka_${month}_${fname(emps[0]!.name)}` : `Presmetki_${month}`;
  return htmlResponse(printDoc(title + ' · ' + mmYYYY(month), body));
}
