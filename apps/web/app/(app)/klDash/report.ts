import 'server-only';
/** Legacy `kdRepHTML` (14972): the business report for the client (printed or e-mailed). */
import { KD_EXP, MK_MON } from '@wise/core/firms/dash';
import { kdMon, type KdData } from './data';

const h = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fi = (n: number) => Math.round(n).toLocaleString('mk-MK');
const dmy = (d: string) => d.split('-').reverse().join('.');

export function kdReportHtml(R: KdData, f: { name: string; edb: string | null; address: string | null; city: string | null }, pl: string, from: string, to: string, by: string, today: string): string {
  const top = (o: Record<string, number | { n: string; v: number }>, n = 8) => Object.entries(o).map(([k, v]) => (typeof v === 'object' ? [v.n, v.v] as const : [k, v] as const))
    .filter((x) => Math.abs(x[1]) >= 0.5).sort((a, b) => b[1] - a[1]).slice(0, n);
  const tb = (t: string, L: readonly (readonly [string, number])[]) => (L.length ? `<h3 style="margin:12px 0 4px;font-size:13px">${t}</h3><table style="width:100%"><tbody>${L.map(([n, v]) => `<tr><td>${h(n)}</td><td style="text-align:right">${fi(v)}</td></tr>`).join('')}</tbody></table>` : '');
  const k = (l: string, v: string) => `<td style="border:1px solid #d0d5dd;padding:6px 8px"><div style="font-size:10px;color:#667085">${l}</div><div style="font-size:14px;font-weight:700">${v}</div></td>`;
  const M = kdMon(R);
  const mon = M.length ? `<h3 style="margin:12px 0 4px;font-size:13px">По месеци</h3><table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left">Месец</th><th style="text-align:right">Приходи</th><th style="text-align:right">Набавки</th><th style="text-align:right">Трошоци (кл. 4)</th><th style="text-align:right">Приходи − набавки</th></tr></thead><tbody>${
    M.map(([m, o]) => `<tr><td>${MK_MON[+m.slice(5) - 1]} ${m.slice(0, 4)}</td><td style="text-align:right">${fi(o.s)}</td><td style="text-align:right">${fi(o.p)}</td><td style="text-align:right">${fi(o.e)}</td><td style="text-align:right">${fi(o.s - o.p)}</td></tr>`).join('')}</tbody></table>` : '';
  return `<div style="font-family:Arial,sans-serif;font-size:11px;color:#111"><div style="border-bottom:1.5px solid #111;padding-bottom:4px"><b style="font-size:13px">${h(f.name)}</b> · ${h([f.address, f.city].filter(Boolean).join(', '))}${f.edb ? ' · ЕДБ ' + h(f.edb) : ''}</div>
<h2 style="text-align:center;margin:10px 0 2px">ИЗВЕШТАЈ ЗА РАБОТЕЊЕТО</h2><div style="text-align:center;margin:0 0 10px">${h(pl)}: ${dmy(from)} – ${dmy(to)}</div>
<table style="width:100%;border-collapse:collapse;margin:0 0 8px"><tr>${k('Вкупен промет', fi(R.sales) + ' ден')}${k('Набавки', fi(R.pur) + ' ден')}${k('Промет − набавки', fi(R.sales - R.pur) + ' ден')}${k('Трошоци (класа 4)', fi(R.expT) + ' ден')}</tr><tr>${k('Пари (банка + каса)', fi(R.cash) + ' ден')}${k('Купувачи должат', fi(R.rec) + ' ден')}${k('Должиме кон добавувачи', fi(R.pay) + ' ден')}${k('Фактури (излезни / влезни)', R.nInv + ' / ' + R.nPur)}</tr></table>
${mon}${tb('Трошоци по вид', top(Object.fromEntries(Object.entries(R.exp).map(([g, v]) => [KD_EXP[g] ?? 'Конто ' + g, v]))))}${tb('Најголеми купувачи', top(R.cust))}${tb('Најголеми добавувачи', top(R.sup))}${tb('Најпродавани артикли / услуги', top(R.items))}
<p style="font-size:10px;color:#667085;margin-top:12px">Податоците се од прокнижените документи до ${dmy(today)}. Износите се во денари. Изготвил: ${h(by)}</p></div>`;
}
