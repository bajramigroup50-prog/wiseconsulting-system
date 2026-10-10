'use server';
/** Legacy `ACT.lrPdf` (16655): the review as a server PDF (worker `pdf.render`). */
import { redirect } from 'next/navigation';
import { lrByLaw, LR_IC_PDF, LR_LAWS } from '@wise/core/law';
import { audit, lawReview } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { currentYear } from '@/lib/context';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { renderPdf } from '@/lib/jobs';
import { officeAction, officeError, today } from '@/lib/office';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export async function lawrepPdf(): Promise<ActionState> {
  let id = '';
  try {
    const { u, firm } = await officeAction('office');
    const year = await currentYear();
    const X = await lawReview(db(), firm, year, today());
    const html = `<h1>ПРЕЛИМИНАРЕН ДАНОЧЕН ПРЕГЛЕД</h1><p>${esc(firm.name)} · година ${year} · состојба на ${today().split('-').reverse().join('.')}</p>`
      + `<p>Прекршувања: <b>${X.bad}</b> · за проверка: <b>${X.warn}</b> · можна изложеност (данок + камата): <b>${fmt(X.exp)} ден.</b></p>`
      + lrByLaw(X).map((g) => `<h2>${esc(g.name)}</h2><table style="width:100%;table-layout:fixed;font-size:8.5pt"><colgroup><col style="width:4%"><col style="width:30%"><col style="width:36%"><col style="width:30%"></colgroup><thead><tr><th></th><th>Правило (член)</th><th>Што најдовме</th><th>Можна последица / што да се направи</th></tr></thead><tbody>`
        + g.rows.map((x) => `<tr><td>${LR_IC_PDF[x.s]}</td><td><b>${esc(x.r.t)}</b><div style="font-size:11px">${esc(LR_LAWS[g.law][0].replace(/\s*\(.*\)/, ''))}, ${esc(x.r.art)}</div></td><td>${esc(x.txt)}</td><td>${x.amt ? `<b>≈ ${fmt(x.amt)} ден.</b><br>` : ''}${x.how ? esc(x.how) + '<br>' : ''}${x.fix ? '<i>' + esc(x.fix) + '</i>' : ''}</td></tr>`).join('')
        + '</tbody></table>').join('')
      + '<p style="font-size:8pt;margin-top:8px">Прелиминарна интерна контрола врз основа на книжењата. Износите се проценка. Камата според ЗДП: 0,03% дневно.</p>'
      + '<table style="margin-top:30px;width:100%;border:0"><tr><td style="border:0">Сметководител<br><br>______________________</td><td style="border:0;text-align:right">Управител<br><br>______________________</td></tr></table>';
    id = await renderPdf({ html, title: `Даночен преглед ${firm.name} ${year}`, firmId: firm.id, userId: u.id });
    await db().transaction((tx) => audit(tx, { userId: u.id, firmId: firm.id, action: 'lrPdf', entityType: 'file', entityId: id, data: { year } }));
  } catch (e) { return officeError(e); }
  redirect(`/lawrep?pdf=${id}`);
}
