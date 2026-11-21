/**
 * Излез од продавница — legacy `VIEWS.m_izlez` 5706 (`MOUT`, `moEditor` 5719, `moSaveDoc` 5766, `moPdfHTML` 5789):
 * type (F7) — продажба / парагон, фактура од продавница, повратница до добавувач, отпис, контролен попис — store
 * filter, the note of the type, the list (Број, Датум, Продавница, Опис / Добавувач, Ставки, value) with Измени / PDF /
 * 🗑, „+ Нов документ (Ins)“, „← Влезни калкулации“, the editor with Excel template / import, and the document print
 * (ПРОДАЖБА / ПАРАГОН, ПОВРАТНИЦА, ЗАПИСНИК ЗА ОТПИС, ЗАПИСНИК ОД КОНТРОЛЕН ПОПИС).
 * Sales / returns: `store_outs` (`saveStoreOut`); counts / write-offs: `stock_counts` (`saveStockCount`).
 */
import { decodeHeader, headerLocation, headerNote } from '@/lib/kalk-header';
import Link from 'next/link';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { priceAt } from '@wise/core';
import { MOUT, moTotal, type MoutKind } from '@wise/core/retail';
import { effectiveChart, itemBarcodes, partners, stockCounts, storeOuts } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { itemOptions, locOptions, stockPage, todayIso } from '@/lib/stock';
import { dmy, fmt, fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { PdfButton } from '@/components/pdf-button';
import { FirmHead } from '@/app/print/firm-head';
import { deleteStockCountAction } from '../_stock/actions';
import { deleteStoreOutAction } from './actions';
import { MoEditor, type MoDraft } from './mo-editor';
import { MoKeys } from './mo-list-tools';
import { HELIX_CSS } from '@/lib/helix-css';
import { HelixShell, type HxGroup, type HxMenu } from '@/components/helix/helix-shell';
import { hxBottom, hxCopyOff, hxMainGroup, hxRo, hxSecurity, hxSort } from '@/lib/helix-config';

type SP = { hx?: string; t?: string; wh?: string; nov?: string; id?: string; view?: string; saved?: string; sort?: string };
const KINDS: MoutKind[] = ['sale', 'inv', 'ret', 'otp', 'pop'];

export default async function MIzlezPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const T: MoutKind = sp.t === 'count' ? 'pop' : sp.t === 'writeoff' ? 'otp' : KINDS.includes(sp.t as MoutKind) ? (sp.t as MoutKind) : 'sale';
  const { u, firm, year, L } = await stockPage('m_izlez');
  if (!firm || !L) return <NoFirm t="Излез од продавница" />;
  const stores = locOptions(L, 'store');
  if (!stores.length) {
    return (
      <>
        <Hd t="Излез од продавница" exp={false} />
        <div className="card empty">Немате регистрирано продавница. Додајте ја во <b>Шифрарник → Сите шифрарници → Продавници</b>.
          <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}><Link className="btn pri" href="/sifrarnik">Отвори шифрарник</Link></div></div>
      </>
    );
  }
  const write = canDo(u, 'moSave', firm.id);
  const W = sp.wh && stores.some((s) => s.id === sp.wh) ? sp.wh : '';
  const its = new Map((L.ctx.items ?? []).map((i) => [i.id, i]));
  const isCount = T === 'otp' || T === 'pop';
  const [counts, outs] = await Promise.all([
    isCount ? db().select().from(stockCounts).where(and(eq(stockCounts.firmId, firm.id), eq(stockCounts.kind, T === 'pop' ? 'count' : 'writeoff'), gte(stockCounts.date, `${year}-01-01`), lte(stockCounts.date, `${year}-12-31`))).orderBy(desc(stockCounts.date), desc(stockCounts.number)) : Promise.resolve([]),
    T === 'sale' || T === 'ret' ? db().select({ o: storeOuts, pn: partners.name }).from(storeOuts).leftJoin(partners, eq(partners.id, storeOuts.partnerId))
      .where(and(eq(storeOuts.firmId, firm.id), eq(storeOuts.kind, T), gte(storeOuts.date, `${year}-01-01`), lte(storeOuts.date, `${year}-12-31`))).orderBy(desc(storeOuts.date), desc(storeOuts.number)) : Promise.resolve([]),
  ]);
  type Doc = { id: string; number: string; date: string; wh: string; desc: string; lines: { itemId: string; qty?: number | null; price?: number | null; val?: number | null; sys?: number | null; cnt?: number | null; diff?: number | null; sp?: number | null }[]; note: string | null; partnerId?: string | null; ref?: string | null; account?: string | null; k1?: string; k2?: string | null };
  const docs: Doc[] = isCount
    ? counts.map((c) => ({ id: c.id, number: c.number, date: c.date, wh: c.locationId ?? 'main', desc: c.note ?? '', note: c.note, k1: c.shortageAccount, k2: c.surplusAccount,
      lines: c.lines.map((l) => {
        const it = its.get(l.itemId);
        return { ...l, val: T === 'otp' && it ? Math.round((l.qty ?? 0) * priceAt(L.ctx, it, c.locationId ?? 'main', c.date) * 100) / 100 : null };
      }) }))
    : outs.map(({ o, pn }) => ({ id: o.id, number: o.number, date: o.date, wh: o.locationId ?? 'main', desc: T === 'ret' ? pn ?? '' : o.note ?? '', lines: o.lines, note: o.note, partnerId: o.partnerId, ref: o.ref, account: o.account }));
  const list = docs.filter((x) => !W || x.wh === W);

  /* ---------- document print (legacy moPdfHTML) ---------- */
  const view = sp.view ? docs.find((x) => x.id === sp.view) : undefined;
  if (view) {
    const rows = view.lines.filter((l) => T !== 'pop' || l.diff);
    const tot = moTotal(T, view.lines);
    const title = (T === 'pop' ? 'ЗАПИСНИК ОД КОНТРОЛЕН ПОПИС' : T === 'otp' ? 'ЗАПИСНИК ЗА ОТПИС' : T === 'ret' ? 'ПОВРАТНИЦА' : 'ПРОДАЖБА / ПАРАГОН') + ' бр. ' + view.number;
    const sub = 'Објект: ' + L.locName(view.wh === 'main' ? null : view.wh) + ' · Датум: ' + dmy(view.date) + (T === 'ret' ? ' · Добавувач: ' + view.desc + (view.ref ? ' · Док. ' + view.ref : '') : '');
    return (
      <>
        <Hd t={MOUT[T].s + ' ' + view.number} exp={false}><Link className="btn" href={'/m_izlez?t=' + T}>← Назад</Link><PdfButton selector="#moDoc" title={title} /></Hd>
        <div id="moDoc"><div className="pdfdoc" style={{ background: '#fff', padding: 12 }}>
          <FirmHead firm={firm} title={title} sub={sub} />
          <table>
            <thead>{T === 'pop'
              ? <tr><th>Р.б.</th><th>Шифра</th><th>Артикл</th><th>ЕМ</th><th className="n">Состојба</th><th className="n">Пописано</th><th className="n">Разлика</th><th className="n">Прод. цена</th><th className="n">Вредност</th></tr>
              : <tr><th>Р.б.</th><th>Шифра</th><th>Артикл</th><th>ЕМ</th><th className="n">Количина</th><th className="n">Прод. цена</th><th className="n">Вредност</th></tr>}</thead>
            <tbody>{rows.map((l, i) => {
              const it = its.get(l.itemId);
              return T === 'pop'
                ? <tr key={i}><td>{i + 1}</td><td>{it?.code}</td><td>{it?.name}</td><td>{it?.unit}</td><td className="n">{fq(l.sys)}</td><td className="n">{fq(l.cnt)}</td><td className="n">{fq(l.diff)}</td><td className="n">{fmt(l.sp)}</td><td className="n">{fmt((l.diff ?? 0) * (l.sp ?? 0))}</td></tr>
                : <tr key={i}><td>{i + 1}</td><td>{it?.code}</td><td>{it?.name}</td><td>{it?.unit}</td><td className="n">{fq(l.qty)}</td><td className="n">{fmt(T === 'sale' ? l.price : (l.val ?? 0) / (l.qty || 1))}</td><td className="n">{fmt(l.val)}</td></tr>;
            })}</tbody>
            <tfoot><tr className="tot"><td colSpan={T === 'pop' ? 8 : 6}>Вкупно (по продажни цени со ДДВ)</td><td className="n">{fmt(tot)}</td></tr></tfoot>
          </table>
          {view.note && <p>{view.note}</p>}
          <div className="grid2" style={{ marginTop: 40 }}>
            <div>{T === 'pop' ? <>Пописна комисија:<br /><br />1. ____________________<br /><br />2. ____________________<br /><br />3. ____________________</> : 'Издал: ____________________'}</div>
            <div style={{ textAlign: 'right' }}>{T === 'ret' ? 'Примил: ____________________' : 'Одговорно лице: ____________________'}<br /><br />{firm.name}</div>
          </div>
        </div></div>
      </>
    );
  }

  /* ---------- editor ---------- */
  if (write && T !== 'inv' && (sp.nov !== undefined || sp.id)) {
    const e = sp.id ? docs.find((x) => x.id === sp.id) : undefined;
    const [bcs, P, chart] = await Promise.all([
      db().select({ itemId: itemBarcodes.itemId, barcode: itemBarcodes.barcode }).from(itemBarcodes).where(eq(itemBarcodes.firmId, firm.id)),
      T === 'ret' ? db().select({ id: partners.id, name: partners.name }).from(partners).where(eq(partners.firmId, firm.id)).orderBy(asc(partners.name)) : Promise.resolve([]),
      effectiveChart(db(), firm.id),
    ]);
    const bcOf = new Map<string, string[]>();
    for (const b of bcs) bcOf.set(b.itemId, [...(bcOf.get(b.itemId) ?? []), b.barcode]);
    const items = itemOptions(L).map((i) => ({ id: i.id, code: i.code, name: i.name, unit: i.unit, barcodes: bcOf.get(i.id) ?? [], rate: i.rate, avg: i.avg, have: i.have, sp: i.sp }));
    const kk = (re: RegExp) => chart.filter((a) => re.test(a.code)).map((a) => [a.code, a.name] as [string, string]);
    const today = todayIso();
    const initial: MoDraft = e
      ? { id: e.id, kind: T as MoDraft['kind'], number: e.number, date: e.date, wh: e.wh, partnerId: e.partnerId ?? '', ref: e.ref ?? '', konto: e.account ?? e.k1 ?? '', konto2: e.k2 ?? '7690', note: e.note ?? '',
        lines: e.lines.map((l) => (T === 'pop' ? { itemId: l.itemId, qty: '', cnt: String(l.cnt ?? '') } : { itemId: l.itemId, qty: String(l.qty ?? ''), price: String(l.price ?? '') })) }
      : { kind: T as MoDraft['kind'], number: '', date: today.startsWith(String(year)) ? today : `${year}-12-31`, wh: W || stores[0]!.id, partnerId: '', ref: '', konto: T === 'sale' ? '1009' : '4690', konto2: '7690', note: '', lines: [] };
    // „Податоци за малопродажна калкулација“ (Helix) → Тип „Парагон“ / „Контролен попис“: the header filled in
    const hx = !e ? decodeHeader(sp.hx) : null;
    if (hx) Object.assign(initial, { date: hx.date, partnerId: hx.partnerId, ref: hx.doc, note: headerNote(hx), ...(stores.some((x) => x.id === headerLocation(hx)) ? { wh: headerLocation(hx) } : {}) });
    return <MoEditor initial={initial} items={items} locs={locOptions(L)} partners={P} k10={kk(/^10/)} k4={kk(/^4/)} k7={kk(/^7/)} />;
  }

  // the Helix list: the type (F7) and the store in the panel / „Магацин“, the documents oldest first (the newest is the current row)
  const nnum = (x: string) => parseInt(x.replace(/^\D+/, ''), 10) || 0;
  const shown = [...list].sort((a, b) => sp.sort === 'no' ? nnum(a.number) - nnum(b.number) : sp.sort === 'amt' ? moTotal(T, a.lines) - moTotal(T, b.lines)
    : a.date < b.date ? -1 : a.date > b.date ? 1 : nnum(a.number) - nnum(b.number));
  const base = `/m_izlez?t=${T}${W ? '&wh=' + W : ''}`;
  const MC: [string, number, string?, string?][] = [
    ['*', 14, 'Тековен ред ▸ / означени *'], ['Број', 80], ['Датум', 72], ['Продавница', 160], [T === 'ret' ? 'Добавувач' : 'Опис', 0], ['Ставки', 50, undefined, 'n'],
    [T === 'pop' ? 'Разлика (прод. вред.)' : 'Продажна вредност', 110, undefined, 'n'], ['', 100],
  ];
  const groups: HxGroup[] = [
    { items: hxMainGroup({ newAct: T === 'inv' ? { href: '/izlez?nov=1' } : { href: `/m_izlez?t=${T}&nov${W ? '&wh=' + W : ''}` }, newKey: false, hasWh: stores.length > 1, label: 'Нов', write }) },
    { title: 'Тип (F7)', items: KINDS.map((k) => ({ label: MOUT[k].n, act: { href: `/m_izlez?t=${k}${W ? '&wh=' + W : ''}` }, cls: k === T ? 'pri' : 'ghost', title: MOUT[k].note })) },
    { items: [
      { label: '👁 PDF', act: { row: 'a[data-print]' }, title: 'Документот (печатење / PDF)' },
      { label: '← Влезни калкулации', act: { href: '/kalkM' } },
    ] },
    { title: 'Продажба', items: [
      { label: 'Каса', act: { href: '/kasa' } },
      { label: 'КДФИ-01 (фискални извештаи)', act: { href: '/kdfi' } },
      { label: 'Промет (ЕТМ)', act: { href: '/m_trg' } },
      { label: 'Залиха во продавница', act: { href: '/m_lager' } },
    ] },
  ];
  const menu: HxMenu[] = [
    { label: 'Специјални опции', items: [
      { label: '+ Нов документ (цел екран)', act: write && T !== 'inv' ? { href: `/m_izlez?t=${T}&nov${W ? '&wh=' + W : ''}` } : { off: T === 'inv' ? 'Фактурите од продавница се во Излезни фактури.' : hxRo } },
      { label: 'Нивелација', act: { href: '/nivel' } },
      { label: 'Влезни калкулации', act: { href: '/kalkM' } },
    ] },
    hxSecurity(),
    hxSort(base),
    hxCopyOff(),
    { label: 'Печатење', items: [
      { label: '👁 PDF на избраниот', act: { row: 'a[data-print]' } },
      { label: 'Печати ја листата', act: { fn: 'print' } },
    ] },
    { label: 'Останато', items: [{ label: 'Сите извештаи', act: { href: '/izvestai' } }] },
  ];
  return (
    <>
      <MoKeys t={T} write={write} />
      <div className="hx-hd"><Hd t="Излез од продавница" sub="раздолжување на залихата во малопродажба" /></div>
      {sp.saved && <div className="callout good">{MOUT[T].s} {sp.saved} е зачуван(а) и залихата е ажурирана.</div>}
      <div className="hx-list"><style>{HELIX_CSS}</style>
        <HelixShell tableId="mo-list" groups={groups} menu={menu} bottom={hxBottom('F11')} exitHref="/"
          wh={{ value: W, options: [{ v: '', label: 'Сите продавници' }, ...stores.map((s) => ({ v: s.id, label: s.name }))] }}
          head={<div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', margin: '0 0 2px', gap: 10, flexWrap: 'wrap' }} data-testid="mo-firm">
            <span className="hx-firm">{firm.name}</span><span className="mini muted">Тип (F7): <b>{MOUT[T].n}</b> · {year} · {list.length} док. · {MOUT[T].note}</span></div>}>
          {T === 'inv'
            ? <div className="card empty">Фактурите од продавница се во <b>Излезни фактури</b> (со објект = продавница).
              <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>{write && <Link className="btn pri" href="/izlez?nov=1">+ Нова фактура од продавница</Link>}<Link className="btn" href="/izlez">Листа на фактури</Link></div></div>
            : list.length ? (
              <div className="tw"><table id="mo-list" className="dense hx-t">
                <colgroup>{MC.map((c, k) => <col key={k} style={c[1] ? { width: c[1] } : undefined} />)}</colgroup>
                <thead><tr>{MC.map(([tt, , ti, cl], k) => <th key={k} title={ti ?? tt} className={cl}>{tt}</th>)}</tr></thead>
                <tbody>{shown.map((x) => (
                  <tr key={x.id} data-id={x.id} data-sum={moTotal(T, x.lines)}>
                    <td className="hx-mk" /><td className="num"><b>{x.number}</b></td><td className="hx-d">{dmy(x.date)}</td><td title={L.locName(x.wh === 'main' ? null : x.wh)}>{L.locName(x.wh === 'main' ? null : x.wh)}</td><td title={x.desc}>{x.desc}</td>
                    <td className="n">{x.lines.filter((l) => T !== 'pop' || l.diff).length}</td><td className="n">{fmt(moTotal(T, x.lines))}</td>
                    <td className="hx-a">
                      <Link className="btn sm" href={`/m_izlez?t=${T}&view=${x.id}`} title="Документот (печатење / PDF)" data-print>👁</Link>
                      {write && <Link className="btn sm" href={`/m_izlez?t=${T}&id=${x.id}`} title="Измени" data-open>✎</Link>}
                      {!write && <Link href={`/m_izlez?t=${T}&view=${x.id}`} data-open hidden>👁</Link>}
                      <details className="hx-act"><summary className="btn sm" title="Други акции">⋯</summary><div>
                        {write && <Link className="btn sm" href={`/m_izlez?t=${T}&id=${x.id}`}>✎ Измени</Link>}
                        <Link className="btn sm" href={`/m_izlez?t=${T}&view=${x.id}`}>👁 PDF</Link>
                        {write && <span data-del><RowAction action={(isCount ? deleteStockCountAction : deleteStoreOutAction).bind(null, x.id)} label="🗑 Избриши" title="Избриши" style={{ color: 'var(--bad)' }} confirm={`Да се избрише ${x.number}? Залихата и налогот се враќаат.`} /></span>}
                      </div></details>
                    </td>
                  </tr>
                ))}</tbody>
                <tfoot><tr><td colSpan={6}>Вкупно ({list.length})</td><td className="n">{fmt(list.reduce((a, x) => a + moTotal(T, x.lines), 0))}</td><td /></tr></tfoot>
              </table></div>
            ) : <div className="card empty">Нема документи „{MOUT[T].s}“ за {year}. „Нов (Ins)“ отвора нов.</div>}
        </HelixShell>
      </div>
    </>
  );
}
