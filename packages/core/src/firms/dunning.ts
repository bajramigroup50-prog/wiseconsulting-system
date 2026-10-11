/**
 * Unpaid invoices and dunning letters — legacy `opData` / `opDue` / `opDays` / `opLvAuto` / `opText` / `opPdfHTML`
 * (13326–13400, final v401 patches). Amounts in cents (integers), dates `YYYY-MM-DD`.
 */

export const OP_LV = ['1. Опомена', '2. Опомена', 'Последна опомена пред тужба'] as const;

export interface OpInvoice {
  id: string;
  number: string;
  date: string;
  pdate?: string | null;
  due?: string | null;
  partnerId: string | null;
  /** Amount to pay, paid so far (cents, MKD). */
  total: number;
  paid: number;
}

export interface OpRow { inv: OpInvoice; open: number; due: string; days: number }

export interface OpLetter { partnerId: string | null; invoiceIds: readonly string[]; level: number; channel: string; date: string; total: number }

export interface OpGroup {
  pid: string;
  rows: OpRow[];
  /** All open / overdue (cents). */
  open: number;
  over: number;
  /** Suggested level 0..2 (legacy `opLvAuto`). */
  lvlAuto: number;
  last: OpLetter | null;
}

const d0 = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Legacy `opDue`: the invoice due date, or (tax point or invoice date) + the firm's payment days (default 15). */
export function opDue(inv: Pick<OpInvoice, 'due' | 'date' | 'pdate'>, payDays: number): string {
  if (inv.due) return inv.due;
  return isoOf(d0(inv.pdate || inv.date) + (payDays > 0 || payDays === 0 ? payDays : 15) * 864e5);
}

/** Legacy `opDays`: days past the due date (negative = not due yet). */
export const opDays = (due: string, today: string): number => Math.floor((d0(today) - d0(due)) / 864e5);

/**
 * Legacy `opLvAuto`: the next letter's level = number of distinct earlier days (before today, not PDF) on which a
 * letter covering one of the overdue invoices was sent, capped at 2.
 */
export function opLevelAuto(rows: readonly OpRow[], letters: readonly OpLetter[], today: string): number {
  const ids = new Set(rows.filter((r) => r.days > 0).map((r) => r.inv.id));
  const D = new Set(letters.filter((d) => d.channel !== 'PDF' && d.date < today && d.invoiceIds.some((i) => ids.has(i))).map((d) => d.date));
  return Math.min(2, D.size);
}

/**
 * Legacy v406 `opOnly` (16893): „Опомени“ opened from Излезни фактури with ticked invoices — `?ids=` (comma-separated
 * invoice ids) → the set to keep, or `null` for all. Only uuid-shaped ids, at most 500.
 */
