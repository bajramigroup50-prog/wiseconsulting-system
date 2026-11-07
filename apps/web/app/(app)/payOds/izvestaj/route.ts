/**
 * „🖨 Извештај за отсуства“ (Плата › Отсуства): every absence of the firm in the year (or `?k=301` only maternity) —
 * employee, kind, decision, from, to, calendar days, days remaining at today, who pays, and the status (тековно /
 * завршува наскоро / завршено / идно). Current and ending ones first.
 */
import { ABSENCE_KINDS, absenceDays } from '@wise/core';
import { firmPsif, listAbsences } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, h, htmlResponse, ph, printDoc, sig } from '@/lib/payroll/html';
import { firmEmployees, payCtx, payRoute } from '@/lib/payroll/server';

export async function GET(req: Request) {
  const g = await payRoute('payAbsence');
  if (g instanceof Response) return g;
  const q = new URL(req.url).searchParams;
  const y = /^\d{4}$/.test(q.get('y') ?? '') ? q.get('y')! : new Date().toISOString().slice(0, 4);
  const only = q.get('k') ?? '';
  const today = new Date().toISOString().slice(0, 10);
  const [E, A0, psif, ctx] = await Promise.all([firmEmployees(g.firm.id), listAbsences(db(), g.firm.id, { from: `${y}-01-01`, to: `${y}-12-31` }), firmPsif(db(), g.firm.id), payCtx(g.firm)]);
  const A = A0.filter((a) => !only || a.code === only);
  const name = (id: string) => E.find((e) => e.id === id)?.name ?? '';
  const kind = (c: string) => ABSENCE_KINDS.find((k) => k[0] === c)?.[1] ?? psif.find((p) => p.code === c)?.name ?? c;
  const soon = (d: string) => { const x = new Date(today + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 31); return d <= x.toISOString().slice(0, 10); };
  const status = (a: { from: string; to: string }) => (a.from > today ? 'идно' : a.to < today ? 'завршено' : soon(a.to) ? 'ЗАВРШУВА НАСКОРО' : 'тековно');
  const rank = (s: string) => ({ 'ЗАВРШУВА НАСКОРО': 0, тековно: 1, идно: 2, завршено: 3 } as Record<string, number>)[s] ?? 4;
  const R = A.map((a) => ({ a, st: status(a), left: a.to >= today ? absenceDays({ from: a.from > today ? a.from : today, to: a.to }) : 0 }))
    .sort((x, z) => rank(x.st) - rank(z.st) || x.a.to.localeCompare(z.a.to));
  const back = (to: string) => { const x = new Date(to + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
  const body = ph(ctx.firm, only === '301' ? 'ПОРОДИЛНИ ОТСУСТВА' : 'ОТСУСТВА НА ВРАБОТЕНИ', `${y} · состојба на ${dmy(today)}`)
    + `<table><thead><tr><th>Вработен</th><th>Вид</th><th>Решение</th><th>Од</th><th>До</th><th>Враќање на работа</th><th class="n">Денови</th><th class="n">Преостануваат</th><th>Плаќа</th><th>Статус</th></tr></thead><tbody>`
    + (R.length ? R.map(({ a, st, left }) => `<tr${st === 'ЗАВРШУВА НАСКОРО' ? ' style="background:#fff4e5;font-weight:600"' : ''}><td>${h(name(a.employeeId))}</td><td>${h(kind(a.code))}</td><td>${h(a.docNo ?? '')}</td><td>${dmy(a.from)}</td><td>${dmy(a.to)}</td><td>${dmy(back(a.to))}</td><td class="n">${absenceDays(a)}</td><td class="n">${left || ''}</td><td>${h(psif.find((p) => p.code === a.code)?.payer ?? '')}${/^20[1-7]$/.test(a.code) && absenceDays(a) > 30 ? ' → ФЗО од 31-виот ден' : ''}</td><td>${h(st)}</td></tr>`).join('') : '<tr><td colspan="10">Нема отсуства.</td></tr>')
    + `</tbody></table><p class="muted">„Завршува наскоро“ = во следните 31 ден. Известување за крајот на породилното добивате и во „🔔 Известувања“.</p>`
    + sig('Составил', 'Одговорно лице');
  return htmlResponse(printDoc(`Otsustva_${y}`, body, { land: true }));
}
