/**
 * Print HTML of an outgoing document — legacy `docHTML` 4250 (→ 13302 `legalFootTxt`, → 13479 e-sign) and `invAlt` 4227:
 * invoice / advance invoice / credit note / proforma, dispatch note (`dispatch`), waybill (`waybill`).
 *
 * ONE template, a pure string builder, used by the web print view (`/print/doc/[id]`) and by the worker's
 * `invoice.mail` job (server PDF attached to the e-mail). Styling is the legacy print CSS (`.pdfdoc`, see
 * `@wise/core/print-css`).
 *
 * FIX (LEGACY-MAP 3.4 item 6): a non-VAT firm prints no VAT (legacy computed line VAT from `it.rate`).
 * FIX (item 5): art. 32-a "transferred VAT" = `reverseChargeVat(base)` like the editor.
 * FIX (item 11): the document currency is printed (legacy always "ден."), with the denar equivalent.
 * FIX (item 15): in e-signature mode the stamp is not rendered (legacy only resized the signature), and the
 * чл. 53 footnote is printed on tax documents only (invoice, credit note) — not on proformas.
 */
import { ART32_TXT, type AdvanceDeduction } from '../vat';
import { INV_NOTE0, invoiceTotals } from './docs';
import { amountInWords } from './words';

export type InvoicePrintKind = 'invoice' | 'credit' | 'proforma' | 'dispatch' | 'waybill';

export interface InvoicePrintLine {
  name: string;
  qty: number | string;
  price: number | string;
  disc: number | string;
  rate: number;
  unit?: string | null;
  /** Code typed on the line. */
  code?: string | null;
  /** Code of the linked item. */
  itemCode?: string | null;
  account?: string | null;
}

export interface InvoicePrintInput {
  /** What to print (`dispatch` / `waybill` can be printed from an invoice). */
  kind: InvoicePrintKind;
  doc: {
    kind: string; number: string; date: string; pdate?: string | null; due?: string | null;
    advance?: boolean; art32?: boolean; export?: boolean; currency: string; fx: number | string;
    note?: string | null; data?: Record<string, unknown> | null;
  };
  firm: {
    name: string; address?: string | null; city?: string | null; phone?: string | null; email?: string | null;
    edb?: string | null; embs?: string | null; vatRegistered: boolean; settings?: Record<string, unknown> | null;
  };
  partner?: { name?: string | null; address?: string | null; city?: string | null; edb?: string | null } | null;
  lines: readonly InvoicePrintLine[];
  /** Deducted advances (`loadAdvances`) — final invoices only. */
  advances?: readonly AdvanceDeduction[];
  /** Credit note → the corrected invoice. */
  ref?: { number: string; date: string } | null;
  /** Invoice made from a proforma / dispatch note. */
  from?: { kind: string; number: string } | null;
  /** Dispatch note: the issuing warehouse (`codes`). */
  warehouse?: { code?: string | null; name: string } | null;
  /**
   * `<img src>` of a logo / signature / stamp setting value (a `files.id` or a URL). Default: `/api/files/{id}`
   * (web). The worker passes `data:` URIs because its Chromium has no network.
   */
  img?: (value: string) => string;
}

/* Number / date formats — same as `apps/web/lib/fmt.ts` (hand-rolled so server and client render alike). */
const group = (int: string) => int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const fmt = (n: number | string | null | undefined): string => {
  const v = Number(n) || 0;
  const [i, d] = Math.abs(v).toFixed(2).split('.') as [string, string];
  return (v < 0 && (i !== '0' || d !== '00') ? '-' : '') + group(i) + ',' + d;
};
const fq = (n: number | string | null | undefined): string => {
  const v = Number(n) || 0;
  const [i, d = ''] = String(Math.round(Math.abs(v) * 1000) / 1000).split('.') as [string, string?];
  return (v < 0 ? '-' : '') + group(i) + (d ? ',' + d : '');
};
const dmy = (d: string | null | undefined): string => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '');

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const h = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]!);