export function opOnlyIds(v: string | null | undefined): string[] | null {
  const ids = [...new Set(String(v ?? '').split(',').map((x) => x.trim()).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 500);
  return ids.length ? ids : null;
}

/** Legacy `opData` under `opOnly`: only the selected invoices (groups, open / overdue sums and level follow). */
export const opOnlyFilter = <T extends { id: string }>(invoices: readonly T[], only: readonly string[] | null): readonly T[] =>
  only ? invoices.filter((i) => only.includes(i.id)) : invoices;

/** Legacy `opData`: open invoices (≥ 0.50 den.) grouped by customer, sorted by overdue then open amount. */
export function opGroups(invoices: readonly OpInvoice[], letters: readonly OpLetter[], payDays: number, today: string): OpGroup[] {
  const by = new Map<string, OpGroup>();
  for (const inv of invoices) {
    if (!(inv.total > 50)) continue;
    const open = inv.total - inv.paid;
    if (open < 50) continue;
    const due = opDue(inv, payDays);
    const r: OpRow = { inv, open, due, days: opDays(due, today) };
    const k = inv.partnerId ?? '—';
    const g = by.get(k) ?? { pid: k, rows: [], open: 0, over: 0, lvlAuto: 0, last: null };
    g.rows.push(r);
    g.open += open;
    if (r.days > 0) g.over += open;
    by.set(k, g);
  }
  const G = [...by.values()];
  for (const g of G) {
    const mine = letters.filter((l) => (l.partnerId ?? '—') === g.pid);
    g.lvlAuto = opLevelAuto(g.rows, mine, today);
    g.last = mine.reduce<OpLetter | null>((a, l) => (!a || l.date > a.date ? l : a), null);
    g.rows.sort((a, b) => b.days - a.days);
  }
  return G.sort((a, b) => b.over - a.over || b.open - a.open);
}

export interface OpFirm { name: string; short?: string; bankAccount?: string; bankName?: string; signer?: string; phone?: string; phone2?: string; email?: string }

export interface OpText {
  L: (OpRow & { kam: number })[];
  /** Debt, late interest, costs, total (cents). */
  dolg: number; kam: number; cost: number; tot: number;
  ref: string;
  subj: string;
  body: string;
}

const fmtC = (c: number) => (c / 100).toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (d: string) => d.split('-').reverse().join('.');

/**
 * Legacy `opText` (v401): overdue invoices of the group (or the selected ones), late interest at `ratePct` per year
 * (simple, days / 365), the letter cost (`costC`, cents) and the e-mail text.
 */
export function opText(g: OpGroup, lvl: number, f: OpFirm, ratePct: number, costC: number, today: string, sel?: readonly string[]): OpText {
  const L = g.rows.filter((r) => (sel ? sel.includes(r.inv.id) : r.days > 0))
    .map((r) => ({ ...r, kam: ratePct && r.days > 0 ? Math.round(r.open * ratePct / 100 * r.days / 365) : 0 }));
  const dolg = L.reduce((s, r) => s + r.open, 0);
  const kam = L.reduce((s, r) => s + r.kam, 0);
  const cost = L.length ? costC : 0;
  const tot = dolg + kam + cost;
  const ref = L.map((r) => r.inv.number).filter(Boolean).join(', ');
  const subj = `${OP_LV[lvl]} – неплатени фактури – ${f.short || f.name || ''}`;
  const body = `Почитувани,\n\nСпоред нашата сметководствена евиденција, на ден ${dmy(today)} констатиравме дека ги немате измирено следните обврски:\n\n${
    L.map((r) => `• Фактура бр. ${r.inv.number} од ${dmy(r.inv.date)}, доспева ${dmy(r.due)} – ${fmtC(r.open)} ден. (${r.days} дена доцнење)${r.kam ? ' + затезна камата ' + fmtC(r.kam) : ''}`).join('\n')
  }\n\nНеплатени обврски: ${fmtC(dolg)} ден.${kam ? '\nЗатезна камата: ' + fmtC(kam) + ' ден.' : ''}${cost ? '\nТрошоци за опомената: ' + fmtC(cost) + ' ден.' : ''}\nВкупно за плаќање: ${fmtC(tot)} ден.\n\nВе молиме без одлагање да го платите наведениот долг${
    f.bankAccount ? ` на нашата жиро сметка ${f.bankAccount}${f.bankName ? ' во ' + f.bankName : ''}` : ''}${ref ? `, со повикување на број ${ref}` : ''}${
    lvl === 2 ? '. Доколку износот не биде платен во рок од 8 дена, ќе бидеме принудени побарувањето да го наплатиме по судски пат, со дополнителни трошоци и законска затезна камата' : ''
  }.\n\nДоколку веќе сте платиле, Ве молиме да ни испратите доказ за извршената уплата и да не ја земате предвид оваа опомена.\n\nВо прилог е опомената во PDF.\n\nСо почит,\n${f.signer || ''}\n${f.name || ''}${f.phone ? '\nТел.: ' + f.phone : ''}${f.phone2 && f.phone2 !== f.phone ? ', ' + f.phone2 : ''}${f.email ? '\n' + f.email : ''}`;
  return { L, dolg, kam, cost, tot, ref, subj, body };
}

/** WhatsApp number from a Macedonian phone (legacy: digits, leading 0 → 389). */
export const waPhone = (p: string | null | undefined): string => String(p ?? '').replace(/\D/g, '').replace(/^0/, '389');

export interface OpPartner { name: string; address?: string | null; city?: string | null; edb?: string | null }
export interface OpFirmFull extends OpFirm { address?: string | null; city?: string | null; edb?: string | null; embs?: string | null; signerRole?: string }

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Legacy `opPdfHTML` (v401 standard dunning letter) — the same HTML is printed and sent as the e-mail body. */
export function opLetterHtml(X: OpText, lvl: number, f: OpFirmFull, p: OpPartner, ratePct: number, today: string): string {
  const ttl = lvl === 2 ? 'ПОСЛЕДНА ОПОМЕНА ПРЕД ТУЖБА' : `${lvl + 1}. ОПОМЕНА`;
  const td = 'border:1px solid #444;padding:4px 6px', th = td + ';background:#d9d9d9;font-weight:700;text-align:center', nr = ';text-align:right;white-space:nowrap';
  const row = (a: string, b: string, bold?: boolean) => `<tr${bold ? ' style="background:#d9d9d9;font-weight:700"' : ''}><td style="${td}">${a}</td><td style="${td + nr}">${b}</td></tr>`;
  const kv = (a: string, b: string) => `<tr><td style="padding:2px 10px 2px 0;border-bottom:1px solid #333">${a}</td><td style="padding:2px 0;border-bottom:1px solid #333">${b}</td></tr>`;
  const T = dmy(today);
  return `<div style="font-size:10.5pt;line-height:1.35;color:#111">
<div style="display:flex;justify-content:flex-end;align-items:flex-start;min-height:12mm"><div style="text-align:right;font-weight:700;font-size:12pt">${esc(f.name)}</div></div>
<div style="display:flex;justify-content:space-between;gap:12mm;margin-top:8mm">
 <div style="flex:1;font-weight:700;text-transform:uppercase;line-height:1.5">${esc(p.name)}<br>${esc(p.address)}${p.city ? '<br>' + esc(p.city) : ''}</div>
 <div style="width:75mm"><div style="font-weight:700;border-bottom:1px solid #333;padding-bottom:2px">${esc((f.short || f.name || '').toUpperCase())}</div><table style="border-collapse:collapse;width:100%;font-size:9.5pt">${kv('Тел:', esc(f.phone))}${kv('Моб.:', esc(f.phone2 && f.phone2 !== f.phone ? f.phone2 : ''))}${kv('Е-пошта:', esc(f.email))}${kv('Дата:', T)}</table></div></div>
<h2 style="font-size:14pt;margin:12mm 0 6mm">${ttl}</h2>
<table style="font-size:10pt;margin-bottom:6mm"><tr><td style="padding-right:14mm">Клиент:</td><td><b>${esc(p.name)}</b></td></tr>${p.edb ? `<tr><td style="padding-right:14mm">ЕДБ:</td><td><b>${esc(p.edb)}</b></td></tr>` : ''}</table>
<p>Почитувани,</p><p>Според нашата сметководствена евиденција, на ден ${T} година констатиравме дека ги немате измирено следните обврски:</p>
<table style="border-collapse:collapse;width:100%;font-size:9pt;margin:4mm 0 6mm"><thead><tr><th style="${th}">Број на фактура</th><th style="${th}">Датум на ф-ра</th><th style="${th}">Датум на доспевање</th><th style="${th}">Датум на издавање</th><th style="${th}">Денови на доцнење</th><th style="${th}">Каматна стапка</th><th style="${th}">Износ</th><th style="${th}">Затезна камата</th></tr></thead><tbody>${
  X.L.map((r) => `<tr><td style="${td};text-align:center">${esc(r.inv.number)}</td><td style="${td};text-align:center">${dmy(r.inv.date)}</td><td style="${td};text-align:center">${dmy(r.due)}</td><td style="${td};text-align:center">${T}</td><td style="${td};text-align:center">${r.days}</td><td style="${td + nr}">${ratePct ? ratePct.toFixed(3).replace('.', ',') + '%' : '–'}</td><td style="${td + nr}">${fmtC(r.open)} МКД</td><td style="${td + nr}">${fmtC(r.kam)} МКД</td></tr>`).join('')
}</tbody></table>
<table style="border-collapse:collapse;width:90mm;font-size:9.5pt;margin:0 0 6mm 15mm">${row('Неплатени обврски', fmtC(X.dolg) + ' МКД')}${row('Затезна камата', fmtC(X.kam) + ' МКД')}${row('Трошоци за опомената', fmtC(X.cost) + ' МКД')}${row('Вкупно за плаќање', fmtC(X.tot) + ' МКД', true)}</table>
<p>Ве молиме без одлагање да го платите наведениот долг. Уплатата извршете ја на нашата жиро сметка: <b>${esc(f.bankAccount)}</b>${f.bankName ? ' во ' + esc(f.bankName) : ''}${X.ref ? `<br>со повикување на број: <b>${esc(X.ref)}</b>` : ''}</p>
${lvl === 2 ? '<p><b>Доколку долгот не биде платен во рок од 8 дена од приемот на оваа опомена, ќе бидеме принудени побарувањето да го наплатиме по судски пат, со дополнителни судски трошоци и законска затезна камата.</b></p>' : ''}
<p>Доколку до моментот на приемот на оваа опомена го имате извршено плаќањето, Ве молиме да ни испратите доказ за извршената уплата. Во тој случај Ве молиме да не ја земате предвид оваа опомена.</p>
${ratePct ? `<p>Доколку сте го платиле основниот долг по датумот на пресметка на каматата, Ве молиме да го доплатите само износот на каматата${X.cost ? ' и трошоците за опомената' : ''}.</p>` : ''}
<div style="margin-top:10mm;display:flex;justify-content:flex-end"><div style="text-align:center;min-width:70mm">${esc(f.name)}<br>${f.signer ? esc(f.signerRole || 'Управител') + ': ' + esc(f.signer) : ''}<div style="height:30mm"></div><div style="border-top:1px solid #333"></div></div></div>
<div style="margin-top:12mm;border-top:2px solid #333;padding-top:3mm;font-size:8.5pt;line-height:1.5"><b>${esc(f.name)}</b><br><b>${esc([f.address, f.city].filter(Boolean).join(' | '))}${f.phone ? ' | тел. ' + esc(f.phone) : ''}${f.phone2 && f.phone2 !== f.phone ? ' | моб. ' + esc(f.phone2) : ''}${f.email ? ' | ' + esc(f.email) : ''}</b><br><span style="color:#555">ЕМБС: ${esc(f.embs)}<br>ЕДБ: ${esc(f.edb)}<br>Трансакциона сметка: ${esc(f.bankAccount)}${f.bankName ? ', ' + esc(f.bankName) : ''}</span></div></div>`;
}
