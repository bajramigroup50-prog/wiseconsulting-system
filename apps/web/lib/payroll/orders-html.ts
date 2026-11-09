/**
 * Payment-order slips drawn on A4 (3 per page, 210×99 mm): КТД / КТБ from 9 Nov 2026 (ПП30 / ПП50 before),
 * with the shared layout `ppLayout` (legacy `PP_LAY` 15779 + `ppSlip` 15791), plus a summary table like legacy `payOrders`.
 */
import { ppAccTxt, ppFieldText, ppLayout, ppShort, type BankIsoRules, type PaymentOrder, type PayOrder, type PpField } from '@wise/core';
import { dmy, fmt, h, mmYYYY, ph, sig } from './html';

const ppAmt = (v: number) => (+v || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** One slip (legacy `ppSlip(n, 'full')`). */
export function ppSlipHtml(n: PayOrder, bankIso?: BankIsoRules | null): string {
  const L = ppLayout(n.kind, n.date);
  const val = (k: PpField[0], t?: PpField[7]): string => {
    if (k === 'sign') return '';
    if (t === 'amt') return n.amount == null ? '' : ppAmt(+n.amount);
    if (t === 'date') { const v = n[k as 'date']; return v ? dmy(String(v)) : ''; }
    return ppFieldText({ ...(n as unknown as PaymentOrder), bankIso }, k, t);
  };
  const fld = ([k, l, x, y, w, hh, ml, t]: PpField) =>
    `<div style="position:absolute;left:${x}mm;top:${y - 3.2}mm;font:5.6pt Arial;color:#333;white-space:nowrap">${h(l)}</div><div style="position:absolute;left:${x}mm;top:${y}mm;width:${w}mm;height:${hh}mm;border:0.25mm solid #444;box-sizing:border-box"></div>`
    + (k === 'sign' ? '' : `<div style="position:absolute;left:${x + 1}mm;top:${y + (ml ? 0.6 : hh / 2 - 2)}mm;width:${w - 2}mm;font:${t === 'acc' || t === 'amt' ? 'bold 10pt Consolas,Courier New,monospace' : '9pt Arial'};${t === 'amt' ? 'text-align:right;' : ''}white-space:${ml ? 'pre-line' : 'nowrap'};overflow:hidden;line-height:1.15">${h(val(k, t))}</div>`);
  return `<div class="ppslip" style="position:relative;width:210mm;height:99mm;overflow:hidden;box-sizing:border-box;border-bottom:0.2mm dashed #999;"><div style="position:absolute;left:5mm;top:3mm;font:bold 10.5pt Arial">${h(L.title)}</div><div style="position:absolute;right:6mm;top:3.5mm;font:7pt Arial">образец ${ppShort(n.kind, n.date)}</div>${L.f.map(fld).join('')}</div>`;
}

/** Pages of 3 slips each. */
export function ppPagesHtml(list: readonly PayOrder[], bankIso?: BankIsoRules | null): string {
  const pages: PayOrder[][] = [];
  for (let i = 0; i < list.length; i += 3) pages.push(list.slice(i, i + 3));
  return pages.map((p, i) => `<div style="width:210mm;${i ? 'page-break-before:always;' : ''}">${p.map((o) => ppSlipHtml(o, bankIso)).join('')}</div>`).join('');
}

/** Summary of the orders (legacy `payOrders` table: net per employee, contributions + PIT per fund). */
export function ordersSummaryHtml(firm: { name: string; edb: string; bankAccount: string; bankName: string }, month: string, orders: readonly PayOrder[], missing: readonly string[]): string {
  const net = orders.filter((o) => o.kind === 'pp30'), pub = orders.filter((o) => o.kind === 'pp50');
  const sum = (L: readonly PayOrder[]) => L.reduce((s, o) => s + o.amount, 0);
  return ph(firm, 'НАЛОЗИ ЗА ПЛАЌАЊЕ НА ПЛАТИ', 'Плата за ' + mmYYYY(month))
    + (missing.length ? `<div class="box" style="border-color:#b42318;color:#b42318"><b>Недостасуваат податоци:</b> ${h(missing.join('; '))}.</div>` : '')
    + `<h2>1. Нето плати (${new Date(orders[0]?.date ?? '').getTime() >= Date.parse('2026-11-09') ? 'КТД, шифра SALA' : 'ПП30, шифра 101'})</h2><table><thead><tr><th>Р.б.</th><th>Примач</th><th>Сметка на примачот</th><th>Банка</th><th>Цел на дознака</th><th class="n">Износ</th></tr></thead><tbody>`
    + net.map((o, i) => `<tr><td>${i + 1}</td><td>${h(o.recip)}</td><td>${h(ppAccTxt(o.recipAcc, o.date) || '— внесете во Вработени —')}</td><td>${h(o.recipBank)}</td><td>${h(o.purpose)}</td><td class="n">${fmt(o.amount)}</td></tr>`).join('')
    + `</tbody><tfoot><tr><td colspan="5">Вкупно нето</td><td class="n">${fmt(sum(net))}</td></tr></tfoot></table>`
    + `<h2>2. Придонеси и данок (${ppShort('pp50', orders[0]?.date)} – налози за јавни приходи)</h2><table><thead><tr><th>Вид</th><th>Трезорска сметка</th><th>Уплатна сметка</th><th>Приходна шифра</th><th>Повикување</th><th class="n">Износ</th></tr></thead><tbody>`
    + pub.map((o) => `<tr><td>${h(o.purpose)}</td><td>${h(ppAccTxt(o.recipAcc, o.date))}</td><td>${h(o.uplSm || '—')}</td><td>${h(o.prihod || '—')}</td><td>${h(o.refDebit || '')}</td><td class="n">${fmt(o.amount)}</td></tr>`).join('')
    + `</tbody><tfoot><tr><td colspan="5">Вкупно придонеси и данок</td><td class="n">${fmt(sum(pub))}</td></tr></tfoot></table>`
    + `<p class="muted">Налогодавач: ${h(firm.name)} · ЕДБ ${h(firm.edb)} · сметка ${h(firm.bankAccount)} ${h(firm.bankName)}. Уплатните сметки и приходните шифри се внесуваат во „Параметри за плата“ (по фирма) – проверете ги според упатството на УЈП пред плаќање.</p>`
    + sig('Составил', 'Одговорно лице');
}
