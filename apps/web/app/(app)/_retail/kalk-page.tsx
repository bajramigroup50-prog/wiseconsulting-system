/**
 * Влезни калкулации — legacy `VIEWS.kalk` 5523 (`kalkG` = warehouses, `kalkM` = stores, 5522/17374), `kalkState`,
 * `kalkFilter`, `newKalk` 7286, with the later columns Вид (Д/У) and foreign amount (17331). Purchases with stock lines of
 * the business year, totals from `@wise/core` `calculationRows` (purchase value, price difference, retail value with VAT),
 * links to the calculation / ПЛТ prints, the journal, the editor and the transfer to a store; for warehouses / stores
 * the transfers out / in of the year are listed below.
 */
import Link from 'next/link';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { calculationRows, transferBookTotals, type PurchaseLike } from '@wise/core';
import { fileLinks, files, journals, partners, purchaseCosts, purchases, purchaseStockLines, transferSources, transfers } from '@wise/db';
import { HELIX_CSS } from '@/lib/helix-css';
import { HelixShell, type HxBtn, type HxGroup, type HxMenu } from '@/components/helix/helix-shell';
import { hxBottom, hxCopyOff, hxMainGroup, hxRo, hxSecurity, hxSort } from '@/lib/helix-config';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { stockPage } from '@/lib/stock';
import { dmy, fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { deletePurchaseAction, deletePurchasesCascadeAction, purchaseDeletePreviewAction } from '../vlez/actions';
import { KsAll, KsBar } from '../_stock/kalk-sel';
import { deleteTransferAction } from '../_stock/actions';
import { ScanUpload } from '@/components/sales/scan-upload';
import { PltWindow } from './plt-window';
import { partnerOptions } from '@/lib/books';
import { Retail } from '@wise/core';
import { like } from 'drizzle-orm';
import { items } from '@wise/db';
import { kalkDialogData } from '@/lib/kalk-header-data';
import { KalkNewKeys } from '@/components/stock/kalk-header-dialog';

const r2 = (x: number) => Math.round(x * 100) / 100;
export type KalkSP = { wh?: string; q?: string; plt?: string; sort?: string };

export async function KalkPage({ md, sp }: { md: 'warehouse' | 'store'; sp: KalkSP }) {
  const view = md === 'store' ? 'kalkM' : 'kalkG';
  const t = md === 'store' ? 'Влезни калкулации – малопродажба' : 'Влезни калкулации – големопродажба';
  const { u, firm, year, L } = await stockPage(view);
  if (!firm || !L) return <NoFirm t={t} />;
  const write = canDo(u, 'write', firm.id), del = canDo(u, 'del', firm.id);
  const locs = [...(md === 'warehouse' ? [{ id: 'main', name: 'Главен магацин', kind: 'warehouse' as const }] : []), ...L.locations.filter((l) => l.kind === md)];
  if (md === 'store' && !locs.length) {
    return <><Hd t={t} /><div className="card empty">Немате регистрирано продавница. Додајте ја во <b>Шифрарник → Сите шифрарници → Продавници</b>, потоа тука се внесуваат приемите за продавницата, а стоката од магацин се пренесува со „Пренос во продавница“.
      <div className="row" style={{ gap: 8, justifyContent: 'center', marginTop: 10 }}><Link className="btn pri" href="/cb_store">+ Додај продавница</Link></div>
      <p className="mini" style={{ marginTop: 8 }}>„📄 ПЛТ на клиентот“ (клиенти што сами го прават приемниот лист) се отвора тука штом фирмата има продавница.</p></div></>;
  }
  const wh = locs.some((l) => l.id === sp.wh) ? sp.wh! : '';
  const kindOf = (id: string | null) => (!id ? 'warehouse' : L.locations.find((l) => l.id === id)?.kind ?? 'warehouse');
  const P0 = await db().select({ p: purchases, pn: partners.name }).from(purchases).leftJoin(partners, eq(partners.id, purchases.partnerId))
    .where(and(eq(purchases.firmId, firm.id), eq(purchases.ptype, 'stock'), gte(purchases.date, `${year}-01-01`), lte(purchases.date, `${year}-12-31`)))
    .orderBy(desc(purchases.date));
  const q = (sp.q ?? '').toLowerCase().trim();
  const P = P0.filter(({ p }) => kindOf(p.warehouseId) === md && (!wh || (p.warehouseId ?? 'main') === wh))
    .filter(({ p, pn }) => !q || `${p.calcNo ?? ''} ${p.number} ${pn ?? p.supplierName ?? ''}`.toLowerCase().includes(q));
  const ids = P.map(({ p }) => p.id);
  const [ST, C, J, TR] = await Promise.all([
    ids.length ? db().select().from(purchaseStockLines).where(inArray(purchaseStockLines.purchaseId, ids)).orderBy(asc(purchaseStockLines.lineNo)) : [],
    ids.length ? db().select().from(purchaseCosts).where(inArray(purchaseCosts.purchaseId, ids)) : [],
    ids.length ? db().select({ s: journals.sourceId, n: journals.number }).from(journals).where(and(eq(journals.firmId, firm.id), eq(journals.sourceType, 'purchase'), inArray(journals.sourceId, ids))) : [],
    db().select().from(transfers).where(and(eq(transfers.firmId, firm.id), gte(transfers.date, `${year}-01-01`), lte(transfers.date, `${year}-12-31`))).orderBy(desc(transfers.date)),
  ]);
  const NM = new Map(J.map((j) => [j.s, j.n]));
  // the scanned / uploaded supplier invoices (📎 on the row)
  const KATT = new Map<string, { id: string; name: string }[]>();
  if (ids.length) for (const f of await db().select({ e: fileLinks.entityId, id: files.id, name: files.name }).from(fileLinks).innerJoin(files, eq(files.id, fileLinks.fileId))
    .where(and(eq(fileLinks.entityType, 'purchase'), inArray(fileLinks.entityId, ids)))) (KATT.get(f.e) ?? KATT.set(f.e, []).get(f.e)!).push({ id: f.id, name: f.name });
  const noName = (await db().select({ code: items.code, name: items.name }).from(items).where(and(eq(items.firmId, firm.id), like(items.name, 'Артикл %')))).filter((i) => Retail.isNoNameItem(i)).length;
  const ctxItems = { items: L.ctx.items ?? [], vatRegistered: firm.vatRegistered };
  const rows = P.map(({ p, pn }) => {
    const P1: PurchaseLike = {
      imp: p.imp, fx: Number(p.fx), wh: p.warehouseId ?? 'main', cnames: p.cnames, distMode: p.distMode, art32: p.art32,
      costs: Object.fromEntries(C.filter((c) => c.purchaseId === p.id).map((c) => [c.slot, { amt: Number(c.amount), fx: c.fx ?? undefined, byQty: c.byQty, doc: c.doc ?? '', lines: c.lines }])),
      stock: ST.filter((s) => s.purchaseId === p.id).map((s) => ({ item: s.itemId, name: s.name ?? '', qty: Number(s.qty), price: Number(s.price), rab: Number(s.rab), cn: s.cn ?? '', dep: s.dep ?? '', sp: s.sp ?? '' })),
    };
    const R = calculationRows(ctxItems, P1);
    const fa = p.imp ? r2(P1.stock!.reduce((a, s) => a + Number(s.qty) * Number(s.price) * (1 - Number(s.rab ?? 0) / 100), 0)) : 0;
    return { p, pn, n: R.length, nab: r2(R.reduce((a, r) => a + r.nabV, 0)), sp: r2(R.reduce((a, r) => a + r.spV, 0)), mg: r2(R.filter((r) => r.spV > 0).reduce((a, r) => a + r.marg, 0)), fa }; // no sale price yet (warehouse): no difference, not −purchase
  }).filter((r) => r.n > 0);
  const T = (k: 'nab' | 'sp' | 'mg') => r2(rows.reduce((a, r) => a + r[k], 0));
  const fxBy: Record<string, number> = {};
  for (const r of rows) if (r.p.imp) fxBy[r.p.currency] = r2((fxBy[r.p.currency] ?? 0) + r.fa);
  const TRs = TR.filter((x) => (md === 'store' ? (!wh || x.toLocationId === wh) && kindOf(x.toLocationId) === 'store' : (!wh || (x.fromLocationId ?? 'main') === wh) && kindOf(x.fromLocationId) === 'warehouse'));
  const SRC = await transferSources(db(), firm.id, TRs);
  const prDel = canDo(u, 'prDel', firm.id);
  const PO = md === 'store' && sp.plt !== undefined ? await partnerOptions(firm.id) : [];
  const newHref = '/vlez?nov';
  // legacy `purDups` callout of the calculations list: same invoice number and date entered twice, the last saved stays
  const nn = (x: string) => x.toLowerCase().replace(/[^0-9a-zа-шѓќљњџѕј]/gi, '');
  const DG = new Map<string, (typeof rows)[number]['p'][]>();
  for (const { p } of rows) if (p.number) { const k = nn(p.number) + '|' + p.date; DG.set(k, [...(DG.get(k) ?? []), p]); }
  const DUPS = [...DG.values()].filter((x) => x.length > 1).flatMap((x) => [...x].sort((a, b) => +b.updatedAt - +a.updatedAt).slice(1));
  // the Helix list („Преглед на влезни калкулации“): oldest first, the newest last (the current row); `?sort=`
  const nnum = (x: string) => parseInt(x.replace(/^\D+/, ''), 10) || 0;
  const shown = [...rows].sort((a, b) => sp.sort === 'no' ? nnum(a.p.calcNo ?? a.p.number) - nnum(b.p.calcNo ?? b.p.number)
    : sp.sort === 'amt' ? a.nab - b.nab : a.p.date < b.p.date ? -1 : a.p.date > b.p.date ? 1 : 0);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Skopje' });
  const KC: [string, number, string?, string?][] = [
    ['*', 14, 'Тековен ред ▸ / означени *'], ['', 22], ['Датум', 72], ['Калк. бр.', 60], ['Фактура', 90], ['Добавувач', 200], ['Вид', 30, 'Домашна / Увозна'], ['Објект', 120],
    ['Ставки', 46, undefined, 'n'], ['Набавна вредност', 90, undefined, 'n'], ['Девизен износ', 84, undefined, 'n'], ['Разлика', 82, undefined, 'n'], ['Продажна со ДДВ', 90, undefined, 'n'], ['Налог', 56], ['', 110],
  ];
  const groups: HxGroup[] = [
    { items: hxMainGroup({ newAct: { href: `/${view}?hnov` }, newKey: false, hasWh: locs.length > 1, label: 'Нова', write }) },
    { items: [
      { label: '👁 Калкулација / PDF', act: { row: 'a[data-print]' }, title: 'Калкулацијата на избраниот прием (печатење / PDF)' },
      { label: 'ПЛТ', act: { row: 'a[data-plt]' }, title: 'Приемен лист на избраниот прием' },
      { label: '📎 Документ (скен / PDF)', act: { row: 'a[data-att]' }, title: 'Скенираната фактура на добавувачот' },
      ...(md === 'warehouse' ? [{ label: '→ Продавница', act: write ? { row: 'a[data-tostore]' } : { off: hxRo }, title: 'Пренеси ја стоката од избраната калкулација во продавница' } as HxBtn] : []),
    ] },
    { title: 'Комерцијално', items: [
      { label: 'Книга на фактури', key: 'F2', act: { href: '/ddvKnigi?t=in' }, title: 'Книга на влезни фактури (ДДВ)' },
      { label: 'Спецификација по комитенти', key: 'F3', act: { href: '/analitika' } },
      { label: 'Пренос во продавница', act: { href: '/prenosi' } },
      { label: 'Нивелација', act: { href: '/nivel' } },
      { label: md === 'store' ? 'Залиха во продавница' : 'Залиха', act: { href: md === 'store' ? '/m_lager' : '/g_lager' } },
      { label: 'Прегл. по налози', act: { href: '/nalozi' } },
    ] },
  ];
  const menu: HxMenu[] = [
    { label: 'Специјални опции', items: [
      { label: '+ Рачен внес (без заглавје)', act: write ? { href: newHref } : { off: hxRo } },
      ...(md === 'store' ? [{ label: '📄 ПЛТ на клиентот', act: write ? { href: '/kalkM?plt' } : { off: hxRo } } as HxBtn] : []),
      ...(md === 'warehouse' ? [{ label: 'Пренос во продавница', act: { href: '/prenosi' } } as HxBtn] : []),
      { label: 'Калкулатор', act: { href: '/kalkCalc' } },
      { label: 'Масовно внесување фактури', act: { href: md === 'store' ? '/masovnoM' : '/masovno' } },
    ] },
    { label: 'Корекција за наплати', items: [
      { label: 'Компензации', act: { href: '/kompenzacii' } },
      { label: 'Повратница до добавувач', act: { href: '/povratDob' } },
      { label: 'Платни налози', act: { href: '/ppNal' } },
    ] },
    hxSecurity(),
    hxSort(`/${view}${wh ? '?wh=' + wh : ''}`),
    hxCopyOff('калкулација'),
    { label: 'Останато', items: [
      { label: '👁 Калкулација на избраната', act: { row: 'a[data-print]' } },
      { label: 'ПЛТ на избраната', act: { row: 'a[data-plt]' } },
      { label: 'Печати ја листата', act: { fn: 'print' } },
    ] },
    { label: 'Е-Фактура', items: [{ label: 'Увоз на е-фактура (UBL XML)', act: { href: '/efaktura' } }] },
  ];
  return (
    <>
      <div className="hx-hd"><Hd t={t} sub={md === 'store' ? 'малопродажба' : 'магацин'}>
        {write && <KalkNewKeys data={await kalkDialogData(firm.id, year)} today={today} label="+ Нова калкулација (Ins)"
          defaults={md === 'store' ? { store: wh || locs[0]?.id || '' } : { wh: wh || 'main' }} />}
      </Hd></div>
      {write && md === 'store' && sp.plt !== undefined && <PltWindow stores={locs.map((l) => ({ id: l.id, name: l.name ?? l.id }))} partners={PO.map((p) => ({ id: p.id, name: p.name }))} today={today} vatReg={firm.vatRegistered} />}
      {noName > 0 && <div className="callout warn" style={{ margin: '6px 0' }}>{noName} артикли се само со шифра („Артикл …“). <Link className="btn sm pri" href="/artNames">✎ Внеси називи</Link></div>}
      {DUPS.length > 0 && del && <div className="callout warn row" style={{ justifyContent: 'space-between', alignItems: 'center' }}><span><b>Дупликати:</b> {DUPS.length} калкулации се внесени двапати (иста фактура {[...new Set(DUPS.map((p) => p.number))].slice(0, 5).join(', ')}). Се задржува последно зачуваната.</span>
        <RowAction className="btn danger" action={deletePurchasesCascadeAction.bind(null, DUPS.map((p) => p.id))} preview={purchaseDeletePreviewAction.bind(null, DUPS.map((p) => p.id))} label={`Избриши ${DUPS.length} дупликати`} confirm={`Ќе се избришат ${DUPS.length} дупликати (иста фактура со ист број и датум). Се задржува последно зачуваната. Продолжи?`} /></div>}
      <div className="hx-list"><style>{HELIX_CSS}</style>
        <HelixShell tableId="kalk-list" groups={groups} menu={menu} bottom={hxBottom('F11')} exitHref="/" filterId="kalk-q"
          wh={{ value: wh, options: [{ v: '', label: md === 'store' ? 'Сите продавници' : 'Сите магацини' }, ...locs.map((l) => ({ v: l.id, label: `${l.name} · ${l.kind === 'store' ? 'продавница' : 'магацин'}` }))] }}
          head={<div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', margin: '0 0 2px', gap: 10, flexWrap: 'wrap' }} data-testid="kalk-firm">
            <span className="hx-firm">{firm.name}</span>
            <span className="mini muted">Преглед на влезни калкулации · {wh ? L.locName(wh) : md === 'store' ? 'сите продавници' : 'сите магацини'} · {year} · {rows.length} калк. · набавна <b>{fmt(T('nab'))}</b> · разлика <b>{fmt(T('mg'))}</b> · продажна <b>{fmt(T('sp'))}</b></span></div>}
          filterOpen={!!(sp.q || sp.sort)}
          filter={<form className="row" style={{ gap: 8 }}>{wh && <input type="hidden" name="wh" value={wh} />}
            <input name="q" id="kalk-q" placeholder="Барај број, фактура, добавувач…" defaultValue={sp.q ?? ''} style={{ width: 260 }} /><button className="btn sm">Прикажи</button>
            {sp.q && <Link className="btn sm ghost" href={`/${view}${wh ? '?wh=' + wh : ''}`}>✕</Link>}</form>}
          menuExtra={{
            ...(write ? { 'Специјални опции': <ScanUpload firmId={firm.id} opts={{ kind: 'purchase', batchId: null, ...(wh && wh !== 'main' ? { warehouseId: wh } : {}) }} small autoOpen={{ back: '/' + view }} batchView={md === 'store' ? '/masovnoM' : '/masovno'}
              label={<><b>📷 Прочитај фактура од PDF</b> — PDF, JPG, PNG или XML е-фактура; калкулацијата се пополнува автоматски.</>} /> } : {}),
            ...(rows.length ? { 'Останато': <><span className="mini">Штиклираните (☑) калкулации:</span><KsBar admin={u.role === 'admin' && del} warehouse={md === 'warehouse'} fix={canDo(u, 'fix', firm.id)} /></> } : {}),
          }}>
          {rows.length ? (
            <div className="tw"><table id="kalk-list" className="dense hx-t">
              <colgroup>{KC.map((c, k) => <col key={k} style={c[1] ? { width: c[1] } : undefined} />)}</colgroup>
              <thead><tr>{KC.map(([tt, , ti, cl], k) => <th key={k} title={ti ?? tt} className={cl}>{k === 1 ? <KsAll /> : tt}</th>)}</tr></thead>
              <tbody>{shown.map(({ p, pn, n, nab, sp: spv, mg, fa }) => (
                <tr key={p.id} data-id={p.id} data-sum={nab}>
                  <td className="hx-mk" />
                  <td className="noprint"><input type="checkbox" name="ks" value={p.id} data-wh={p.warehouseId ?? 'main'} data-p={p.partnerId ?? p.supplierName ?? ''} data-imp={p.imp ? '1' : '0'} data-no={p.calcNo || p.number || ''} /></td>
                  <td className="hx-d">{dmy(p.date)}</td><td className="num"><b>{p.calcNo || '—'}</b></td><td title={p.number}>{p.number}</td>
                  <td title={pn ?? p.supplierName ?? ''}>{pn ?? p.supplierName}{p.status === 'pending' && <> <span className="pill warn">чека одобрување</span></>}</td>
                  <td>{p.imp ? 'У' : 'Д'}</td><td title={L.locName(p.warehouseId)}>{L.locName(p.warehouseId)}</td><td className="n">{n}</td><td className="n">{fmt(nab)}</td>
                  <td className="n">{p.imp ? `${fmt(fa)} ${p.currency}` : ''}</td><td className="n">{spv ? fmt(mg) : '—'}</td><td className="n">{spv ? fmt(spv) : '—'}</td>
                  <td>{NM.get(p.id) && <Link href={`/nalozi?n=${encodeURIComponent(NM.get(p.id)!)}`}>{NM.get(p.id)}</Link>}</td>
                  <td className="hx-a">
                    <Link className="btn sm" href={`/print/kalk/${p.id}`} target="_blank" title="Калкулација (печатење / PDF)" data-print>👁</Link>
                    {(KATT.get(p.id) ?? []).slice(0, 1).map((f) => <a key={f.id} className="btn sm" href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" title={`Скенираниот документ / PDF: ${f.name}`} data-att>📎</a>)}
                    <Link className="btn sm" href={`/vlez?edit=${p.id}`} title="Отвори / измени">✎</Link>
                    <details className="hx-act"><summary className="btn sm" title="Други акции">⋯</summary><div>
                      <Link className="btn sm" href={`/vlez?edit=${p.id}`} data-open>✎ Отвори / измени</Link>
                      <Link className="btn sm" href={`/print/kalk/${p.id}`} target="_blank">👁 Калк. PDF</Link>
                      <Link className="btn sm" href={`/print/kalk/${p.id}?t=plt`} target="_blank" data-plt>ПЛТ</Link>
                      {(KATT.get(p.id) ?? []).map((f) => <a key={f.id} className="btn sm" href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">📎 {f.name.slice(0, 28)}</a>)}
                      {md === 'warehouse' && write && <Link className="btn sm pri" href={`/prenosi?calc=${p.id}`} title="Пренеси ја стоката од оваа калкулација во продавница" data-tostore>→ Продавница</Link>}
                      {NM.get(p.id) && <Link className="btn sm" href={`/nalozi?n=${encodeURIComponent(NM.get(p.id)!)}`}>Налог бр. {NM.get(p.id)}</Link>}
                      {del && <span data-del><RowAction action={deletePurchaseAction.bind(null, p.id, true)} preview={purchaseDeletePreviewAction.bind(null, [p.id])} label="🗑 Избриши" title="Избриши ја калкулацијата/фактурата заедно со налогот" confirm={`Да се избрише влезната фактура бр. ${p.number || p.calcNo || ''} од ${dmy(p.date)}? Ќе се избрише и налогот и приемот на залиха.`} /></span>}
                    </div></details>
                  </td>
                </tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={9}>Вкупно ({rows.length})</td><td className="n">{fmt(T('nab'))}</td><td className="n">{Object.entries(fxBy).map(([c, v]) => <div key={c}>{fmt(v)} {c}</div>)}</td><td className="n">{fmt(T('mg'))}</td><td className="n">{fmt(T('sp'))}</td><td colSpan={2} /></tr></tfoot>
            </table></div>
          ) : <div className="card empty">Нема {md === 'store' ? 'директни приеми од добавувачи' : 'влезни калкулации'}{wh ? ' за ' + L.locName(wh) : ''} во {year}. „Нова (Ins)“ или „Специјални опции“ → Прочитај фактура од PDF.</div>}
        </HelixShell>
      </div>
      <details className="card" style={{ marginTop: 8 }}>
        <summary className="row" style={{ justifyContent: 'space-between', cursor: 'pointer' }}>
          <b>{md === 'store' ? `Приеми од магацин (преносници) ${year}` : `Излез од магацин – преносници во продавница ${year}`} · {TRs.length}</b>
          <Link className="btn sm" href={md === 'store' ? '/prenosi' : '/prenosi?nov'}>{md === 'store' ? 'Сите преноси' : '+ Нов пренос'}</Link>
        </summary>
        {TRs.length ? (
          <div className="tw"><table className="dense">
            <thead><tr><th>Датум</th><th>Бр.</th><th>Од магацин</th><th>Во продавница</th><th className="n">Ставки</th><th className="n">Набавна вредност</th><th className="n">Разлика</th><th className="n">Продажна со ДДВ</th><th className="noprint" /></tr></thead>
            <tbody>{TRs.map((x) => {
              const tt = transferBookTotals(L.ctx, { id: x.id, number: x.number, date: x.date, from: x.fromLocationId ?? 'main', to: x.toLocationId ?? 'main', lines: x.lines.map((l) => ({ item: l.itemId, qty: l.qty, nabU: l.nabU ?? 0, sp: l.sp ?? null })) });
              const orphan = !!SRC.get(x.id)?.missing.length;
              return <tr key={x.id}><td>{dmy(x.date)}</td><td><b>{x.number}</b>{orphan && <> <span className="pill warn" title={x.note ?? ''}>⚠ изворната калкулација е избришана</span></>}</td><td>{L.locName(x.fromLocationId)}</td><td>{L.locName(x.toLocationId)}</td><td className="n">{x.lines.length}</td><td className="n">{fmt(tt.nab)}</td><td className="n">{fmt(tt.marg)}</td><td className="n">{fmt(tt.sp)}</td>
                <td className="row noprint" style={{ gap: 4, flexWrap: 'nowrap' }}><Link className="btn sm" href={`/print/prenos/${x.id}`} target="_blank">Преносница</Link><Link className="btn sm" href={`/print/prenos/${x.id}?t=plt`} target="_blank">ПЛТ</Link>
                  {prDel && <RowAction action={deleteTransferAction.bind(null, x.id, ...(orphan ? ['orphan' as const] : []))} label="🗑" title={orphan ? 'Изворната калкулација е избришана – избриши ја и преносницата' : 'Избриши ја преносницата'}
                    confirm={`${orphan ? 'Изворната калкулација е избришана. ' : ''}Да се избрише преносницата ${x.number} (${x.lines.length} ставки)? Стоката се враќа од ${L.locName(x.toLocationId)} во ${L.locName(x.fromLocationId)}, се брише и налогот.`} />}</td></tr>;
            })}</tbody>
          </table></div>
        ) : <p className="note">{md === 'store' ? 'Нема преноси од магацин во продавница.' : 'Нема излез кон продавница.'}</p>}
      </details>
    </>
  );
}
