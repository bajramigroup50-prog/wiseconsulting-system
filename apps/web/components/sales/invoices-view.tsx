/**
 * Outgoing document lists and editor (legacy `docList` 4041 → 14311 and `invEditor`), one component for the views
 * izlez / uslugi / odobrenija / profakturi / ispratnici.
 */
import Link from 'next/link';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { addDays, DT, isServiceInvoice, nextDocNumber, type DocKind, type DtKey, type ScanSaleDraft } from '@wise/core/sales';
import {
  aiDocuments, firmPostingContext, invoiceAdvances, invoiceLines, invoices, journals, partners, stockMoves, type DocPayment, type Invoice,
} from '@wise/db';
import { schemeValue } from '@wise/core';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { accountOptions, itemOptions, listPayments, locationOptions, partnerOptions, payState } from '@/lib/sales';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { DownloadCsv } from '@/components/download-csv';
import { approveInvoiceAction, deleteInvoiceAction, saveInvoiceStyle } from '@/app/(app)/izlez/actions';
import { InvoiceEditor, type AdvanceOpt, type RefInvoice } from './invoice-editor';
import { blankLine, newInvoice, s, type EdInvoice, type EdLine } from './model';

/** Legacy `payPill` (3723). */
export function PayPill({ paid, total }: { paid: number; total: number }) {
  const st = payState(paid, total);
  return st === 'paid' ? <span className="pill good">платена</span> : st === 'part' ? <span className="pill warn">делумно</span> : <span className="pill">отворена</span>;
}

export type SP = { nov?: string; edit?: string; from?: string; cr?: string; scan?: string; i?: string; q?: string; m?: string; saved?: string; w?: string; style?: string; back?: string };

const INTRO: Record<DtKey, string> = {
  credit: 'Книжно одобрение (рабат, поврат, корекција на цена) кон купувач. Се книжи како сторно на фактурата (1200, приход и ДДВ на обратна страна) и го намалува долгот по фактурата. Повратница: стоката се враќа на залиха.',
  service: 'Излезни фактури само со услуги (без залиха). Новата фактура се книжи исто како секоја фактура.',
  proforma: 'Профактурата не се книжи. Со „Во фактура“ се претвора во фактура со истите ставки.',
  invoice: 'Фактурата се книжи автоматски. Од неа се печатат испратница и товарен лист.',
  dispatch: 'Испратницата ја раздолжува залихата. Со „Во фактура“ се фактурира без повторно раздолжување.',
};

const lineToEd = (l: typeof invoiceLines.$inferSelect): EdLine => ({
  itemId: l.itemId ?? '', code: l.code ?? '', name: l.name, unit: l.unit ?? '', qty: s(Number(l.qty)), price: s(Number(l.price)),
  disc: Number(l.disc) ? s(Number(l.disc)) : '', rate: s(l.rate), account: l.account,
});

function toEd(i: Invoice, L: (typeof invoiceLines.$inferSelect)[], A: { advanceId: string; amount: string }[]): EdInvoice {
  return {
    id: i.id, kind: i.kind, number: i.number, date: i.date, pdate: i.pdate ?? '', due: i.due ?? '', partnerId: i.partnerId ?? '', warehouseId: i.warehouseId ?? '',
    art32: i.art32, advance: i.advance, export: i.export, svc: i.svc, currency: i.currency, fx: s(Number(i.fx)), refInvoiceId: i.refInvoiceId ?? '',
    creditKind: i.creditKind ?? 'price', creditGross: i.creditGross ? s(Number(i.creditGross)) : '', fromDocId: i.fromDocId ?? '', note: i.note ?? '',
    data: Object.fromEntries(Object.entries(i.data ?? {}).filter(([, v]) => typeof v === 'string')) as Record<string, string>,
    lines: L.map(lineToEd), advances: A.map((a) => ({ advanceId: a.advanceId, amount: s(Number(a.amount)) })), status: i.status,
  };
}

