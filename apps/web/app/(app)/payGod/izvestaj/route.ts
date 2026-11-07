/**
 * „🖨 Извештај“ of one withholding order (Плата › Кредити и задршки): the decision, the debt, every month withheld
 * and paid to the creditor, the rest — for the executor (ЗИ: the employer reports what was withheld) and for the
 * employee. `?id=<order>&emp=<employee>`.
 */
import { and, eq } from 'drizzle-orm';
import { LOAN_CAP_LABEL, loanCap, payLoanStatus, ppAccTxt, type PayLoan } from '@wise/core';
import { employees, loanDeductions } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt, h, htmlResponse, mmYYYY, ph, printDoc, sig } from '@/lib/payroll/html';
import { payCtx, payRoute } from '@/lib/payroll/server';

export async function GET(req: Request) {
  const g = await payRoute('payLoan');
  if (g instanceof Response) return g;
  const q = new URL(req.url).searchParams;
  const id = q.get('id') ?? '', empId = q.get('emp') ?? '';
  const [e] = /^[0-9a-f-]{36}$/i.test(empId) ? await db().select().from(employees).where(and(eq(employees.id, empId), eq(employees.firmId, g.firm.id))).limit(1) : [];
  const loans = (((e?.data ?? {}) as { loans?: PayLoan[] }).loans ?? []);
  const l = loans.find((x) => x.id === id);
  if (!e || !l) return new Response('Решението не постои.', { status: 404 });
  const ded = await loanDeductions(db(), g.firm.id, new Map([[e.id, loans]]), l.from.slice(0, 7));
  const s = payLoanStatus(loans, ded.get(e.id) ?? new Map()).find((x) => x.id === id)!;
  const M = [...(ded.get(e.id) ?? new Map())].sort(([a], [b]) => a.localeCompare(b));
  // what went to THIS order each month (tagged lines; untagged older lines were spread oldest first)
  let run = 0;
  const rows = M.map(([m, d]) => {
    const own = d.by['#' + l.id.replace(/-/g, '').slice(0, 8)] ?? 0;
    return { m, own };
  }).filter((r) => r.own > 0 || s.months.includes(r.m));
  const ctx = await payCtx(g.firm);
  const body = ph(ctx.firm, 'ИЗВЕШТАЈ ЗА ЗАДРШКИ ОД ПЛАТА', `${l.kind}${l.caseNo ? ' · ' + l.caseNo : ''}`)
    + `<table class="kv"><tbody>
      <tr><td>Должник (вработен)</td><td><b>${h(e.name)}</b>${e.embg ? ' · ЕМБГ ' + h(e.embg) : ''}</td></tr>
      <tr><td>Доверител / извршител</td><td><b>${h(l.creditor)}</b>${l.acc ? ' · сметка ' + h(ppAccTxt(l.acc, '2026-11-09')) : ''}</td></tr>
      <tr><td>Решение / предмет</td><td>${h(l.caseNo || '—')} · се одбива од ${dmy(l.from)}</td></tr>
      <tr><td>Износ на долгот</td><td>${fmt(l.total)} ден.</td></tr>
      <tr><td>Рата</td><td>${l.monthly ? fmt(l.monthly) + ' ден.' : ''}${l.pct ? ` ${l.pct}% од нето платата` : ''} · законска граница: ${h(LOAN_CAP_LABEL[loanCap(l)])}</td></tr>
    </tbody></table>`
    + `<h2>Задржано и уплатено по месеци</h2><table><thead><tr><th>Месец</th><th class="n">Задржано</th><th class="n">Вкупно отплатено</th><th class="n">Останува</th></tr></thead><tbody>`
    + rows.map((r) => { run += r.own; return `<tr><td>${mmYYYY(r.m)}</td><td class="n">${fmt(r.own)}</td><td class="n">${fmt(run)}</td><td class="n">${fmt(Math.max(0, l.total - run))}</td></tr>`; }).join('')
    + `</tbody><tfoot><tr><td>Вкупно</td><td class="n">${fmt(s.paid)}</td><td></td><td class="n">${fmt(s.closed ? 0 : s.rest)}</td></tr></tfoot></table>`
    + `<p class="muted">${s.rest > 0.009 && !s.closed ? `Останува за наплата: <b>${fmt(s.rest)} ден.</b>` : 'Долгот е намирен.'}</p>`
    + sig('Составил', 'Одговорно лице');
  return htmlResponse(printDoc(`Zadrska_${e.name}_${l.caseNo || l.creditor}`, body));
}
