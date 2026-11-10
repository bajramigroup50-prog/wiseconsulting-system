/**
 * „КАРТИЦА НА КУПУВАЧОТ“ – the buyer's financial card attached to an e-mailed invoice (worker `invoice.mail`): the
 * year's postings on the customer accounts (12x) for that buyer – opening balance, invoices, payments, credit notes –
 * with the running balance. HTML for the PDF renderer (`PDFDOC_CSS`).
 */

export interface PartnerCardRow { date: string; text: string; debit: number; credit: number }
export interface PartnerCardInput {
  firm: { name: string; address?: string | null; city?: string | null; edb?: string | null };
  partner: { name: string; edb?: string | null; address?: string | null };
  from: string; to: string;
  rows: readonly PartnerCardRow[];
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const h = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]!);
const dmy = (d: string) => String(d).slice(0, 10).split('-').reverse().join('.');
const fmt = (n: number) => {
  const [i, d] = Math.abs(n).toFixed(2).split('.') as [string, string];
  return (n < -0.004 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Running balance and totals of the card rows (debit − credit; positive = the buyer owes). */
export function partnerCardTotals(rows: readonly PartnerCardRow[]) {
  let bal = 0, debit = 0, credit = 0;
  const out = rows.map((r) => { debit += r.debit; credit += r.credit; bal = r2(bal + r.debit - r.credit); return { ...r, bal }; });
  return { rows: out, debit: r2(debit), credit: r2(credit), balance: r2(debit - credit) };
}

export function partnerCardHtml(p: PartnerCardInput): string {
  const T = partnerCardTotals(p.rows);
  const owe = T.balance > 0.005 ? 'Ваш долг кон нас' : T.balance < -0.005 ? 'Ваше побарување (преплата)' : 'Салдо';
  return `<div class="pdfdoc">`
    + `<div style="border-top:4px solid #0d5b4b;padding-top:8px;display:flex;justify-content:space-between;gap:12px">`
    + `<div><b style="font-size:14px">${h(p.firm.name)}</b><div class="muted">${h([p.firm.address, p.firm.city].filter(Boolean).join(', '))}${p.firm.edb ? ` · ЕДБ ${h(p.firm.edb)}` : ''}</div></div>`
    + `<div style="text-align:right"><b style="font-size:15px">КАРТИЦА НА КУПУВАЧОТ</b><div class="muted">${dmy(p.from)} – ${dmy(p.to)}</div></div></div>`
    + `<div class="box" style="margin:8px 0"><b>${h(p.partner.name)}</b>${p.partner.address ? `<br>${h(p.partner.address)}` : ''}${p.partner.edb ? `<br>ЕДБ: ${h(p.partner.edb)}` : ''}</div>`
    + `<table><thead><tr><th style="width:8mm">Р.б.</th><th style="width:22mm">Датум</th><th>Опис</th><th class="n">Должи</th><th class="n">Побарува</th><th class="n">Салдо</th></tr></thead><tbody>`
    + (T.rows.length ? T.rows.map((r, i) => `<tr><td>${i + 1}</td><td>${dmy(r.date)}</td><td>${h(r.text)}</td><td class="n">${r.debit ? fmt(r.debit) : ''}</td><td class="n">${r.credit ? fmt(r.credit) : ''}</td><td class="n">${fmt(r.bal)}</td></tr>`).join('')
      : `<tr><td colspan="6" class="muted">Нема промени во периодот.</td></tr>`)
    + `</tbody><tfoot><tr><td colspan="3"><b>Вкупно</b></td><td class="n"><b>${fmt(T.debit)}</b></td><td class="n"><b>${fmt(T.credit)}</b></td><td class="n"><b>${fmt(T.balance)}</b></td></tr></tfoot></table>`
    + `<p style="margin-top:8px;font-size:12px">${owe} на ${dmy(p.to)}: <b>${fmt(Math.abs(T.balance))} ден.</b></p>`
    + `<p class="muted" style="font-size:9.5px">Доколку имате разлика со Вашата евиденција, Ве молиме да не известите. Картицата е изработена автоматски од сметководствената евиденција.</p>`
    + `</div>`;
}
