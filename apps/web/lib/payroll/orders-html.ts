/**
 * Payment-order slips ПП30 / ПП50 drawn on A4 (3 per page, 210×99 mm), legacy `PP_LAY` 15779 + `ppSlip` 15791
 * (full form mode), plus a summary table like legacy `payOrders`.
 */
import { ppAccTxt, type PayOrder } from '@wise/core';
import { dmy, fmt, h, mmYYYY, ph, sig } from './html';

type F = [key: keyof PayOrder | 'sign', label: string, x: number, y: number, w: number, hh: number, ml?: number, t?: 'acc' | 'amt' | 'date'];
const PP_LAY: Record<'pp30' | 'pp50', { title: string; f: F[] }> = {
  pp30: { title: 'НАЛОГ ЗА ПРЕНОС', f: [['payer', 'НАЗИВ И СЕДИШТЕ НА НАЛОГОДАВАЧ', 5, 13, 98, 11, 1], ['payerBank', 'БАНКА НА НАЛОГОДАВАЧ', 5, 27, 98, 6], ['payerAcc', 'ТРАНСАКЦИСКА СМЕТКА НА НАЛОГОДАВАЧ', 5, 36, 98, 6, 0, 'acc'], ['purpose', 'ЦЕЛ НА ДОЗНАКАТА', 5, 45, 98, 9, 1], ['code', 'ШИФРА', 5, 58, 16, 6], ['nacin', 'НАЧИН', 23, 58, 10, 6], ['amount', 'МКД  ИЗНОС', 35, 58, 68, 6, 0, 'amt'],
    ['recip', 'НАЗИВ И СЕДИШТЕ НА ПРИМАЧ', 107, 13, 98, 11, 1], ['recipBank', 'БАНКА НА ПРИМАЧ', 107, 27, 98, 6], ['recipAcc', 'ТРАНСАКЦИСКА СМЕТКА НА ПРИМАЧ', 107, 36, 98, 6, 0, 'acc'], ['refDebit', 'ПОВИКУВАЊЕ НА БРОЈ – (ЗАДОЛЖУВАЊЕ)', 107, 45, 98, 6], ['refCredit', 'ПОВИКУВАЊЕ НА БРОЈ – (ОДОБРУВАЊЕ)', 107, 54, 98, 6],
    ['place', 'МЕСТО НА ПОДНЕСУВАЊЕ', 5, 72, 40, 6], ['date', 'ДАТУМ НА ПОДНЕСУВАЊЕ', 48, 72, 30, 6, 0, 'date'], ['valDate', 'ДАТУМ НА ВАЛУТА', 81, 72, 30, 6, 0, 'date'], ['sign', 'ПОТПИС', 140, 70, 65, 14]] },
  pp50: { title: 'НАЛОГ ЗА ЈАВНИ ПРИХОДИ', f: [['payer', 'НАЗИВ И СЕДИШТЕ НА НАЛОГОДАВАЧ', 5, 13, 98, 11, 1], ['payerBank', 'БАНКА НА НАЛОГОДАВАЧ', 5, 27, 98, 6], ['payerTax', 'ДАНОЧЕН БРОЈ или (ЕМБГ)', 5, 36, 98, 6], ['purpose', 'ЦЕЛ НА ДОЗНАКА', 5, 45, 98, 9, 1], ['nacin', 'НАЧИН', 5, 58, 12, 6], ['amount', 'МКД  ИЗНОС', 20, 58, 83, 6, 0, 'amt'],
    ['recip', 'НАЗИВ И СЕДИШТЕ НА ПРИМАЧ', 107, 13, 98, 8, 1], ['recipBank', 'БАНКА НА ПРИМАЧ', 107, 24, 98, 5], ['recipAcc', 'ТРАНСАКЦИСКА СМЕТКА', 107, 32, 98, 5, 0, 'acc'], ['uplSm', 'УПЛАТНА СМЕТКА / СМЕТКА НА БУЏЕТСКИ КОРИСНИК', 107, 41, 98, 6], ['prihod', 'ПРИХОДНА ШИФРА И ПРОГРАМА', 107, 50, 98, 6], ['refDebit', 'ПОВИКУВАЊЕ НА БРОЈ – (ЗАДОЛЖУВАЊЕ)', 107, 59, 98, 6],
    ['place', 'МЕСТО НА УПЛАТА', 5, 72, 40, 6], ['date', 'ДАТУМ НА УПЛАТА', 48, 72, 30, 6, 0, 'date'], ['valDate', 'ДАТУМ НА ВАЛУТА', 81, 72, 30, 6, 0, 'date'], ['sign', 'ПОТПИС', 140, 70, 65, 14]] },
};

