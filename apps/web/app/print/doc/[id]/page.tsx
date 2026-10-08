/**
 * Print of an outgoing document — legacy `docHTML` 4250 (→ 13302 `legalFootTxt`, → 13479 e-sign) and `invAlt` 4227:
 * invoice / advance invoice / credit note / proforma (`?k=` omitted), dispatch note (`?k=dispatch`), waybill (`?k=waybill`).
 *
 * FIX (LEGACY-MAP 3.4 item 6): a non-VAT firm prints no VAT (legacy computed line VAT from `it.rate`).
 * FIX (item 5): art. 32-a "transferred VAT" = `reverseChargeVat(base)` like the editor.
 * FIX (item 11): the document currency is printed (legacy always "ден."), with the denar equivalent.
 * FIX (item 15): in e-signature mode the stamp is not rendered (legacy only resized the signature), and the
 * чл. 53 footnote is printed on tax documents only (invoice, credit note) — not on proformas.
 */
import { notFound } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { ART32_TXT as ART32_TXT_PRINT, firmAllowed } from '@wise/core';
import { amountInWords, INV_NOTE0, invoiceTotals } from '@wise/core/sales';
import { codes, firms, invoiceAdvances, invoiceLines, invoices, items, loadAdvances, partners } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { dmy, fmt, fq } from '@/lib/fmt';
import { PrintBar } from '@/components/sales/print-button';

type K = 'invoice' | 'credit' | 'proforma' | 'dispatch' | 'waybill';
const img = (v: unknown) => {
  const x = String(v ?? '').trim();
  if (!x) return '';
  return /^[0-9a-f-]{36}$/i.test(x) ? `/api/files/${x}` : x;
};