/* Inline styles written as React-style objects (the template was ported from JSX): numbers get `px` except the unitless ones. */
type Css = Record<string, string | number | undefined | null | false>;
const UNITLESS = new Set(['lineHeight', 'fontWeight', 'opacity', 'zIndex', 'flex', 'flexGrow', 'flexShrink', 'order']);
const css = (o: Css): string => Object.entries(o)
  .filter(([, v]) => v != null && v !== false && v !== '')
  .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${typeof v === 'number' && v !== 0 && !UNITLESS.has(k) ? v + 'px' : v}`)
  .join(';');
const sa = (o?: Css | null): string => {
  const s = o ? css(o) : '';
  return s ? ` style="${h(s)}"` : '';
};
const imgTag = (src: string, o: Css, cls?: string) => `<img src="${h(src)}" alt=""${cls ? ` class="${cls}"` : ''}${sa(o)}>`;

/** Default image resolver (web): an uploaded file id → `/api/files/{id}` (firm access checked there). */
export const invoicePrintImg = (v: string): string => (/^[0-9a-f-]{36}$/i.test(v) ? `/api/files/${v}` : v);

/** The document kind printed for `?k=` (legacy `docPdf` data-k). */
export const invoicePrintKind = (docKind: string, k?: string | null): InvoicePrintKind =>
  k === 'dispatch' || k === 'waybill' ? k : (docKind as InvoicePrintKind);

/** Title of the printed document. */
export function invoicePrintTitle(kind: InvoicePrintKind, advance?: boolean): string {
  return { invoice: advance ? 'АВАНСНА ФАКТУРА' : 'ФАКТУРА', credit: 'КНИЖНО ОДОБРЕНИЕ', proforma: 'ПРОФАКТУРА', dispatch: 'ИСПРАТНИЦА', waybill: 'ТОВАРЕН ЛИСТ' }[kind];
}

/** PDF file name base (legacy `sendMailGo`: Faktura_/Odobrenie_/Profaktura_ + number). */
export function invoicePdfName(kind: string, number: string): string {
  const p = ({ invoice: 'Faktura', credit: 'Odobrenie', proforma: 'Profaktura', dispatch: 'Ispratnica', waybill: 'Tovaren_list' } as Record<string, string>)[kind] ?? 'Dokument';
  return `${p}_${String(number).replace(/[\\/:*?"<>|\s]+/g, '-')}`;
}

/** Full `<div class="pdfdoc printarea">…</div>` markup of the document. */
export function invoicePrintHtml(p: InvoicePrintInput): string {
  const { doc, firm: f, partner, lines: L, kind } = p;
  const S = (f.settings ?? {}) as Record<string, unknown>;
  const st = (k: string) => String(S[k] ?? '');
  const img = (v: unknown) => {
    const x = String(v ?? '').trim();
    return x ? (p.img ?? invoicePrintImg)(x) : '';
  };
  const nonVat = !f.vatRegistered;
  const fx = Number(doc.fx) || 1;
  const items0 = L.map((l) => ({ name: l.name, qty: Number(l.qty), price: Number(l.price), disc: Number(l.disc), rate: l.rate, konto: l.account ?? undefined, unit: l.unit ?? '' }));
  const adv = doc.kind === 'invoice' && !doc.advance ? p.advances ?? [] : [];
  const T = invoiceTotals({ items: items0, art32: !!doc.art32, advance: !!doc.advance, credit: doc.kind === 'credit', advances: adv }, { nonVat });
  const cur = doc.currency === 'MKD' ? 'ден.' : doc.currency;
  const curWord = doc.currency === 'MKD' ? 'денари' : doc.currency;
  const T0 = invoicePrintTitle(kind, doc.advance);
  const AC = '#0d5b4b';
  const data = (doc.data ?? {}) as Record<string, string | undefined>;
  const meta: [string, string][] = [['Број', `<b>${h(doc.number)}</b>`], ['Датум', dmy(doc.date)]];
  if (kind === 'invoice') meta.push(['Датум на промет', dmy(doc.pdate || doc.date)]);
  if ((kind === 'invoice' || kind === 'proforma') && doc.due) meta.push([kind === 'proforma' ? 'Важи до' : 'Рок на плаќање', dmy(doc.due)]);
  if (p.from) meta.push(['Врска', h(`${p.from.kind === 'dispatch' ? 'Испратница' : 'Профактура'} бр. ${p.from.number}`)]);
  if (data.refDoc) meta.push(['По документ', h(data.refDoc)]);
  if (data.dispNo && kind === 'invoice') meta.push(['Испратница', h(data.dispNo)]);
  if (kind === 'credit' && p.ref) meta.push(['Кон фактура', h(`${p.ref.number} од ${dmy(p.ref.date)}`)]);
  if (doc.currency !== 'MKD') meta.push(['Валута', h(`${doc.currency} (курс ${Number(doc.fx)})`)]);
  const esign = st('legalFoot') === 'esign' || ((st('legalFoot') || 'auto') === 'auto' && !!(st('cert_serial') || st('cert_thumb')));
  const legal = (() => {
    const m = st('legalFoot') || 'auto';
    if (m === 'none' || !(kind === 'invoice' || kind === 'credit')) return '';
    if (esign) return 'Фактурата е издадена во електронска форма и е потпишана со квалификуван електронски потпис, согласно член 53-б од Законот за данокот на додадена вредност; не содржи печат.';
    if (m === 'paper' || !st('stamp')) return 'Печатот не е задолжителен елемент на фактурата (член 53 од Законот за данокот на додадена вредност); фактурата е валидна со потпис на овластеното лице.';
    return '';
  })();
  const logo = img(S.logo), sign = img(S.sign), stamp = esign ? '' : img(S.stamp);
  const note = S.invNote == null ? INV_NOTE0 : st('invNote');
  const td0 = sa({ border: 0, borderBottom: '1px solid #ddd' });
  const head = `<div${sa({ borderTop: `4px solid ${AC}`, paddingTop: 10, display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start' })}>`
    + `<div${sa({ display: 'flex', gap: 10, alignItems: 'flex-start' })}>${logo ? imgTag(logo, { maxHeight: '22mm', maxWidth: '45mm' }) : ''}`
    + `<div><div${sa({ fontSize: 15, fontWeight: 700 })}>${h(f.name)}</div><div class="muted">${h(f.address)}<br>ЕДБ: ${h(f.edb)} · ЕМБС: ${h(f.embs)}${f.phone ? `<br>Тел.: ${h(f.phone)}` : ''}${f.email ? `${f.phone ? ' · ' : '<br>'}${h(f.email)}` : ''}<br>Жиро сметка: ${h(st('bank'))}${st('bankName') ? ' · ' + h(st('bankName')) : ''}</div></div></div>`
    + `<div${sa({ border: `1.5px solid ${AC}`, minWidth: '64mm' })}><div${sa({ background: AC, color: '#fff', padding: '5px 8px', fontSize: 15, fontWeight: 700, letterSpacing: '.05em' })}>${T0}</div>`
    + `<table${sa({ margin: 0, fontSize: 10.5 })}><tbody>${meta.map(([a, b]) => `<tr><td${td0}>${a}</td><td class="n"${td0}>${b}</td></tr>`).join('')}</tbody></table></div>`
    + `</div>`;
  const lbl9 = sa({ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.06em' });
  const buyerBox = `<div class="box"${sa({ margin: 0 })}><div class="muted"${lbl9}>${kind === 'waybill' ? 'Примач' : 'Купувач'}</div><b${sa({ fontSize: 12 })}>${h(partner?.name)}</b><br>${h(partner?.address)}<br>ЕДБ: ${h(partner?.edb)}</div>`;
  const sig = (who: string[]) => `<div class="sig">${who.map((w) => `<span>${h(w)}</span>`).join('')}</div>`;

  let body: string;
  if (kind === 'waybill') {
    body = head
      + `<div class="grid2"${sa({ marginTop: 8 })}><div class="box"${sa({ margin: 0 })}><div class="muted"${sa({ fontSize: 9, textTransform: 'uppercase' })}>Испраќач</div><b>${h(f.name)}</b><br>${h(f.address)}<br>ЕДБ: ${h(f.edb)}</div>${buyerBox}</div>`
      + `<div class="grid2"${sa({ marginTop: 6 })}><div class="box"${sa({ margin: 0 })}><b>Место на натовар:</b> ${h(data.loadPlace || f.address)}<br><b>Датум на натовар:</b> ${dmy(doc.date)}</div><div class="box"${sa({ margin: 0 })}><b>Место на истовар:</b> ${h(data.dAddr || partner?.address)}<br><b>Датум на истовар:</b> ____________</div></div>`
      + `<div class="box"><b>Возило (рег. број):</b> ${h(data.vehicle || '____________')} &nbsp;&nbsp; <b>Возач:</b> ${h(data.driver || '____________')}</div>`
      + `<table><thead><tr><th${sa({ width: '8mm' })}>Р.б.</th><th>Опис</th><th${sa({ width: '16mm' })}>Ед. мерка</th><th class="n"${sa({ width: '22mm' })}>Количина</th><th class="n"${sa({ width: '28mm' })}>Бруто тежина (кг)</th></tr></thead>`
      + `<tbody>${L.map((l, i) => `<tr><td>${i + 1}</td><td>${h(l.name)}</td><td>${h(l.unit)}</td><td class="n">${fq(l.qty)}</td><td></td></tr>`).join('')}</tbody></table>`
      + (doc.note ? `<p>${h(doc.note)}</p>` : '') + sig(['Испраќач', 'Превозник', 'Примач']);
  } else if (kind === 'dispatch') {
    const loc = p.warehouse;
    const R = L.map((l) => {
      const rate = doc.art32 || doc.export || nonVat ? 0 : l.rate;
      const pu = Math.round(Number(l.price) * (1 - Number(l.disc) / 100) * (1 + rate / 100) * 100) / 100;
      return { l, code: l.code || l.itemCode || '', pu, am: Math.round(pu * Number(l.qty) * 100) / 100 };
    });
    const tot = R.reduce((a, r) => a + r.am, 0);
    const ispNo = doc.kind === 'invoice' ? data.dispNo || doc.number : doc.number;
    const c0 = sa({ border: 0, padding: '1px 10px 1px 0' }), c1 = sa({ border: 0, padding: '1px 0' });
    body = (logo ? `<div${sa({ textAlign: 'center', marginBottom: 4 })}>${imgTag(logo, { maxHeight: '18mm', maxWidth: '60mm' })}</div>` : '')
      + `<div class="fh"><div class="fn">${h(f.name)}</div><div class="fa">${h(f.address)}${f.city ? ', ' + h(f.city) : ''} · ЕДБ ${h(f.edb)}</div></div>`
      + `<div${sa({ display: 'flex', justifyContent: 'space-between', gap: 14, margin: '12px 0 8px', alignItems: 'flex-start' })}>`
      + `<div${sa({ fontSize: 11, lineHeight: 1.6 })}><table${sa({ margin: 0, width: 'auto', fontSize: 11, border: 0 })}><tbody>`
      + `<tr><td${c0}><b>Датум</b></td><td${c1}>${dmy(doc.date)}</td></tr>`
      + (doc.due ? `<tr><td${c0}><b>Валута</b></td><td${c1}>${dmy(doc.due)}</td></tr>` : '')
      + `<tr><td${c0}><b>Од магацин</b></td><td${c1}>${loc ? h(`${loc.code ?? ''} ${loc.name.toUpperCase()}`) : '01 ГЛАВЕН МАГАЦИН'}</td></tr></tbody></table>`
      + `<div${sa({ fontSize: 19, fontWeight: 700, marginTop: 10 })}>Испратница</div><div${sa({ fontSize: 13 })}><b>Број:</b> ${h(ispNo)}${doc.kind === 'invoice' ? `<span class="muted"${sa({ fontSize: 10 })}> (по фактура ${h(doc.number)})</span>` : ''}</div></div>`
      + `<div${sa({ minWidth: '88mm' })}><div${sa({ border: '1.5px solid #111', padding: '6px 8px', minHeight: '22mm' })}><div${sa({ fontSize: 14, fontWeight: 700, lineHeight: 1.3 })}>${h((partner?.name ?? '').toUpperCase())}</div><div${sa({ fontSize: 13, fontWeight: 700 })}>${h((partner?.address ?? '').toUpperCase())}</div><div${sa({ marginTop: 8 })}>${h((partner?.city ?? '').toUpperCase())}</div>${partner?.edb ? `<div class="muted"${sa({ fontSize: 9.5 })}>ЕДБ: ${h(partner.edb)}</div>` : ''}</div>`
      + `<div${sa({ fontSize: 10.5, marginTop: 3 })}>Место на испорака: ${h(data.dAddr ?? '')}</div></div>`
      + `</div>`
      + `<table><thead><tr><th rowspan="2"${sa({ width: '8mm' })}>Р.б</th><th rowspan="2"${sa({ width: '22mm' })}>Шифра</th><th rowspan="2">Назив на производот</th><th rowspan="2"${sa({ width: '12mm' })}>ЕМ</th><th rowspan="2" class="n"${sa({ width: '24mm' })}>Количина</th><th colspan="2"${sa({ textAlign: 'center' })}>Цена со данок</th></tr><tr><th class="n"${sa({ width: '24mm' })}>По един.</th><th class="n"${sa({ width: '28mm' })}>Износ</th></tr></thead>`
      + `<tbody>${R.map((r, i) => `<tr><td>${i + 1}.</td><td>${h(r.code)}</td><td>${h(r.l.name)}</td><td>${h((r.l.unit ?? '').toUpperCase())}</td><td class="n">${fq(r.l.qty)}</td><td class="n">${fmt(r.pu)}</td><td class="n">${fmt(r.am)}</td></tr>`).join('')}</tbody></table>`
      + `<div${sa({ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 6 })}><b${sa({ fontSize: 12 })}>Вкупно:</b><span${sa({ border: '1.5px solid #111', padding: '3px 10px', minWidth: '30mm', textAlign: 'right', fontWeight: 700, fontSize: 13 })}>${fmt(tot)}</span></div>`
      + (doc.note ? `<p${sa({ marginTop: 8 })}>${h(doc.note)}</p>` : '')
      + `<div class="sig sigimg"${sa({ marginTop: '22mm' })}><span${sa({ border: 0 })}>ПРИМИЛ</span><span${sa({ border: 0 })}>${stamp ? imgTag(stamp, {}, 'sti') : ''}ОДОБРИЛ</span><span${sa({ border: 0 })}>${sign ? imgTag(sign, {}, 'sgi') : ''}ИСПРАТИЛ</span></div>`;
  } else {
    const rows = L.map((l) => {
      const b = Math.round(Number(l.qty) * Number(l.price) * (1 - Number(l.disc) / 100) * 100) / 100;
      const rate = nonVat ? 0 : doc.art32 ? 18 : l.rate;
      return { l, code: l.itemCode ?? null, b, rate, v: doc.art32 || nonVat ? 0 : Math.round(b * rate) / 100 };
    });
    const rec = new Map<number, { b: number; v: number }>();
    for (const r of rows) { const x = rec.get(r.rate) ?? { b: 0, v: 0 }; x.b += r.b; x.v += r.v; rec.set(r.rate, x); }
    const recs = [...rec].sort((a, b) => b[0] - a[0]);
    const vatAll = doc.art32 ? T.transferredVat : T.vat;
    const pay = T.pay;
    const style = st('invStyle') || 'classic';
    const sigBlock = `<div class="sig sigimg"${sa(esign ? { marginTop: '40mm' } : null)}>`
      + `<span>${sign ? imgTag(sign, esign ? { maxHeight: '34mm', maxWidth: '75mm', bottom: 'calc(100% + 1mm)' } : {}, 'sgi') : ''}${kind === 'proforma' ? 'Изготвил' : 'Фактурирал'}<br><b>${h(st('short') || f.name)}</b>${st('signer') ? `<br>${h(st('signerRole') || 'Управител')}: <b>${h(st('signer'))}</b>` : ''}</span>`
      + `<span${sa({ border: 0 })}>${stamp ? imgTag(stamp, {}, 'sti') : ''}${esign ? '' : 'М.П.'}</span>`
      + `<span>Примил${partner?.name ? `<br><b>${h(partner.name)}</b>` : ''}</span>`
      + `</div>`;
    const words = `<b>${h(amountInWords(pay, curWord))}</b>`;
    if (style !== 'classic') {
      const M = style === 'minimal';
      const Acol = st('invColor') || (M ? '#111111' : '#1f5eff');
      const soft = Acol + '14';
      const lbl = (x: string) => `<div${sa({ fontSize: 8.5, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8a8f98', marginBottom: 3 })}>${x}</div>`;
      const th: Css = { background: M ? '#fff' : Acol, color: M ? '#111' : '#fff', border: 0, borderBottom: M ? '1.5px solid #111' : 0, padding: '6px 6px', fontSize: 9, letterSpacing: '.06em', textTransform: 'uppercase' };
      const td = sa({ border: 0, borderBottom: '1px solid #eceff2', padding: 6 });
      const tr = (a: string, b: string, bold?: boolean) => `<div${sa({ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '3px 0', fontSize: bold ? 12 : 10.5, fontWeight: bold ? 800 : undefined })}><span>${h(a)}</span><span>${h(b)}</span></div>`;
      const mrow = (a: string, b: string) => `<div${sa({ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10, padding: '1.5px 0' })}><span${sa({ color: '#777' })}>${a}</span><span>${b}</span></div>`;
      body = `<div${sa(M ? null : { borderTop: `5px solid ${Acol}`, paddingTop: 12 })}>`
        + `<div${sa({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, ...(M ? { borderBottom: '1px solid #111', paddingBottom: 10 } : {}) })}>`
        + `<div${sa({ display: 'flex', gap: 12, alignItems: 'center' })}>${logo ? imgTag(logo, { maxHeight: '20mm', maxWidth: '48mm' }) : `<div${sa({ width: '13mm', height: '13mm', borderRadius: M ? 0 : 10, background: Acol, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 20 })}>${h(f.name.trim()[0])}</div>`}`
        + `<div><div${sa({ fontSize: 15, fontWeight: 800 })}>${h(f.name)}</div><div${sa({ color: '#666', fontSize: 9.5, lineHeight: 1.45 })}>${h([f.address, f.city].filter(Boolean).join(', '))}<br>ЕДБ ${h(f.edb)}${f.embs ? ' · ЕМБС ' + h(f.embs) : ''}${f.phone ? ' · ' + h(f.phone) : ''}${f.email ? ' · ' + h(f.email) : ''}</div></div></div>`
        + `<div${sa({ textAlign: 'right' })}><div${sa({ fontSize: M ? 22 : 26, fontWeight: M ? 300 : 800, letterSpacing: M ? '.25em' : '.02em', color: M ? '#111' : Acol, lineHeight: 1 })}>${T0}</div><div${sa({ fontSize: 13, marginTop: 4 })}>бр. <b>${h(doc.number)}</b></div></div></div>`
        + `<div${sa({ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 10, margin: '14px 0 12px' })}>`
        + `<div${sa(M ? { borderLeft: '2px solid #111', padding: '2px 10px' } : { background: soft, borderRadius: 10, padding: '10px 12px' })}>${lbl(kind === 'credit' ? 'Одобрение за' : 'Фактурирано на')}<div${sa({ fontSize: 13, fontWeight: 700 })}>${h(partner?.name)}</div><div${sa({ color: '#555', fontSize: 10, lineHeight: 1.45 })}>${h([partner?.address, partner?.city].filter(Boolean).join(', '))}${partner?.edb ? `<br>ЕДБ ${h(partner.edb)}` : ''}</div></div>`
        + `<div${sa(M ? { borderLeft: '2px solid #111', padding: '2px 10px' } : { border: '1px solid #e3e6ea', borderRadius: 10, padding: '10px 12px' })}>${meta.filter(([a]) => a !== 'Број').map(([a, b]) => mrow(a, b)).join('')}`
        + `${kind === 'invoice' ? mrow('Повикување на број', `<b>${h(doc.number)}</b>`) : ''}</div></div>`
        + `<table${sa({ borderCollapse: 'collapse', width: '100%', border: 0 })}><thead><tr>${['#', 'Опис', 'Ед.м.', 'Кол.', 'Цена', 'Рабат', 'ДДВ', 'Износ без ДДВ'].map((x, i) => `<th${i >= 3 ? ' class="n"' : ''}${sa(th)}>${x}</th>`).join('')}</tr></thead>`
        + `<tbody>${rows.map((r, i) => `<tr${sa(!M && i % 2 ? { background: soft } : null)}><td${td}>${i + 1}</td><td${td}><b>${h(r.l.name)}</b>${r.l.code || r.code ? `<div${sa({ color: '#999', fontSize: 8.5 })}>шифра ${h(r.l.code || r.code)}</div>` : ''}</td><td${td}>${h(r.l.unit)}</td><td class="n"${td}>${fq(r.l.qty)}</td><td class="n"${td}>${fmt(r.l.price)}</td><td class="n"${td}>${Number(r.l.disc) ? Number(r.l.disc) + '%' : '–'}</td><td class="n"${td}>${r.rate}%</td><td class="n"${td}><b>${fmt(r.b)}</b></td></tr>`).join('')}</tbody></table>`
        + `<div${sa({ display: 'flex', justifyContent: 'space-between', gap: 14, marginTop: 12, alignItems: 'flex-start' })}>`
        + `<div${sa({ flex: 1, fontSize: 10, lineHeight: 1.5 })}>${recs.map(([k, x]) => `<div${sa({ color: '#555' })}>ДДВ ${k}%: основица ${fmt(x.b)} · данок ${fmt(x.v)}</div>`).join('')}`
        + `<div${sa({ marginTop: 6 })}>${lbl('Со зборови')}${words}</div>`
        + (doc.export ? `<div${sa({ marginTop: 4 })}><b>Извоз – ослободено од ДДВ согласно член 23 од ЗДДВ.</b></div>` : '')
        + (doc.art32 ? `<div${sa({ marginTop: 4 })}><b>* ${h(ART32_TXT)}.</b></div>` : '') + `</div>`
        + `<div${sa({ width: '74mm', ...(M ? {} : { background: soft, borderRadius: 10 }), padding: '8px 12px' })}>${tr('Износ без ДДВ', fmt(T.base))}${tr('ДДВ', fmt(vatAll))}${T.advTotal ? tr('Одбиен аванс', '−' + fmt(T.advTotal)) : ''}`
        + `<div${sa({ borderTop: M ? '1.5px solid #111' : `2px solid ${Acol}`, marginTop: 5, paddingTop: 6, color: M ? '#111' : Acol })}>${tr(kind === 'credit' ? 'ИЗНОС НА ОДОБРЕНИЕТО' : 'ЗА ПЛАЌАЊЕ', fmt(pay) + ' ' + cur, true)}</div></div></div>`
        + (kind === 'invoice' ? `<div${sa({ marginTop: 12, fontSize: 10, ...(M ? { borderTop: '1px solid #ddd', paddingTop: 8 } : { borderLeft: `3px solid ${Acol}`, background: '#fafbfc', padding: '8px 12px', borderRadius: '0 8px 8px 0' }) })}>${lbl('Плаќање')}Жиро сметка <b>${h(st('bank'))}</b>${st('bankName') ? ' · ' + h(st('bankName')) : ''}${doc.due ? ` · рок до <b>${dmy(doc.due)}</b>` : ''} · повикување на број <b>${h(doc.number)}</b></div>` : '')
        + (kind === 'credit' ? `<p${sa({ margin: '8px 0 0', fontSize: 10 })}>Ве одобруваме за горенаведениот износ. Одобрението го намалува Вашиот долг по наведената фактура.</p>` : '')
        + (kind === 'proforma' ? `<p${sa({ margin: '8px 0 0', fontSize: 10, color: '#666' })}>Профактурата служи за плаќање однапред и не е даночна фактура.</p>` : '')
        + (doc.note ? `<p${sa({ margin: '8px 0 0', fontSize: 10 })}>${h(doc.note)}</p>` : '')
        + (note ? `<div${sa({ marginTop: 10, fontSize: 8.8, color: '#666', lineHeight: 1.45, textAlign: 'justify', whiteSpace: 'pre-line' })}>${lbl('Напомена')}${h(note)}</div>` : '')
        + sigBlock + `</div>`;
    } else {
      const extra = [data.payMethod && data.payMethod !== 'Вирман' ? 'Начин на плаќање: ' + data.payMethod : '', data.parity ? 'Паритет: ' + data.parity : '', data.pay1, data.pay2, data.pay3].filter(Boolean);
      const totCell = sa({ background: AC, color: '#fff', fontWeight: 700, fontSize: 11.5 });
      body = head
        + `<div class="grid2"${sa({ margin: '8px 0' })}>${buyerBox}<div class="box"${sa({ margin: 0 })}>${f.city ? `<b>Место на издавање:</b> ${h(f.city)}<br>` : ''}${data.dAddr ? `<b>Место на испорака:</b> ${h(data.dAddr)}<br>` : ''}${kind === 'invoice' ? `<b>Повикување на број:</b> ${h(doc.number)}` : ''}</div></div>`
        + `<table><thead><tr><th${sa({ width: '7mm' })}>Р.б.</th><th>Опис</th><th${sa({ width: '11mm' })}>Ед.м.</th><th class="n">Кол.</th><th class="n">Цена без ДДВ</th><th class="n">Рабат</th><th class="n">Износ без ДДВ</th><th class="n">ДДВ %</th><th class="n">ДДВ</th><th class="n">Вкупно</th></tr></thead>`
        + `<tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${h(r.l.name)}</td><td>${h(r.l.unit)}</td><td class="n">${fq(r.l.qty)}</td><td class="n">${fmt(r.l.price)}</td><td class="n">${Number(r.l.disc) ? Number(r.l.disc) + '%' : ''}</td><td class="n">${fmt(r.b)}</td><td class="n">${r.rate}%${doc.art32 ? '*' : ''}</td><td class="n">${fmt(r.v)}</td><td class="n">${fmt(r.b + r.v)}</td></tr>`).join('')}</tbody></table>`
        + `<div${sa({ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 4 })}>`
        + `<div${sa({ flex: 1, minWidth: 0 })}><table><thead><tr><th>Стапка</th><th class="n">Основица</th><th class="n">ДДВ</th></tr></thead><tbody>${recs.map(([k, x]) => `<tr><td>${k}%${doc.art32 ? '*' : ''}</td><td class="n">${fmt(x.b)}</td><td class="n">${fmt(x.v)}</td></tr>`).join('')}</tbody></table>`
        + (doc.export ? `<div${sa({ marginTop: 4 })}><b>Извоз – ослободено од ДДВ согласно член 23 од ЗДДВ.</b>${data.icd ? ' ИЦД: ' + h(data.icd) : ''}</div>` : '')
        + extra.map((x) => `<div class="muted"${sa({ marginTop: 3 })}>${h(x)}</div>`).join('')
        + `<div${sa({ marginTop: 6 })}><span class="muted">Со зборови:</span> ${words}</div></div>`
        + `<table${sa({ width: '78mm', margin: '4px 0 0' })}><tbody><tr><td>Износ без ДДВ</td><td class="n">${fmt(T.base)}</td></tr>`
        + `<tr><td>ДДВ${doc.art32 ? ' 18% – пренесена обврска*' : ''}</td><td class="n">${fmt(vatAll)}</td></tr>`
        + (T.advTotal > 0 ? `<tr><td>Вкупно</td><td class="n">${fmt(doc.art32 ? T.base : T.total)}</td></tr>${adv.map((a) => `<tr><td>Одбиен аванс ф-ра ${h(a.invoice.number)}</td><td class="n">−${fmt(a.amount)} + ДДВ</td></tr>`).join('')}` : '')
        + `<tr><td${totCell}>${kind === 'credit' ? 'ИЗНОС НА ОДОБРЕНИЕТО' : 'ЗА ПЛАЌАЊЕ'}</td><td class="n"${totCell}>${fmt(pay)} ${h(cur)}</td></tr>`
        + (doc.currency !== 'MKD' ? `<tr><td>Денарска противвредност</td><td class="n">${fmt(pay * fx)} ден.</td></tr>` : '')
        + `</tbody></table></div>`
        + (doc.art32 ? `<p${sa({ margin: '6px 0 0' })}><b>* ${h(ART32_TXT)}.</b> ДДВ ${fmt(vatAll)} ден. го пресметува и плаќа примателот.</p>` : '')
        + (kind === 'invoice' ? `<p${sa({ margin: '6px 0 0' })}>Плаќање${doc.due ? ' до ' + dmy(doc.due) : ''} на жиро сметка <b>${h(st('bank'))}</b>${st('bankName') ? ' кај ' + h(st('bankName')) : ''}, со повикување на број <b>${h(doc.number)}</b>.</p>` : '')
        + (kind === 'credit' ? `<p${sa({ margin: '6px 0 0' })}>Ве одобруваме за горенаведениот износ. Одобрението го намалува Вашиот долг по наведената фактура. Ве молиме за истиот износ да го намалите претходниот данок.</p>` : '')
        + (kind === 'proforma' ? `<p class="muted"${sa({ margin: '6px 0 0' })}>Профактурата служи за плаќање однапред и не е даночна фактура.</p>` : '')
        + (doc.note ? `<p${sa({ margin: '6px 0 0' })}>${h(doc.note)}</p>` : '')
        + (note ? `<div${sa({ marginTop: 10, fontSize: 10, lineHeight: 1.45, textAlign: 'justify', whiteSpace: 'pre-line' })}><b>НАПОМЕНА:</b><br>${h(note)}</div>` : '')
        + sigBlock;
    }
  }
  return `<div class="pdfdoc printarea">${body}${legal ? `<div${sa({ marginTop: '18mm', fontSize: 8.5, color: '#555', borderTop: '1px solid #ddd', paddingTop: 4 })}>${legal}</div>` : ''}</div>`;
}

/** Default subject and text of the e-mail with the document attached (legacy `sendMail` 7041 / `recMail` 13498). */
export function invoiceMailText(p: {
  kind: string; advance?: boolean; number: string; date: string; due?: string | null; total: number; currency: string;
  firm: { name: string; phone?: string | null; settings?: Record<string, unknown> | null };
}): { subject: string; body: string } {
  const S = (p.firm.settings ?? {}) as Record<string, unknown>;
  const st = (k: string) => String(S[k] ?? '');
  const n = ({ invoice: 'Фактура', credit: 'Одобрение', proforma: 'Профактура', dispatch: 'Испратница' } as Record<string, string>)[p.kind] ?? 'Документ';
  const cur = p.currency === 'MKD' ? 'ден.' : p.currency;
  const subject = `${n} бр. ${p.number} – ${p.firm.name}`;
  const body = `Почитувани,\n\nВо прилог Ви ја доставуваме ${n.toLowerCase()} бр. ${p.number} од ${dmy(p.date)} на износ од ${fmt(p.total)} ${cur}`
    + `${p.due && p.kind !== 'credit' ? `, со рок на плаќање до ${dmy(p.due)}` : ''}.\n`
    + `${st('bank') && p.kind !== 'credit' ? `Уплата на жиро сметка ${st('bank')}${st('bankName') ? ' – ' + st('bankName') : ''}, со повикување на број ${p.number}.\n` : ''}`
    + `\nСо почит,\n${st('signer') || p.firm.name}\n${p.firm.name}${p.firm.phone ? '\nТел.: ' + p.firm.phone : ''}`;
  return { subject, body };
}