const ppAmt = (v: number) => (+v || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** One slip (legacy `ppSlip(n, 'full')`). */
export function ppSlipHtml(n: PayOrder): string {
  const L = PP_LAY[n.kind];
  const val = (k: F[0], t?: F[7]): string => {
    if (k === 'sign') return '';
    const v = n[k];
    if (t === 'acc') return ppAccTxt(v, n.date);
    if (t === 'amt') return v === '' || v == null ? '' : ppAmt(+v);
    if (t === 'date') return v ? dmy(String(v)) : '';
    return v == null ? '' : String(v);
  };
  const fld = ([k, l, x, y, w, hh, ml, t]: F) =>
    `<div style="position:absolute;left:${x}mm;top:${y - 3.2}mm;font:5.6pt Arial;color:#333;white-space:nowrap">${h(l)}</div><div style="position:absolute;left:${x}mm;top:${y}mm;width:${w}mm;height:${hh}mm;border:0.25mm solid #444;box-sizing:border-box"></div>`
    + (k === 'sign' ? '' : `<div style="position:absolute;left:${x + 1}mm;top:${y + (ml ? 0.6 : hh / 2 - 2)}mm;width:${w - 2}mm;font:${t === 'acc' || t === 'amt' ? 'bold 10pt Consolas,Courier New,monospace' : '9pt Arial'};${t === 'amt' ? 'text-align:right;' : ''}white-space:${ml ? 'pre-line' : 'nowrap'};overflow:hidden;line-height:1.15">${h(val(k, t))}</div>`);
  return `<div class="ppslip" style="position:relative;width:210mm;height:99mm;overflow:hidden;box-sizing:border-box;border-bottom:0.2mm dashed #999;"><div style="position:absolute;left:5mm;top:3mm;font:bold 10.5pt Arial">${h(L.title)}</div><div style="position:absolute;right:6mm;top:3.5mm;font:7pt Arial">образец ${n.kind.replace('pp', 'ПП')}</div>${L.f.map(fld).join('')}</div>`;
}

/** Pages of 3 slips each. */
export function ppPagesHtml(list: readonly PayOrder[]): string {
  const pages: PayOrder[][] = [];
  for (let i = 0; i < list.length; i += 3) pages.push(list.slice(i, i + 3));
  return pages.map((p, i) => `<div style="width:210mm;${i ? 'page-break-before:always;' : ''}">${p.map(ppSlipHtml).join('')}</div>`).join('');
}

/** Summary of the orders (legacy `payOrders` table: net per employee, contributions + PIT per fund). */
export function ordersSummaryHtml(firm: { name: string; edb: string; bankAccount: string; bankName: string }, month: string, orders: readonly PayOrder[], missing: readonly string[]): string {
  const net = orders.filter((o) => o.kind === 'pp30'), pub = orders.filter((o) => o.kind === 'pp50');
  const sum = (L: readonly PayOrder[]) => L.reduce((s, o) => s + o.amount, 0);
  return ph(firm, 'НАЛОЗИ ЗА ПЛАЌАЊЕ НА ПЛАТИ', 'Плата за ' + mmYYYY(month))
    + (missing.length ? `<div class="box" style="border-color:#b42318;color:#b42318"><b>Недостасуваат податоци:</b> ${h(missing.join('; '))}.</div>` : '')
    + `<h2>1. Нето плати (ПП30, шифра 101)</h2><table><thead><tr><th>Р.б.</th><th>Примач</th><th>Сметка на примачот</th><th>Банка</th><th>Цел на дознака</th><th class="n">Износ</th></tr></thead><tbody>`
    + net.map((o, i) => `<tr><td>${i + 1}</td><td>${h(o.recip)}</td><td>${h(ppAccTxt(o.recipAcc, o.date) || '— внесете во Вработени —')}</td><td>${h(o.recipBank)}</td><td>${h(o.purpose)}</td><td class="n">${fmt(o.amount)}</td></tr>`).join('')
    + `</tbody><tfoot><tr><td colspan="5">Вкупно нето</td><td class="n">${fmt(sum(net))}</td></tr></tfoot></table>`
    + `<h2>2. Придонеси и данок (ПП50 – налози за јавни приходи)</h2><table><thead><tr><th>Вид</th><th>Трезорска сметка</th><th>Уплатна сметка</th><th>Приходна шифра</th><th>Повикување</th><th class="n">Износ</th></tr></thead><tbody>`
    + pub.map((o) => `<tr><td>${h(o.purpose)}</td><td>${h(ppAccTxt(o.recipAcc, o.date))}</td><td>${h(o.uplSm || '—')}</td><td>${h(o.prihod || '—')}</td><td>${h(o.refDebit || '')}</td><td class="n">${fmt(o.amount)}</td></tr>`).join('')
    + `</tbody><tfoot><tr><td colspan="5">Вкупно придонеси и данок</td><td class="n">${fmt(sum(pub))}</td></tr></tfoot></table>`
    + `<p class="muted">Налогодавач: ${h(firm.name)} · ЕДБ ${h(firm.edb)} · сметка ${h(firm.bankAccount)} ${h(firm.bankName)}. Уплатните сметки и приходните шифри се внесуваат во „Параметри за плата“ (по фирма) – проверете ги според упатството на УЈП пред плаќање.</p>`
    + sig('Составил', 'Одговорно лице');
}
