/**
 * Нивелација — legacy `VIEWS.nivel` 5137 → 17433, `ACT.saveNivel` 13211 (+ correction 17188), `nivelPdf`, ledger
 * posting 3461 (`levellingEntries`). FIX (LEGACY-MAP §7.4 item 9): numbers are max + 1 per year (legacy count + 1
 * repeated numbers after a delete); quantities come from the corrected `stockAt` (legacy: always 0).
 */
import { decodeHeader, headerLocation, headerNote } from '@/lib/kalk-header';
import Link from 'next/link';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { levellingDiff, retailOn } from '@wise/core';
import { journals, levellingDocs } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { itemOptions, locOptions, stockPage, todayIso } from '@/lib/stock';
import { itemBarcodes } from '@wise/db';
import { PdfButton } from '@/components/pdf-button';
import { FirmHead, Sig } from '@/app/print/firm-head';
import { NivelEditor } from './nivel-editor';
import { dmy, fmt, fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { PrintButton } from '@/components/stock-ui';
import { deleteLevellingAction } from '../_stock/actions';
import { HELIX_CSS } from '@/lib/helix-css';
import { HelixShell, type HxGroup, type HxMenu } from '@/components/helix/helix-shell';
import { hxBottom, hxCopyOff, hxMainGroup, hxRo, hxSecurity, hxSort } from '@/lib/helix-config';

type SP = { hx?: string; nov?: string; id?: string; view?: string; wh?: string; sort?: string };

export default async function NivelPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year, L } = await stockPage('nivel');
  if (!firm || !L) return <NoFirm t="Нивелација" />;
  const write = canDo(u, 'saveNivel', firm.id);
  const list = await db().select().from(levellingDocs)
    .where(and(eq(levellingDocs.firmId, firm.id), gte(levellingDocs.date, `${year}-01-01`), lte(levellingDocs.date, `${year}-12-31`)))
    .orderBy(desc(levellingDocs.date), desc(levellingDocs.number));
  const posted = new Set(list.length ? (await db().select({ s: journals.sourceId }).from(journals)
    .where(and(eq(journals.firmId, firm.id), eq(journals.sourceType, 'levelling'), inArray(journals.sourceId, list.map((d) => d.id))))).map((r) => r.s) : []);
  const its = new Map((L.ctx.items ?? []).map((i) => [i.id, i]));
  const diffOf = (d: (typeof list)[number]) => levellingDiff(d.lines.map((l) => ({ item: l.itemId, qty: l.qty, old: l.old, new: l.new })));

  const view = sp.view ? list.find((d) => d.id === sp.view) : undefined;
  if (view) {
    return (
      <>
        <Hd t={'Нивелација ' + view.number} exp={false}><Link className="btn" href="/nivel">← Назад</Link><PrintButton /><PdfButton selector=".printarea" title={'Nivelacija_' + view.number.replace(/\//g, '-')} /></Hd>
        <div className="printarea pdfdoc" style={{ background: '#fff', padding: 12 }}>
          <FirmHead firm={firm} title={'НИВЕЛАЦИЈА бр. ' + view.number} sub={L.locName(view.locationId) + ' · ' + dmy(view.date)} />
          <table>
            <thead><tr><th>Р.б.</th><th>Шифра</th><th>Назив</th><th>Ед.</th><th className="n">Количина</th><th className="n">Стара цена</th><th className="n">Нова цена</th><th className="n">Разлика по ед.</th><th className="n">Вкупна разлика</th></tr></thead>
            <tbody>{view.lines.map((l, i) => {
              const it = its.get(l.itemId);
              return <tr key={i}><td>{i + 1}</td><td>{it?.code}</td><td>{it?.name}</td><td>{it?.unit}</td><td className="n">{fq(l.qty)}</td><td className="n">{fmt(l.old)}</td><td className="n">{fmt(l.new)}</td><td className="n">{fmt(l.new - l.old)}</td><td className="n">{fmt(l.qty * (l.new - l.old))}</td></tr>;
            })}</tbody>
            <tfoot><tr><td colSpan={8}>Вкупно</td><td className="n">{fmt(diffOf(view))}</td></tr></tfoot>
          </table>
          {view.note && <p>{view.note}</p>}
          <Sig who={['Изготвил', 'Одговорно лице']} />
        </div>
      </>
    );
  }

  const edit = sp.id ? list.find((d) => d.id === sp.id) : undefined;
  const locs = locOptions(L);
  const stores = locs.filter((l) => l.kind === 'store');
  const today = todayIso();
  const hx = decodeHeader(sp.hx);
  const bcs = write ? await db().select({ itemId: itemBarcodes.itemId, barcode: itemBarcodes.barcode }).from(itemBarcodes).where(eq(itemBarcodes.firmId, firm.id)) : [];
  const bcOf = new Map<string, string[]>();
  for (const b of bcs) bcOf.set(b.itemId, [...(bcOf.get(b.itemId) ?? []), b.barcode]);
  // the editor opens with „Нов (Ins)“ / „Промена“ (or a header from „Податоци за малопродажна калкулација“); the list is the Helix one
  const editing = write && (sp.nov !== undefined || !!edit || !!hx);
  const W = sp.wh && locs.some((l) => l.id === sp.wh) ? sp.wh : '';
  const nnum = (x: string) => parseInt(String(x).replace(/^\D+/, ''), 10) || 0;
  const shown = list.filter((d) => !W || (d.locationId ?? 'main') === W).sort((a, b) => sp.sort === 'no' ? nnum(a.number) - nnum(b.number)
    : sp.sort === 'amt' ? diffOf(a) - diffOf(b) : a.date < b.date ? -1 : a.date > b.date ? 1 : nnum(a.number) - nnum(b.number));
  const NC: [string, number, string?, string?][] = [
    ['*', 14, 'Тековен ред ▸ / означени *'], ['Датум', 72], ['Бр.', 70], ['Објект', 170], ['Ставки', 50, undefined, 'n'], ['Разлика', 100, undefined, 'n'], ['Белешка', 0], ['Книжење', 120], ['', 100],
  ];
  const groups: HxGroup[] = [
    { items: hxMainGroup({ newAct: { href: `/nivel?nov${W ? '&wh=' + W : ''}` }, hasWh: locs.length > 1, label: 'Нов', write }) },
    { items: [
      { label: '👁 PDF', act: { row: 'a[data-print]' }, title: 'Нивелацијата (печатење / PDF)' },
      { label: '✎ Корекција', act: write ? { row: 'a[data-open]' } : { off: hxRo } },
    ] },
    { title: 'Комерцијално', items: [
      { label: 'Влезни калкулации', act: { href: '/kalkM' } },
      { label: 'Излез од продавница', act: { href: '/m_izlez' } },
      { label: 'Залиха во продавница', act: { href: '/m_lager' } },
      { label: 'Прегл. по налози', act: { href: '/nalozi' } },
    ] },
  ];
  const menu: HxMenu[] = [
    { label: 'Специјални опции', items: [{ label: '+ Нова нивелација', act: write ? { href: '/nivel?nov' } : { off: hxRo } }] },
    hxSecurity(),
    hxSort(`/nivel${W ? '?wh=' + W : ''}`),
    hxCopyOff('нивелација'),
    { label: 'Печатење', items: [{ label: '👁 PDF на избраната', act: { row: 'a[data-print]' } }, { label: 'Печати ја листата', act: { fn: 'print' } }] },
    { label: 'Останато', items: [{ label: 'Сите извештаи', act: { href: '/izvestai' } }] },
  ];
  if (editing) {
    return (
      <>
        <NivelEditor key={edit?.id ?? 'new'} locs={locs} items={itemOptions(L).map((i) => ({ id: i.id, code: i.code, name: i.name, unit: i.unit, barcodes: bcOf.get(i.id) ?? [], have: i.have, sp: i.sp }))}
          initial={edit
            ? { id: edit.id, number: edit.number, date: edit.date, wh: edit.locationId ?? 'main', note: edit.note ?? '', promoTo: '', prices: Object.fromEntries(edit.lines.map((l) => [l.itemId, String(l.new)])),
              qty: Object.fromEntries(edit.lines.map((l) => [l.itemId, l.qty])), old: Object.fromEntries(edit.lines.map((l) => [l.itemId, l.old])) }
            : hx ? { date: hx.date, wh: headerLocation(hx) || stores[0]?.id || 'main', note: headerNote(hx), promoTo: '', prices: {}, qty: {}, old: {} }
            : { date: today.startsWith(String(year)) ? today : `${year}-12-31`, wh: W || stores[0]?.id || 'main', note: '', promoTo: '', prices: {}, qty: {}, old: {} }} />
        <p><Link className="btn" href="/nivel">← Листа на нивелации</Link></p>
      </>
    );
  }
  return (
    <>
      <div className="hx-hd"><Hd t="Нивелација" sub="промена на малопродажни цени" /></div>
      <div className="hx-list"><style>{HELIX_CSS}</style>
        <HelixShell tableId="niv-list" groups={groups} menu={menu} bottom={hxBottom('F11')} exitHref="/"
          wh={{ value: W, options: [{ v: '', label: 'Сите објекти' }, ...locs.map((l) => ({ v: l.id, label: l.name }))] }}
          head={<div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', margin: '0 0 2px', gap: 10, flexWrap: 'wrap' }} data-testid="niv-firm">
            <span className="hx-firm">{firm.name}</span><span className="mini muted">Нивелации {year} · {shown.length} · се книжи само во објект по продажни цени (Д 6630 / П 6694 / П 6640)</span></div>}>
          {shown.length ? (
            <div className="tw"><table id="niv-list" className="dense hx-t">
              <colgroup>{NC.map((c, k) => <col key={k} style={c[1] ? { width: c[1] } : undefined} />)}</colgroup>
              <thead><tr>{NC.map(([tt, , ti, cl], k) => <th key={k} title={ti ?? tt} className={cl}>{tt}</th>)}</tr></thead>
              <tbody>{shown.map((d) => (
                <tr key={d.id} data-id={d.id} data-sum={diffOf(d)}>
                  <td className="hx-mk" /><td className="hx-d">{dmy(d.date)}</td><td className="num"><b>{d.number}</b></td><td title={L.locName(d.locationId)}>{L.locName(d.locationId)}</td><td className="n">{d.lines.length}</td><td className="n">{fmt(diffOf(d))}</td>
                  <td title={d.note ?? ''}>{d.note}{d.promoBackOf ? ` (враќање по ${d.promoBackOf})` : ''}</td>
                  <td>{posted.has(d.id) ? <span className="pill good">налог</span> : retailOn(L.ctx, d.locationId ?? 'main') ? <span className="pill warn">без износ</span> : <span className="pill">по набавни цени</span>}</td>
                  <td className="hx-a">
                    <Link className="btn sm" href={`/nivel?view=${d.id}`} title="PDF / печатење" data-print>👁</Link>
                    {write ? <Link className="btn sm" href={`/nivel?id=${d.id}`} title="Корекција" data-open>✎</Link> : <Link href={`/nivel?view=${d.id}`} data-open hidden>👁</Link>}
                    {write && <details className="hx-act"><summary className="btn sm" title="Други акции">⋯</summary><div>
                      <Link className="btn sm" href={`/nivel?id=${d.id}`}>✎ Корекција</Link>
                      <span data-del><RowAction action={deleteLevellingAction.bind(null, d.id)} label="🗑 Избриши" title="Избриши" confirm={`Да се избрише нивелацијата ${d.number}?`} /></span>
                    </div></details>}
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <div className="card empty">Нема нивелации во {year}. „Нов (Ins)“ отвора нова.</div>}
        </HelixShell>
      </div>
    </>
  );
}
