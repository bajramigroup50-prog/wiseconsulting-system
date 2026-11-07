/**
 * „🧾 Задршки за месецот – кому се плаќа“ (Плата › Кредити и задршки): for the payroll month `?m=YYYY-MM`, every
 * withholding order of every employee in the order received (ЗИ: оldest first) — what is withheld this month and paid
 * to which creditor (account, case no.), the rest after it, and the orders still waiting for their turn (the legal cap
 * was taken by the older ones) or not started yet. Totals per creditor for the payments.
 */
import { and, eq } from 'drizzle-orm';
import { loanTag, payLoanStatus, ppAccTxt, type PayLoan } from '@wise/core';
import { loadRun, loanDeductions } from '@wise/db';
import { employees } from '@wise/db';
import { db } from '@/lib/db';
import { fmt, h, htmlResponse, mmYYYY, ph, printDoc, sig } from '@/lib/payroll/html';
import { payCtx, payRoute } from '@/lib/payroll/server';

export async function GET(req: Request) {
  const g = await payRoute('payLoan');
  if (g instanceof Response) return g;
  const q = new URL(req.url).searchParams;
  const m = /^\d{4}-(0[1-9]|1[0-2])$/.test(q.get('m') ?? '') ? q.get('m')! : new Date().toISOString().slice(0, 7);
  const E = (await db().select().from(employees).where(and(eq(employees.firmId, g.firm.id)))).map((e) => ({ e, L: (((e.data ?? {}) as { loans?: PayLoan[] }).loans ?? []) })).filter((x) => x.L.length);
  const ctx = await payCtx(g.firm);
  const run = await loadRun(db(), g.firm.id, { month: m });
  const from = E.flatMap((x) => x.L.map((l) => l.from.slice(0, 7))).sort()[0] ?? m;
  // deductions up to and including the month (the month's own run, when made)
  const all = await loanDeductions(db(), g.firm.id, new Map(E.map((x) => [x.e.id, x.L])), from);
  type Row = { emp: string; pos: number; l: PayLoan; now: number; paid: number; rest: number; state: string };
  const rows: Row[] = [];
  for (const { e, L } of E) {
    const D = all.get(e.id) ?? new Map();
    const S = payLoanStatus(L, D);
    const nowBy = D.get(m)?.by ?? {};
    [...L].sort((a, b) => a.from.localeCompare(b.from)).forEach((l, i) => {
      const s = S.find((x) => x.id === l.id)!;
      const now = nowBy[loanTag(l)] ?? 0;
      const state = l.closed ? 'затворено' : s.rest <= 0.009 ? 'отплатено' : l.from.slice(0, 7) > m ? `почнува ${mmYYYY(l.from.slice(0, 7))}` : now > 0 ? (s.rest > 0.009 ? 'се плаќа' : 'последна рата') : run ? 'чека ред (границата е искористена)' : 'платата за месецот не е направена';
      rows.push({ emp: e.name, pos: i + 1, l, now, paid: s.paid, rest: s.rest, state });
    });
  }
  const pay = rows.filter((r) => r.now > 0);
  const byCred = new Map<string, { acc: string; sum: number }>();
  for (const r of pay) { const k = r.l.creditor + '|' + (r.l.acc ?? ''); const x = byCred.get(k) ?? { acc: r.l.acc ?? '', sum: 0 }; x.sum += r.now; byCred.set(k, x); }
  const body = ph(ctx.firm, 'ЗАДРШКИ ОД ПЛАТА – КОМУ СЕ ПЛАЌА', `Плата за ${mmYYYY(m)}${run ? '' : ' (платата за месецот сè уште не е направена)'}`)
    + `<h2>1. За плаќање овој месец</h2><table><thead><tr><th>Вработен</th><th>Ред</th><th>Доверител / извршител</th><th>Сметка</th><th>Решение</th><th class="n">За плаќање</th><th class="n">Останува</th></tr></thead><tbody>`
    + (pay.length ? pay.map((r) => `<tr><td>${h(r.emp)}</td><td>${r.pos}</td><td>${h(r.l.creditor)}</td><td>${h(r.l.acc ? ppAccTxt(r.l.acc, m + '-28') : '— нема сметка —')}</td><td>${h(r.l.caseNo ?? '')}</td><td class="n"><b>${fmt(r.now)}</b></td><td class="n">${fmt(r.rest)}</td></tr>`).join('') : '<tr><td colspan="7">Нема задршки за овој месец.</td></tr>')
    + `</tbody><tfoot><tr><td colspan="5">Вкупно за плаќање</td><td class="n">${fmt(pay.reduce((a, r) => a + r.now, 0))}</td><td></td></tr></tfoot></table>`
    + (byCred.size > 1 ? `<h2>По доверител</h2><table><thead><tr><th>Доверител</th><th>Сметка</th><th class="n">Вкупно</th></tr></thead><tbody>${[...byCred].map(([k, x]) => `<tr><td>${h(k.split('|')[0])}</td><td>${h(x.acc ? ppAccTxt(x.acc, m + '-28') : '—')}</td><td class="n">${fmt(x.sum)}</td></tr>`).join('')}</tbody></table>` : '')
    + `<h2>2. Сите решенија по ред (ЗИ: по редот на прием)</h2><table><thead><tr><th>Вработен</th><th>Ред</th><th>Доверител</th><th>Решение</th><th>Од</th><th class="n">Долг</th><th class="n">Отплатено</th><th class="n">Останува</th><th>Статус</th></tr></thead><tbody>`
    + rows.map((r) => `<tr><td>${h(r.emp)}</td><td>${r.pos}</td><td>${h(r.l.creditor)}</td><td>${h(r.l.caseNo ?? '')}</td><td>${r.l.from.split('-').reverse().join('.')}</td><td class="n">${fmt(r.l.total)}</td><td class="n">${fmt(r.paid)}</td><td class="n">${fmt(r.rest)}</td><td>${h(r.state)}</td></tr>`).join('')
    + `</tbody></table><p class="muted">Кога едно решение ќе се отплати, следното по ред почнува само од наредната плата. Налозите (КТД) до доверителите се во „Налози за плаќање“ на платата.</p>`
    + sig('Составил', 'Одговорно лице');
  return htmlResponse(printDoc(`Zadrski_${m}`, body, { land: true }));
}
