/**
 * Payment orders for a payroll month (legacy ACT `payOrders` 7795): summary + printable ПП30 slips (net pay per
 * employee, code 101) and ПП50 slips (each contribution fund and PIT). `?datum=YYYY-MM-DD` = payment date
 * (default today); `?csv=1` = net pay list for the bank (legacy `Neto_plati_banka_*.csv`).
 * FIX(#19): accounts and revenue codes come from the firm's payroll settings; missing data is listed on the page.
 */
import { payrollPaymentOrders, resolvePayParams } from '@wise/core';
import { loadRun } from '@wise/db';
import { db } from '@/lib/db';
import { toCsv } from '@/lib/fmt';
import { htmlResponse, printDoc } from '@/lib/payroll/html';
import { ordersSummaryHtml, ppPagesHtml } from '@/lib/payroll/orders-html';
import { coreEmp, firmEmployees, isMonth, payCtx, payRoute } from '@/lib/payroll/server';

export async function GET(req: Request, { params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  if (!isMonth(month)) return new Response('Not found', { status: 404 });
  const g = await payRoute('payOrders');
  if (g instanceof Response) return g;
  const run = await loadRun(db(), g.firm.id, { month });
  if (!run) return new Response('Пресметката не постои.', { status: 404 });
  const ctx = await payCtx(g.firm);
  const q = new URL(req.url).searchParams;
  const datum = /^\d{4}-\d{2}-\d{2}$/.test(q.get('datum') ?? '') ? q.get('datum')! : new Date().toISOString().slice(0, 10);
  const P = resolvePayParams(run.params, month, ctx.overrides);
  const E = (await firmEmployees(g.firm.id)).map(coreEmp);
  const r = payrollPaymentOrders(run, P, E, ctx.firm, ctx.orders, datum);
  if (q.get('csv') === '1') {
    const rows = [['Примач', 'ЕМБГ', 'Сметка', 'Банка', 'Износ', 'Цел'], ...r.orders.filter((o) => o.kind === 'pp30').map((o) => [o.recip, o.refCredit ?? '', o.recipAcc, o.recipBank, String(o.amount).replace('.', ','), o.purpose])];
    return new Response(toCsv(rows), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="Neto_plati_banka_${month}.csv"` } });
  }
  const tools = `<div class="pbar" style="background:#334"><span class="t">Датум на плаќање</span><form style="display:flex;gap:6px"><input type="date" name="datum" value="${datum}"><button>Примени</button></form><a href="?csv=1">CSV за банка (нето плати)</a></div>`;
  const html = printDoc(`Nalozi_plati_${month}`, ordersSummaryHtml(ctx.firm, month, r.orders, r.missing) + '<div class="pb"></div>' + ppPagesHtml(r.orders), { land: false });
  return htmlResponse(html.replace('<div class="page">', tools + '<div class="page">'));
}