export async function InvoicesView({ dt, sp }: { dt: DtKey; sp: SP }) {
  const { u, firm, year } = await booksPage(DT[dt].view);
  if (!firm) return <NoFirm t={DT[dt].list} />;
  const kind: DocKind = dt === 'service' ? 'invoice' : dt;
  const view = '/' + DT[dt].view;
  const write = canDo(u, 'write', firm.id), del = canDo(u, 'del', firm.id), approve = write && u.role !== 'klient';
  const today = new Date().toISOString().slice(0, 10);
  const dflt = today.startsWith(String(year)) ? today : `${year}-12-31`;

  /* ---------------- editor ---------------- */
  if (write && (sp.nov !== undefined || sp.edit || sp.from || sp.cr || sp.scan)) {
    const ctx = await firmPostingContext(db(), firm);
    const revDefault = schemeValue(ctx, 'revDefault');
    const used = async (k: DocKind, d: string) => (await db().select({ n: invoices.number }).from(invoices)
      .where(and(eq(invoices.firmId, firm.id), eq(invoices.kind, k), sql`extract(year from ${invoices.date}) = ${Number(d.slice(0, 4))}`))).map((r) => r.n);
    const loadFull = async (id: string) => {
      const [i] = await db().select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.firmId, firm.id))).limit(1);
      if (!i) return null;
      const [L, A] = await Promise.all([
        db().select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.lineNo)),
        db().select().from(invoiceAdvances).where(eq(invoiceAdvances.invoiceId, id)),
      ]);
      return toEd(i, L, A);
    };
    let init: EdInvoice = newInvoice(kind, nextDocNumber(await used(kind, dflt), year), dflt, revDefault);
    if (dt === 'service') init.svc = true;
    let title = DT[dt].nova, sub = '', scanInfo: string | undefined, back = view;
    let nalogNo: string | null = null;
    if (sp.edit) {
      const e = await loadFull(sp.edit);
      if (!e) return <NoFirm t="Документот не постои" />;
      init = e;
      title = 'Измена: ' + DT[dt].n.toLowerCase() + ' ' + e.number;
      nalogNo = (await db().select({ n: journals.number }).from(journals).where(and(eq(journals.firmId, firm.id), eq(journals.sourceType, 'invoice'), eq(journals.sourceId, e.id!))).limit(1))[0]?.n ?? null;
    } else if (sp.from) {
      const src = await loadFull(sp.from);
      if (!src) return <NoFirm t="Документот не постои" />;
      // legacy `toInvoice` 7009
      init = { ...init, kind: 'invoice', partnerId: src.partnerId, art32: src.art32, export: src.export, lines: src.lines, note: src.note, warehouseId: src.warehouseId,
        currency: src.currency, fx: src.fx, pdate: src.kind === 'dispatch' ? src.date : dflt, fromDocId: src.id!,
        data: { dAddr: src.data.dAddr ?? '', loadPlace: src.data.loadPlace ?? '', vehicle: src.data.vehicle ?? '', driver: src.data.driver ?? '', ...(src.kind === 'dispatch' ? { dispNo: src.number } : {}) } };
      init.number = nextDocNumber(await used('invoice', dflt), year);
      sub = 'од ' + (src.kind === 'dispatch' ? 'испратница ' : 'профактура ') + src.number;
    } else if (sp.cr) {
      const r = await loadFull(sp.cr);
      if (!r) return <NoFirm t="Документот не постои" />;
      // legacy `crFrom` 8759
      init = { ...newInvoice('credit', nextDocNumber(await used('credit', dflt), year), dflt, revDefault), partnerId: r.partnerId, refInvoiceId: r.id!, art32: r.art32, export: r.export, lines: r.lines.map((l) => ({ ...l })), currency: r.currency, fx: r.fx };
      sub = 'кон фактура ' + r.number;
    } else if (sp.scan) {
      const [doc] = await db().select().from(aiDocuments).where(and(eq(aiDocuments.id, sp.scan), eq(aiDocuments.firmId, firm.id))).limit(1);
      const idx = Number(sp.i ?? 0) || 0;
      const dr = doc?.drafts[idx]?.draft as ScanSaleDraft | undefined;
      if (!doc || !dr) return <NoFirm t="Скенираниот документ не постои" />;
      init = {
        ...init, number: dr.number, date: dr.date, pdate: dr.date, due: dr.due, partnerId: dr.partnerId, art32: dr.art32,
        lines: dr.items.map((l) => ({ ...blankLine(l.konto), itemId: l.itemId, name: l.name, unit: l.unit, qty: s(l.qty), price: s(l.price), rate: s(l.rate) })),
        data: dr.buyer.name ? { buyerName: dr.buyer.name } : {}, scanDocId: doc.id, scanIndex: idx,
      };
      scanInfo = `Податоците се прочитани автоматски${dr.partnerId ? '' : ` – купувачот „${dr.buyer.name}“ (ЕДБ ${dr.buyer.edb || '—'}) го нема во комитенти: додадете го во Партнери и изберете го`}. Проверете ги и зачувајте.`;
      back = sp.back && sp.back.startsWith('/') ? sp.back : '/skan';
    }
    const [P, I, Lc, accts, stockRows, refs, advs] = await Promise.all([
      partnerOptions(firm.id), itemOptions(firm.id), locationOptions(firm.id),
      accountOptions(firm.id, (k) => k.startsWith('7') && !k.startsWith('70')),
      db().select({ item: stockMoves.itemId, wh: stockMoves.locationId, q: sql<string>`sum(${stockMoves.qty})` }).from(stockMoves)
        .where(and(eq(stockMoves.firmId, firm.id), eq(stockMoves.pending, false))).groupBy(stockMoves.itemId, stockMoves.locationId),
      kind === 'credit' ? db().select().from(invoices).where(and(eq(invoices.firmId, firm.id), eq(invoices.kind, 'invoice'), eq(invoices.status, 'posted'))).orderBy(desc(invoices.date)).limit(500) : Promise.resolve([]),
      kind === 'invoice' ? db().select().from(invoices).where(and(eq(invoices.firmId, firm.id), eq(invoices.advance, true), eq(invoices.kind, 'invoice'))) : Promise.resolve([]),
    ]);
    const stock: Record<string, Record<string, number>> = {};
    for (const r of stockRows) (stock[r.item] ??= {})[r.wh ?? 'main'] = Number(r.q);
    const lineMap = async (ids: string[]) => {
      if (!ids.length) return new Map<string, EdLine[]>();
      const L = await db().select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, ids)).orderBy(asc(invoiceLines.lineNo));
      const M = new Map<string, EdLine[]>();
      for (const l of L) (M.get(l.invoiceId) ?? M.set(l.invoiceId, []).get(l.invoiceId)!).push(lineToEd(l));
      return M;
    };
    const RL = await lineMap(refs.map((r) => r.id));
    const AL = await lineMap(advs.map((a) => a.id));
    const usedAdv = advs.length ? await db().select({ a: invoiceAdvances.advanceId, inv: invoiceAdvances.invoiceId, s: invoiceAdvances.amount }).from(invoiceAdvances)
      .where(inArray(invoiceAdvances.advanceId, advs.map((a) => a.id))) : [];
    const refInvoices: RefInvoice[] = refs.map((r) => ({ id: r.id, number: r.number, date: r.date, partnerId: r.partnerId, total: Number(r.total), art32: r.art32, export: r.export, lines: RL.get(r.id) ?? [] }));
    const advances: AdvanceOpt[] = advs.filter((a) => a.id !== init.id).map((a) => ({
      id: a.id, number: a.number, date: a.date, partnerId: a.partnerId, base: Number(a.base), art32: a.art32, lines: AL.get(a.id) ?? [],
      used: usedAdv.filter((x) => x.a === a.id && x.inv !== init.id).reduce((t, x) => t + Number(x.s), 0),
    }));
    return <InvoiceEditor initial={init} title={title} sub={sub} partners={P} items={I} stock={stock} locations={Lc} accounts={accts}
      refInvoices={refInvoices} advances={advances} revDefault={revDefault} revByType={{ service: schemeValue(ctx, 'revService'), goods: schemeValue(ctx, 'revGoods'), material: schemeValue(ctx, 'revGoods'), product: schemeValue(ctx, 'revProduct') }} advanceKonto={schemeValue(ctx, 'advance')} nonVat={!firm.vatRegistered}
      nalogNo={nalogNo} back={back} firmAddress={firm.address} scanInfo={scanInfo} />;
  }

  /* ---------------- list ---------------- */
  const q = (sp.q ?? '').toLowerCase().trim(), mo = sp.m ?? '';
  const rows = await db().select({ i: invoices, p: { name: partners.name, code: partners.code } }).from(invoices).leftJoin(partners, eq(partners.id, invoices.partnerId))
    .where(and(eq(invoices.firmId, firm.id), eq(invoices.kind, kind), sql`extract(year from ${invoices.date}) = ${year}`)).orderBy(asc(invoices.date), asc(invoices.number));
  let all = rows;
  if (kind === 'invoice') {
    const ids = rows.map((r) => r.i.id);
    const L = ids.length ? await db().select({ inv: invoiceLines.invoiceId, itemId: invoiceLines.itemId }).from(invoiceLines).where(inArray(invoiceLines.invoiceId, ids)) : [];
    const types = new Map((await itemOptions(firm.id)).map((x) => [x.id, x.type]));
    all = rows.filter((r) => isServiceInvoice({ svc: r.i.svc, items: L.filter((l) => l.inv === r.i.id) }, (id) => types.get(id)) === (dt === 'service'));
  }
  const nn = (x: string) => parseInt(x.replace(/^\D+/, ''), 10) || 0;
  const list = all.filter(({ i, p }) => (!mo || i.date.slice(5, 7) === mo) && (!q || `${i.number} ${p?.name ?? ''} ${p?.code ?? ''}`.toLowerCase().includes(q)))
    .sort((a, b) => nn(a.i.number) - nn(b.i.number) || (a.i.date < b.i.date ? -1 : 1));
  const J = new Map((await db().select({ s: journals.sourceId, n: journals.number }).from(journals)
    .where(and(eq(journals.firmId, firm.id), eq(journals.sourceType, 'invoice')))).map((x) => [x.s, x.n]));
  const refNo = new Map((kind === 'credit' || kind === 'invoice' ? await db().select({ id: invoices.id, n: invoices.number, k: invoices.kind }).from(invoices).where(eq(invoices.firmId, firm.id)) : []).map((x) => [x.id, x]));
  const inv = kind === 'invoice' || kind === 'credit';
  // Наплатено / Останува (legacy docList: invoices and services). FX invoices: converted back to the invoice currency.
  const payCols = kind === 'invoice';
  const PM = payCols ? await listPayments(firm.id, { invoiceIds: list.map((r) => r.i.id) }) : new Map<string, DocPayment>();
  const payOf = (i: Invoice) => {
    const m = PM.get(i.id), fx = i.currency === 'MKD' ? 1 : Number(i.fx) || 1;
    if (!m) return { paid: 0, rest: Number(i.total), due: Number(i.total) };
    return { paid: Math.round((m.paid / fx) * 100) / 100, rest: Math.round((m.remaining / fx) * 100) / 100, due: Math.round((m.total / fx) * 100) / 100 };
  };
  const T = list.reduce((t, { i }) => ({ b: t.b + Number(i.base), v: t.v + Number(i.vat), t: t.t + Number(i.total), pd: t.pd + (payCols ? payOf(i).paid : 0), r: t.r + (payCols ? payOf(i).rest : 0) }), { b: 0, v: 0, t: 0, pd: 0, r: 0 });
  const st = (i: Invoice) => {
    if (i.status === 'pending') return <span className="pill warn" title="Внесено од клиентот – не е прокнижено">⏳ чека одобрување</span>;
    if (kind === 'credit') return <><span className="pill info">кон ф-ра {refNo.get(i.refInvoiceId ?? '')?.n ?? '—'}</span> {i.creditKind === 'ret' ? <span className="pill warn">↩ Повратница (стока на залиха)</span> : i.creditKind === 'gross' ? <span className="pill">Бруто износ</span> : <span className="pill">По ставки</span>}</>;
    if (kind === 'invoice') { const pm = payOf(i); return <><PayPill paid={pm.paid} total={pm.due} />{i.fromDocId ? <> <span className="pill info">од {refNo.get(i.fromDocId)?.k === 'dispatch' ? 'испратница' : 'профактура'} {refNo.get(i.fromDocId)?.n}</span></> : null}</>; }
    return i.invoicedId ? <span className="pill good">фактурирана {refNo.get(i.invoicedId)?.n ?? ''}</span> : kind === 'dispatch' ? <span className="pill warn">нефактурирана</span> : <span className="pill">отворена</span>;
  };
  const style = (k: string) => String(((firm.settings ?? {}) as Record<string, unknown>)[k] ?? '');
  const settingsOk = canDo(u, 'settings', firm.id);

  return (
    <>
      <Hd t={DT[dt].list} sub={String(year)}>
        {dt === 'invoice' && write && <Link className="btn" href="/skan?k=sale">📷 Скенирај фактури (PDF)</Link>}
        {dt === 'invoice' && settingsOk && <Link className="btn" href={sp.style !== undefined ? view : view + '?style'}>Изглед на фактура…</Link>}
        <DownloadCsv name={`${DT[dt].view}_${year}.csv`} label="Excel" rows={[['Број', 'Налог', 'Датум', 'Валута', 'Комитент', 'Шифра', 'Основица', 'ДДВ', 'Износ', 'Валута/курс'],
          ...list.map(({ i, p }) => [i.number, J.get(i.id) ?? '', dmy(i.date), dmy(i.due), p?.name ?? '', p?.code ?? '', Number(i.base), Number(i.vat), Number(i.total), i.currency === 'MKD' ? '' : `${i.currency} ${i.fx}`])]} />
        {write && <Link className="btn pri" href={view + '?nov'}>+ {DT[dt].nova}</Link>}
      </Hd>
      {sp.saved && <div className="callout good">Документот е зачуван. <Link href={`/print/doc/${sp.saved}`} target="_blank">👁 Преглед / печатење</Link>{sp.w && <><br />{sp.w.split(' | ').map((w, k) => <span key={k}>⚠ {w}<br /></span>)}</>}</div>}
      {settingsOk && sp.style !== undefined && (
        <form action={saveInvoiceStyle} className="card">
          <h2>Изглед на фактурата (печатење)</h2>
          <div className="form">
            <label className="f">Стил<select name="invStyle" defaultValue={style('invStyle') || 'classic'}><option value="classic">Класичен</option><option value="modern">Модерен</option><option value="minimal">Минималистички</option></select></label>
            <label className="f">Боја (модерен)<input name="invColor" type="color" defaultValue={style('invColor') || '#1f5eff'} /></label>
            <label className="f">Жиро сметка<input name="bank" defaultValue={style('bank')} /></label>
            <label className="f">Банка<input name="bankName" defaultValue={style('bankName')} /></label>
            <label className="f">Потписник<input name="signer" defaultValue={style('signer')} /></label>
            <label className="f">Функција<input name="signerRole" defaultValue={style('signerRole') || 'Управител'} /></label>
            <label className="f">Краток назив<input name="short" defaultValue={style('short')} /></label>
            <label className="f">Лого (ID на датотека или URL)<input name="logo" defaultValue={style('logo')} /></label>
            <label className="f">Потпис (ID / URL)<input name="sign" defaultValue={style('sign')} /></label>
            <label className="f">Печат (ID / URL)<input name="stamp" defaultValue={style('stamp')} /></label>
            <label className="f">Фуснота чл. 53<select name="legalFoot" defaultValue={style('legalFoot') || 'auto'}><option value="auto">автоматски</option><option value="paper">хартиена (без печат)</option><option value="esign">е-потпис (чл. 53-б)</option><option value="none">без фуснота</option></select></label>
            <label className="f wide">Напомена на фактурата<textarea name="invNote" rows={3} defaultValue={(firm.settings as Record<string, unknown>)?.invNote as string ?? ''} placeholder="(стандардна напомена)" /></label>
            <label className="chk"><input type="checkbox" name="invNoteDefault" /> врати ја стандардната напомена</label>
          </div>
          <button className="btn pri">Зачувај</button>
        </form>
      )}
      <p className="note">{INTRO[dt]}</p>
      <form className="row" style={{ gap: 8, margin: '0 0 8px', flexWrap: 'wrap' }}>
        <input name="q" defaultValue={sp.q ?? ''} placeholder="🔍 Број, комитент или шифра…" style={{ width: 260 }} />
        <select name="m" defaultValue={mo} style={{ width: 'auto' }}><option value="">Сите месеци</option>{['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map((x) => <option key={x} value={x}>{x}/{year}</option>)}</select>
        <button className="btn">Филтрирај</button><span className="note">{list.length} од {all.length} документи</span>
      </form>
      {list.length ? (
        <div className="tw"><table className="dense">
          <thead><tr><th>Број</th>{inv && <th>Налог</th>}<th>Датум</th><th>Валута</th><th>Комитент</th><th>Шифра</th><th className="n">Основица</th><th className="n">ДДВ</th><th className="n">Износ</th>{payCols && <><th className="n">Наплатено</th><th className="n">Останува</th></>}<th>Статус</th><th></th></tr></thead>
          <tbody>{list.map(({ i, p }) => (
            <tr key={i.id}>
              <td className="num"><b>{i.number}</b></td>{inv && <td className="num">{J.get(i.id) ? <Link href={`/nalozi?n=${encodeURIComponent(J.get(i.id)!)}`}>{J.get(i.id)}</Link> : ''}</td>}
              <td>{dmy(i.date)}</td><td style={i.due && i.due < addDays(new Date().toISOString().slice(0, 10), 0) ? { color: 'var(--bad)' } : undefined}>{dmy(i.due)}</td>
              <td style={{ maxWidth: 280 }}>{p?.name}</td><td className="num">{p?.code}</td>
              <td className="n">{fmt(i.base)}</td><td className="n">{fmt(i.vat)}</td><td className="n"><b>{fmt(i.total)}</b>{i.currency !== 'MKD' && <small className="mini"> {i.currency}</small>}</td>
              {payCols && (() => { const pm = payOf(i); return <><td className="n">{fmt(pm.paid)}</td><td className="n" style={pm.rest > 0.009 && i.due && i.due < today ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>{fmt(pm.rest)}</td></>; })()}
              <td>{st(i)}{i.art32 && <span className="pill info"> 32-а</span>}{i.advance && <span className="pill warn"> авансна</span>}{i.scanned && <span className="pill good"> скенирана</span>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <Link className="btn sm" href={`/print/doc/${i.id}`} target="_blank" title="Преглед и печатење">👁</Link>
                {inv && write && i.status === 'posted' && <Link className="btn sm" href={`/print/doc/${i.id}?mail=1`} target="_blank" title="Испрати по е-пошта (PDF во прилог)">✉</Link>}
                {write && <Link className="btn sm" href={`${view}?edit=${i.id}`} title="Измени">✎</Link>}
                {write && kind === 'invoice' && !i.advance && <Link className="btn sm" href={`/odobrenija?cr=${i.id}`} title="Одобрение или повратница кон оваа фактура">↩ Одобр.</Link>}
                {write && (kind === 'proforma' || kind === 'dispatch') && !i.invoicedId && <Link className="btn sm" href={`/izlez?from=${i.id}`}>Во фактура</Link>}
                {kind === 'invoice' && <Link className="btn sm" href={`/print/doc/${i.id}?k=dispatch`} target="_blank">Испратница</Link>}
                {kind !== 'proforma' && kind !== 'credit' && <Link className="btn sm" href={`/print/doc/${i.id}?k=waybill`} target="_blank">Товарен лист</Link>}
                {inv && <Link className="btn sm" href={`/api/ubl/${i.id}`} title="UBL е-фактура (XML)">XML</Link>}
                {approve && i.status === 'pending' && <RowAction className="btn sm pri" action={approveInvoiceAction.bind(null, i.id)} label="✓ Одобри" confirm={`Да се одобри и прокнижи ${i.number}?`} />}
                {del && <RowAction action={deleteInvoiceAction.bind(null, i.id)} label="🗑" title="Избриши" confirm={`Да се избрише ${DT[dt].n.toLowerCase()} ${i.number}? Се бришат и налогот и движењето на залихата.`} style={{ color: 'var(--bad)' }} />}
              </td>
            </tr>))}</tbody>
          <tfoot><tr><td colSpan={inv ? 6 : 5}>Вкупно ({list.length})</td><td className="n">{fmt(T.b)}</td><td className="n">{fmt(T.v)}</td><td className="n">{fmt(T.t)}</td>{payCols && <><td className="n">{fmt(T.pd)}</td><td className="n">{fmt(T.r)}</td></>}<td colSpan={2} /></tr></tfoot>
        </table></div>
      ) : <div className="card empty">{all.length ? 'Нема документи за овој филтер.' : `Сè уште нема ${DT[dt].list.toLowerCase()} за ${year}.`}</div>}
    </>
  );
}