export default async function PrintDoc({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ k?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const u = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [doc] = await db().select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!doc || !firmAllowed(u.principal, doc.firmId)) notFound();
  const [[f], [p], L, A, ref, from] = await Promise.all([
    db().select().from(firms).where(eq(firms.id, doc.firmId)).limit(1),
    doc.partnerId ? db().select().from(partners).where(eq(partners.id, doc.partnerId)).limit(1) : Promise.resolve([undefined]),
    db().select({ l: invoiceLines, code: items.code }).from(invoiceLines).leftJoin(items, eq(items.id, invoiceLines.itemId)).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.lineNo)),
    db().select().from(invoiceAdvances).where(eq(invoiceAdvances.invoiceId, id)),
    doc.refInvoiceId ? db().select().from(invoices).where(eq(invoices.id, doc.refInvoiceId)).limit(1) : Promise.resolve([]),
    doc.fromDocId ? db().select().from(invoices).where(eq(invoices.id, doc.fromDocId)).limit(1) : Promise.resolve([]),
  ]);
  if (!f) notFound();
  const S = (f.settings ?? {}) as Record<string, unknown>;
  const st = (k: string) => String(S[k] ?? '');
  const kind: K = sp.k === 'dispatch' || sp.k === 'waybill' ? sp.k : doc.kind;
  const nonVat = !f.vatRegistered;
  const items0 = L.map(({ l }) => ({ name: l.name, qty: Number(l.qty), price: Number(l.price), disc: Number(l.disc), rate: l.rate, konto: l.account, unit: l.unit ?? '' }));
  const adv = doc.kind === 'invoice' && !doc.advance ? await loadAdvances(db(), A) : [];
  const T = invoiceTotals({ items: items0, art32: doc.art32, advance: doc.advance, credit: doc.kind === 'credit', advances: adv }, { nonVat });
  const cur = doc.currency === 'MKD' ? 'ден.' : doc.currency;
  const curWord = doc.currency === 'MKD' ? 'денари' : doc.currency;
  const T0 = { invoice: doc.advance ? 'АВАНСНА ФАКТУРА' : 'ФАКТУРА', credit: 'КНИЖНО ОДОБРЕНИЕ', proforma: 'ПРОФАКТУРА', dispatch: 'ИСПРАТНИЦА', waybill: 'ТОВАРЕН ЛИСТ' }[kind];
  const AC = '#0d5b4b';
  const data = (doc.data ?? {}) as Record<string, string>;
  const meta: [string, React.ReactNode][] = [['Број', <b key="n">{doc.number}</b>], ['Датум', dmy(doc.date)]];
  if (kind === 'invoice') meta.push(['Датум на промет', dmy(doc.pdate || doc.date)]);
  if ((kind === 'invoice' || kind === 'proforma') && doc.due) meta.push([kind === 'proforma' ? 'Важи до' : 'Рок на плаќање', dmy(doc.due)]);
  if (from[0]) meta.push(['Врска', `${from[0].kind === 'dispatch' ? 'Испратница' : 'Профактура'} бр. ${from[0].number}`]);
  if (data.refDoc) meta.push(['По документ', data.refDoc]);
  if (data.dispNo && kind === 'invoice') meta.push(['Испратница', data.dispNo]);
  if (kind === 'credit' && ref[0]) meta.push(['Кон фактура', `${ref[0].number} од ${dmy(ref[0].date)}`]);
  if (doc.currency !== 'MKD') meta.push(['Валута', `${doc.currency} (курс ${Number(doc.fx)})`]);
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
  const head = (
    <div style={{ borderTop: `4px solid ${AC}`, paddingTop: 10, display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>{logo && <img src={logo} alt="" style={{ maxHeight: '22mm', maxWidth: '45mm' }} />}
        <div><div style={{ fontSize: 15, fontWeight: 700 }}>{f.name}</div><div className="muted">{f.address}<br />ЕДБ: {f.edb} · ЕМБС: {f.embs}{f.phone && <><br />Тел.: {f.phone}</>}{f.email && <>{f.phone ? ' · ' : <br />}{f.email}</>}<br />Жиро сметка: {st('bank')}{st('bankName') && ' · ' + st('bankName')}</div></div></div>
      <div style={{ border: `1.5px solid ${AC}`, minWidth: '64mm' }}><div style={{ background: AC, color: '#fff', padding: '5px 8px', fontSize: 15, fontWeight: 700, letterSpacing: '.05em' }}>{T0}</div>
        <table style={{ margin: 0, fontSize: 10.5 }}><tbody>{meta.map(([a, b], i) => <tr key={i}><td style={{ border: 0, borderBottom: '1px solid #ddd' }}>{a}</td><td className="n" style={{ border: 0, borderBottom: '1px solid #ddd' }}>{b}</td></tr>)}</tbody></table></div>
    </div>
  );
  const buyerBox = <div className="box" style={{ margin: 0 }}><div className="muted" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.06em' }}>{kind === 'waybill' ? 'Примач' : 'Купувач'}</div><b style={{ fontSize: 12 }}>{p?.name}</b><br />{p?.address}<br />ЕДБ: {p?.edb}</div>;
  const sig = (who: string[]) => <div className="sig">{who.map((w) => <span key={w}>{w}</span>)}</div>;

  let body: React.ReactNode;
  if (kind === 'waybill') {
    body = <>{head}
      <div className="grid2" style={{ marginTop: 8 }}><div className="box" style={{ margin: 0 }}><div className="muted" style={{ fontSize: 9, textTransform: 'uppercase' }}>Испраќач</div><b>{f.name}</b><br />{f.address}<br />ЕДБ: {f.edb}</div>{buyerBox}</div>
      <div className="grid2" style={{ marginTop: 6 }}><div className="box" style={{ margin: 0 }}><b>Место на натовар:</b> {data.loadPlace || f.address}<br /><b>Датум на натовар:</b> {dmy(doc.date)}</div><div className="box" style={{ margin: 0 }}><b>Место на истовар:</b> {data.dAddr || p?.address}<br /><b>Датум на истовар:</b> ____________</div></div>
      <div className="box"><b>Возило (рег. број):</b> {data.vehicle || '____________'} &nbsp;&nbsp; <b>Возач:</b> {data.driver || '____________'}</div>
      <table><thead><tr><th style={{ width: '8mm' }}>Р.б.</th><th>Опис</th><th style={{ width: '16mm' }}>Ед. мерка</th><th className="n" style={{ width: '22mm' }}>Количина</th><th className="n" style={{ width: '28mm' }}>Бруто тежина (кг)</th></tr></thead>
        <tbody>{L.map(({ l }, i) => <tr key={i}><td>{i + 1}</td><td>{l.name}</td><td>{l.unit}</td><td className="n">{fq(l.qty)}</td><td /></tr>)}</tbody></table>
      {doc.note && <p>{doc.note}</p>}{sig(['Испраќач', 'Превозник', 'Примач'])}</>;
  } else if (kind === 'dispatch') {
    const [loc] = doc.warehouseId ? await db().select().from(codes).where(and(eq(codes.id, doc.warehouseId))).limit(1) : [];
    const R = L.map(({ l, code }) => {
      const rate = doc.art32 || doc.export || nonVat ? 0 : l.rate;
      const pu = Math.round(Number(l.price) * (1 - Number(l.disc) / 100) * (1 + rate / 100) * 100) / 100;
      return { l, code: l.code || code || '', pu, am: Math.round(pu * Number(l.qty) * 100) / 100 };
    });
    const tot = R.reduce((a, r) => a + r.am, 0);
    const ispNo = doc.kind === 'invoice' ? data.dispNo || doc.number : doc.number;
    body = <>
      {logo && <div style={{ textAlign: 'center', marginBottom: 4 }}><img src={logo} alt="" style={{ maxHeight: '18mm', maxWidth: '60mm' }} /></div>}
      <div className="fh"><div className="fn">{f.name}</div><div className="fa">{f.address}{f.city ? ', ' + f.city : ''} · ЕДБ {f.edb}</div></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, margin: '12px 0 8px', alignItems: 'flex-start' }}>
        <div style={{ fontSize: 11, lineHeight: 1.6 }}><table style={{ margin: 0, width: 'auto', fontSize: 11, border: 0 }}><tbody>
          <tr><td style={{ border: 0, padding: '1px 10px 1px 0' }}><b>Датум</b></td><td style={{ border: 0, padding: '1px 0' }}>{dmy(doc.date)}</td></tr>
          {doc.due && <tr><td style={{ border: 0, padding: '1px 10px 1px 0' }}><b>Валута</b></td><td style={{ border: 0, padding: '1px 0' }}>{dmy(doc.due)}</td></tr>}
          <tr><td style={{ border: 0, padding: '1px 10px 1px 0' }}><b>Од магацин</b></td><td style={{ border: 0, padding: '1px 0' }}>{loc ? `${loc.code ?? ''} ${loc.name.toUpperCase()}` : '01 ГЛАВЕН МАГАЦИН'}</td></tr></tbody></table>
          <div style={{ fontSize: 19, fontWeight: 700, marginTop: 10 }}>Испратница</div><div style={{ fontSize: 13 }}><b>Број:</b> {ispNo}{doc.kind === 'invoice' && <span className="muted" style={{ fontSize: 10 }}> (по фактура {doc.number})</span>}</div></div>
        <div style={{ minWidth: '88mm' }}><div style={{ border: '1.5px solid #111', padding: '6px 8px', minHeight: '22mm' }}><div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{(p?.name ?? '').toUpperCase()}</div><div style={{ fontSize: 13, fontWeight: 700 }}>{(p?.address ?? '').toUpperCase()}</div><div style={{ marginTop: 8 }}>{(p?.city ?? '').toUpperCase()}</div>{p?.edb && <div className="muted" style={{ fontSize: 9.5 }}>ЕДБ: {p.edb}</div>}</div>
          <div style={{ fontSize: 10.5, marginTop: 3 }}>Место на испорака: {data.dAddr ?? ''}</div></div>
      </div>
      <table><thead><tr><th rowSpan={2} style={{ width: '8mm' }}>Р.б</th><th rowSpan={2} style={{ width: '22mm' }}>Шифра</th><th rowSpan={2}>Назив на производот</th><th rowSpan={2} style={{ width: '12mm' }}>ЕМ</th><th rowSpan={2} className="n" style={{ width: '24mm' }}>Количина</th><th colSpan={2} style={{ textAlign: 'center' }}>Цена со данок</th></tr><tr><th className="n" style={{ width: '24mm' }}>По един.</th><th className="n" style={{ width: '28mm' }}>Износ</th></tr></thead>
        <tbody>{R.map((r, i) => <tr key={i}><td>{i + 1}.</td><td>{r.code}</td><td>{r.l.name}</td><td>{(r.l.unit ?? '').toUpperCase()}</td><td className="n">{fq(r.l.qty)}</td><td className="n">{fmt(r.pu)}</td><td className="n">{fmt(r.am)}</td></tr>)}</tbody></table>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 6 }}><b style={{ fontSize: 12 }}>Вкупно:</b><span style={{ border: '1.5px solid #111', padding: '3px 10px', minWidth: '30mm', textAlign: 'right', fontWeight: 700, fontSize: 13 }}>{fmt(tot)}</span></div>
      {doc.note && <p style={{ marginTop: 8 }}>{doc.note}</p>}
      <div className="sig sigimg" style={{ marginTop: '22mm' }}><span style={{ border: 0 }}>ПРИМИЛ</span><span style={{ border: 0 }}>{stamp && <img src={stamp} alt="" className="sti" />}ОДОБРИЛ</span><span style={{ border: 0 }}>{sign && <img src={sign} alt="" className="sgi" />}ИСПРАТИЛ</span></div></>;
  } else {
    const rows = L.map(({ l, code }) => {
      const b = Math.round(Number(l.qty) * Number(l.price) * (1 - Number(l.disc) / 100) * 100) / 100;
      const rate = nonVat ? 0 : doc.art32 ? 18 : l.rate;
      return { l, code, b, rate, v: doc.art32 || nonVat ? 0 : Math.round(b * rate) / 100 };
    });
    const rec = new Map<number, { b: number; v: number }>();
    for (const r of rows) { const x = rec.get(r.rate) ?? { b: 0, v: 0 }; x.b += r.b; x.v += r.v; rec.set(r.rate, x); }
    const vatAll = doc.art32 ? T.transferredVat : T.vat;
    const pay = T.pay;
    const style = st('invStyle') || 'classic';
    const sigBlock = (
      <div className="sig sigimg" style={esign ? { marginTop: '40mm' } : undefined}>
        <span>{sign && <img src={sign} alt="" className="sgi" style={esign ? { maxHeight: '34mm', maxWidth: '75mm', bottom: 'calc(100% + 1mm)' } : undefined} />}{kind === 'proforma' ? 'Изготвил' : 'Фактурирал'}<br /><b>{st('short') || f.name}</b>{st('signer') && <><br />{st('signerRole') || 'Управител'}: <b>{st('signer')}</b></>}</span>
        <span style={{ border: 0 }}>{stamp && <img src={stamp} alt="" className="sti" />}{esign ? '' : 'М.П.'}</span>
        <span>Примил{p?.name && <><br /><b>{p.name}</b></>}</span>
      </div>
    );
    const words = <b>{amountInWords(pay, curWord)}</b>;
    if (style !== 'classic') {
      const M = style === 'minimal';
      const Acol = st('invColor') || (M ? '#111111' : '#1f5eff');
      const soft = Acol + '14';
      const lbl = (x: string) => <div style={{ fontSize: 8.5, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8a8f98', marginBottom: 3 }}>{x}</div>;
      const th = { background: M ? '#fff' : Acol, color: M ? '#111' : '#fff', border: 0, borderBottom: M ? '1.5px solid #111' : 0, padding: '6px 6px', fontSize: 9, letterSpacing: '.06em', textTransform: 'uppercase' as const };
      const td = { border: 0, borderBottom: '1px solid #eceff2', padding: 6 };
      const tr = (a: string, b: string, bold?: boolean) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '3px 0', fontSize: bold ? 12 : 10.5, fontWeight: bold ? 800 : undefined }}><span>{a}</span><span>{b}</span></div>;
      body = <div style={M ? undefined : { borderTop: `5px solid ${Acol}`, paddingTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, ...(M ? { borderBottom: '1px solid #111', paddingBottom: 10 } : {}) }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>{logo ? <img src={logo} alt="" style={{ maxHeight: '20mm', maxWidth: '48mm' }} /> : <div style={{ width: '13mm', height: '13mm', borderRadius: M ? 0 : 10, background: Acol, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 20 }}>{f.name.trim()[0]}</div>}
            <div><div style={{ fontSize: 15, fontWeight: 800 }}>{f.name}</div><div style={{ color: '#666', fontSize: 9.5, lineHeight: 1.45 }}>{[f.address, f.city].filter(Boolean).join(', ')}<br />ЕДБ {f.edb}{f.embs && ' · ЕМБС ' + f.embs}{f.phone && ' · ' + f.phone}{f.email && ' · ' + f.email}</div></div></div>
          <div style={{ textAlign: 'right' }}><div style={{ fontSize: M ? 22 : 26, fontWeight: M ? 300 : 800, letterSpacing: M ? '.25em' : '.02em', color: M ? '#111' : Acol, lineHeight: 1 }}>{T0}</div><div style={{ fontSize: 13, marginTop: 4 }}>бр. <b>{doc.number}</b></div></div></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 10, margin: '14px 0 12px' }}>
          <div style={M ? { borderLeft: '2px solid #111', padding: '2px 10px' } : { background: soft, borderRadius: 10, padding: '10px 12px' }}>{lbl(kind === 'credit' ? 'Одобрение за' : 'Фактурирано на')}<div style={{ fontSize: 13, fontWeight: 700 }}>{p?.name}</div><div style={{ color: '#555', fontSize: 10, lineHeight: 1.45 }}>{[p?.address, p?.city].filter(Boolean).join(', ')}{p?.edb && <><br />ЕДБ {p.edb}</>}</div></div>
          <div style={M ? { borderLeft: '2px solid #111', padding: '2px 10px' } : { border: '1px solid #e3e6ea', borderRadius: 10, padding: '10px 12px' }}>{meta.filter(([a]) => a !== 'Број').map(([a, b], i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10, padding: '1.5px 0' }}><span style={{ color: '#777' }}>{a}</span><span>{b}</span></div>)}
            {kind === 'invoice' && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10, padding: '1.5px 0' }}><span style={{ color: '#777' }}>Повикување на број</span><span><b>{doc.number}</b></span></div>}</div></div>
        <table style={{ borderCollapse: 'collapse', width: '100%', border: 0 }}><thead><tr>{['#', 'Опис', 'Ед.м.', 'Кол.', 'Цена', 'Рабат', 'ДДВ', 'Износ без ДДВ'].map((h, i) => <th key={h} style={th} className={i >= 3 ? 'n' : undefined}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i} style={!M && i % 2 ? { background: soft } : undefined}><td style={td}>{i + 1}</td><td style={td}><b>{r.l.name}</b>{(r.l.code || r.code) && <div style={{ color: '#999', fontSize: 8.5 }}>шифра {r.l.code || r.code}</div>}</td><td style={td}>{r.l.unit}</td><td className="n" style={td}>{fq(r.l.qty)}</td><td className="n" style={td}>{fmt(r.l.price)}</td><td className="n" style={td}>{Number(r.l.disc) ? Number(r.l.disc) + '%' : '–'}</td><td className="n" style={td}>{r.rate}%</td><td className="n" style={td}><b>{fmt(r.b)}</b></td></tr>)}</tbody></table>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, marginTop: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, fontSize: 10, lineHeight: 1.5 }}>{[...rec].sort((a, b) => b[0] - a[0]).map(([k, x]) => <div key={k} style={{ color: '#555' }}>ДДВ {k}%: основица {fmt(x.b)} · данок {fmt(x.v)}</div>)}
            <div style={{ marginTop: 6 }}>{lbl('Со зборови')}{words}</div>
            {doc.export && <div style={{ marginTop: 4 }}><b>Извоз – ослободено од ДДВ согласно член 23 од ЗДДВ.</b></div>}{doc.art32 && <div style={{ marginTop: 4 }}><b>* {ART32_TXT_PRINT}.</b></div>}</div>
          <div style={{ width: '74mm', ...(M ? {} : { background: soft, borderRadius: 10 }), padding: '8px 12px' }}>{tr('Износ без ДДВ', fmt(T.base))}{tr('ДДВ', fmt(vatAll))}{T.advTotal ? tr('Одбиен аванс', '−' + fmt(T.advTotal)) : null}
            <div style={{ borderTop: M ? '1.5px solid #111' : `2px solid ${Acol}`, marginTop: 5, paddingTop: 6, color: M ? '#111' : Acol }}>{tr(kind === 'credit' ? 'ИЗНОС НА ОДОБРЕНИЕТО' : 'ЗА ПЛАЌАЊЕ', fmt(pay) + ' ' + cur, true)}</div></div></div>
        {kind === 'invoice' && <div style={{ marginTop: 12, fontSize: 10, ...(M ? { borderTop: '1px solid #ddd', paddingTop: 8 } : { borderLeft: `3px solid ${Acol}`, background: '#fafbfc', padding: '8px 12px', borderRadius: '0 8px 8px 0' }) }}>{lbl('Плаќање')}Жиро сметка <b>{st('bank')}</b>{st('bankName') && ' · ' + st('bankName')}{doc.due && <> · рок до <b>{dmy(doc.due)}</b></>} · повикување на број <b>{doc.number}</b></div>}
        {kind === 'credit' && <p style={{ margin: '8px 0 0', fontSize: 10 }}>Ве одобруваме за горенаведениот износ. Одобрението го намалува Вашиот долг по наведената фактура.</p>}
        {kind === 'proforma' && <p style={{ margin: '8px 0 0', fontSize: 10, color: '#666' }}>Профактурата служи за плаќање однапред и не е даночна фактура.</p>}
        {doc.note && <p style={{ margin: '8px 0 0', fontSize: 10 }}>{doc.note}</p>}
        {note && <div style={{ marginTop: 10, fontSize: 8.8, color: '#666', lineHeight: 1.45, textAlign: 'justify', whiteSpace: 'pre-line' }}>{lbl('Напомена')}{note}</div>}
        {sigBlock}</div>;
    } else {
      body = <>{head}
        <div className="grid2" style={{ margin: '8px 0' }}>{buyerBox}<div className="box" style={{ margin: 0 }}>{f.city && <><b>Место на издавање:</b> {f.city}<br /></>}{data.dAddr && <><b>Место на испорака:</b> {data.dAddr}<br /></>}{kind === 'invoice' && <><b>Повикување на број:</b> {doc.number}</>}</div></div>
        <table><thead><tr><th style={{ width: '7mm' }}>Р.б.</th><th>Опис</th><th style={{ width: '11mm' }}>Ед.м.</th><th className="n">Кол.</th><th className="n">Цена без ДДВ</th><th className="n">Рабат</th><th className="n">Износ без ДДВ</th><th className="n">ДДВ %</th><th className="n">ДДВ</th><th className="n">Вкупно</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}><td>{i + 1}</td><td>{r.l.name}</td><td>{r.l.unit}</td><td className="n">{fq(r.l.qty)}</td><td className="n">{fmt(r.l.price)}</td><td className="n">{Number(r.l.disc) ? Number(r.l.disc) + '%' : ''}</td><td className="n">{fmt(r.b)}</td><td className="n">{r.rate}%{doc.art32 ? '*' : ''}</td><td className="n">{fmt(r.v)}</td><td className="n">{fmt(r.b + r.v)}</td></tr>)}</tbody></table>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 4 }}>
          <div style={{ flex: 1, minWidth: 0 }}><table><thead><tr><th>Стапка</th><th className="n">Основица</th><th className="n">ДДВ</th></tr></thead><tbody>{[...rec].sort((a, b) => b[0] - a[0]).map(([k, x]) => <tr key={k}><td>{k}%{doc.art32 ? '*' : ''}</td><td className="n">{fmt(x.b)}</td><td className="n">{fmt(x.v)}</td></tr>)}</tbody></table>
            {doc.export && <div style={{ marginTop: 4 }}><b>Извоз – ослободено од ДДВ согласно член 23 од ЗДДВ.</b>{data.icd && ' ИЦД: ' + data.icd}</div>}
            {[data.payMethod && data.payMethod !== 'Вирман' ? 'Начин на плаќање: ' + data.payMethod : '', data.parity ? 'Паритет: ' + data.parity : '', data.pay1, data.pay2, data.pay3].filter(Boolean).map((x, i) => <div key={i} className="muted" style={{ marginTop: 3 }}>{x}</div>)}
            <div style={{ marginTop: 6 }}><span className="muted">Со зборови:</span> {words}</div></div>
          <table style={{ width: '78mm', margin: '4px 0 0' }}><tbody><tr><td>Износ без ДДВ</td><td className="n">{fmt(T.base)}</td></tr>
            <tr><td>ДДВ{doc.art32 ? ' 18% – пренесена обврска*' : ''}</td><td className="n">{fmt(vatAll)}</td></tr>
            {T.advTotal > 0 && <><tr><td>Вкупно</td><td className="n">{fmt(doc.art32 ? T.base : T.total)}</td></tr>{adv.map((a) => <tr key={a.invoice.id}><td>Одбиен аванс ф-ра {a.invoice.number}</td><td className="n">−{fmt(a.amount)} + ДДВ</td></tr>)}</>}
            <tr><td style={{ background: AC, color: '#fff', fontWeight: 700, fontSize: 11.5 }}>{kind === 'credit' ? 'ИЗНОС НА ОДОБРЕНИЕТО' : 'ЗА ПЛАЌАЊЕ'}</td><td className="n" style={{ background: AC, color: '#fff', fontWeight: 700, fontSize: 11.5 }}>{fmt(pay)} {cur}</td></tr>
            {doc.currency !== 'MKD' && <tr><td>Денарска противвредност</td><td className="n">{fmt(pay * Number(doc.fx))} ден.</td></tr>}</tbody></table>
        </div>
        {doc.art32 && <p style={{ margin: '6px 0 0' }}><b>* {ART32_TXT_PRINT}.</b> ДДВ {fmt(vatAll)} ден. го пресметува и плаќа примателот.</p>}
        {kind === 'invoice' && <p style={{ margin: '6px 0 0' }}>Плаќање{doc.due && ' до ' + dmy(doc.due)} на жиро сметка <b>{st('bank')}</b>{st('bankName') && ' кај ' + st('bankName')}, со повикување на број <b>{doc.number}</b>.</p>}
        {kind === 'credit' && <p style={{ margin: '6px 0 0' }}>Ве одобруваме за горенаведениот износ. Одобрението го намалува Вашиот долг по наведената фактура. Ве молиме за истиот износ да го намалите претходниот данок.</p>}
        {kind === 'proforma' && <p className="muted" style={{ margin: '6px 0 0' }}>Профактурата служи за плаќање однапред и не е даночна фактура.</p>}
        {doc.note && <p style={{ margin: '6px 0 0' }}>{doc.note}</p>}
        {note && <div style={{ marginTop: 10, fontSize: 10, lineHeight: 1.45, textAlign: 'justify', whiteSpace: 'pre-line' }}><b>НАПОМЕНА:</b><br />{note}</div>}
        {sigBlock}</>;
    }
  }
  return (
    <>
      <PrintBar />
      <div className="pdfdoc printarea">
        {body}
        {legal && <div style={{ marginTop: '18mm', fontSize: 8.5, color: '#555', borderTop: '1px solid #ddd', paddingTop: 4 }}>{legal}</div>}
      </div>
    </>
  );
}
