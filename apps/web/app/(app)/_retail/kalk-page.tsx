/**
 * Влезни калкулации — legacy `VIEWS.kalk` 5523 (`kalkG` = warehouses, `kalkM` = stores, 5522/17374), `kalkState`,
 * `kalkFilter`, `newKalk` 7286, with the later columns Вид (Д/У) and foreign amount (17331). Purchases with stock lines of
 * the business year, totals from `@wise/core` `calculationRows` (purchase value, price difference, retail value with VAT),
 * links to the calculation / ПЛТ prints, the journal, the editor and the transfer to a store; for warehouses / stores
 * the transfers out / in of the year are listed below.
 */
import Link from 'next/link';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { calculationRows, type PurchaseLike } from '@wise/core';
import { journals, partners, purchaseCosts, purchases, purchaseStockLines, transfers } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { stockPage } from '@/lib/stock';
import { dmy, fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { deletePurchaseAction } from '../vlez/actions';

const r2 = (x: number) => Math.round(x * 100) / 100;
export type KalkSP = { wh?: string; q?: string };

export async function KalkPage({ md, sp }: { md: 'warehouse' | 'store'; sp: KalkSP }) {
  const view = md === 'store' ? 'kalkM' : 'kalkG';
  const t = md === 'store' ? 'Влезни калкулации – малопродажба' : 'Влезни калкулации – големопродажба';
  const { u, firm, year, L } = await stockPage(view);
  if (!firm || !L) return <NoFirm t={t} />;
  const write = canDo(u, 'write', firm.id), del = canDo(u, 'del', firm.id);
  const locs = [...(md === 'warehouse' ? [{ id: 'main', name: 'Главен магацин', kind: 'warehouse' as const }] : []), ...L.locations.filter((l) => l.kind === md)];
  if (md === 'store' && !locs.length) {
    return <><Hd t={t} /><div className="card empty">Немате регистрирано продавница. Додајте ја во <b>Шифрарник → Сите шифрарници → Продавници</b>, потоа тука се внесуваат приемите за продавницата, а стоката од магацин се пренесува со „Пренос во продавница“.</div></>;
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
  const ctxItems = { items: L.ctx.items ?? [] };
  const rows = P.map(({ p, pn }) => {
    const P1: PurchaseLike = {
      imp: p.imp, fx: Number(p.fx), wh: p.warehouseId ?? 'main', cnames: p.cnames, distMode: p.distMode, art32: p.art32,
      costs: Object.fromEntries(C.filter((c) => c.purchaseId === p.id).map((c) => [c.slot, { amt: Number(c.amount), fx: c.fx ?? undefined, byQty: c.byQty, doc: c.doc ?? '', lines: c.lines }])),
      stock: ST.filter((s) => s.purchaseId === p.id).map((s) => ({ item: s.itemId, name: s.name ?? '', qty: Number(s.qty), price: Number(s.price), rab: Number(s.rab), cn: s.cn ?? '', dep: s.dep ?? '', sp: s.sp ?? '' })),
    };
    const R = calculationRows(ctxItems, P1);
    const fa = p.imp ? r2(P1.stock!.reduce((a, s) => a + Number(s.qty) * Number(s.price) * (1 - Number(s.rab ?? 0) / 100), 0)) : 0;
    return { p, pn, n: R.length, nab: r2(R.reduce((a, r) => a + r.nabV, 0)), sp: r2(R.reduce((a, r) => a + r.spV, 0)), mg: r2(R.reduce((a, r) => a + r.marg, 0)), fa };
  }).filter((r) => r.n > 0);
  const T = (k: 'nab' | 'sp' | 'mg') => r2(rows.reduce((a, r) => a + r[k], 0));
  const fxBy: Record<string, number> = {};
  for (const r of rows) if (r.p.imp) fxBy[r.p.currency] = r2((fxBy[r.p.currency] ?? 0) + r.fa);
  const TRs = TR.filter((x) => (md === 'store' ? (!wh || x.toLocationId === wh) && kindOf(x.toLocationId) === 'store' : (!wh || (x.fromLocationId ?? 'main') === wh) && kindOf(x.fromLocationId) === 'warehouse'));
  const newHref = '/vlez?nov';
  return (
    <>
      <Hd t={t} sub={md === 'store' ? 'малопродажба' : 'магацин'}>
        {md === 'warehouse' && <Link className="btn" href="/prenosi">Пренос во продавница</Link>}
        <Link className="btn" href="/kalkCalc">Калкулатор</Link>
        {write && <Link className="btn pri" href={newHref}>+ Нова калкулација</Link>}
      </Hd>
      <form className="card"><div className="row" style={{ gap: '10px 16px', alignItems: 'end' }}>
        <label className="mini">Објект (магацин / продавница / маркет) <select name="wh" defaultValue={wh} style={{ width: 'auto' }}>
          <option value="">{md === 'store' ? 'сите продавници' : 'сите магацини'}</option>
          {locs.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.kind === 'store' ? 'продавница' : 'магацин'}</option>)}
        </select></label>
        <input name="q" placeholder="Барај број, фактура, добавувач…" defaultValue={sp.q ?? ''} style={{ width: 260 }} />
        <button className="btn">Прикажи</button>
      </div></form>
      <div className="tiles">
        <div className="tile"><span>Калкулации</span><b>{rows.length}</b><i>{wh ? L.locName(wh) : md === 'store' ? 'сите продавници' : 'сите магацини'} · {year}</i></div>
        <div className="tile"><span>Набавна вредност</span><b>{fmt(T('nab'))}</b></div>
        <div className="tile"><span>Разлика во цена</span><b>{fmt(T('mg'))}</b></div>
        <div className="tile"><span>Продажна вредност со ДДВ</span><b>{fmt(T('sp'))}</b></div>
      </div>
      {rows.length ? (
        <div className="tw"><table>
          <thead><tr><th>Датум</th><th>Калк. бр.</th><th>Фактура</th><th>Добавувач</th><th>Вид</th><th>Објект</th><th className="n">Ставки</th><th className="n">Набавна вредност</th><th className="n">Девизен износ</th><th className="n">Разлика</th><th className="n">Продажна со ДДВ</th><th>Налог</th><th /></tr></thead>
          <tbody>{rows.map(({ p, pn, n, nab, sp: spv, mg, fa }) => (
            <tr key={p.id}>
              <td>{dmy(p.date)}</td><td><b>{p.calcNo || '—'}</b></td><td>{p.number}</td><td>{pn ?? p.supplierName}{p.status === 'pending' && <> <span className="pill warn">чека одобрување</span></>}</td>
              <td>{p.imp ? <span className="pill info">У</span> : 'Д'}</td><td>{L.locName(p.warehouseId)}</td><td className="n">{n}</td><td className="n">{fmt(nab)}</td>
              <td className="n">{p.imp ? `${fmt(fa)} ${p.currency}` : ''}</td><td className="n">{fmt(mg)}</td><td className="n">{fmt(spv)}</td>
              <td>{NM.get(p.id) && <Link className="btn sm ghost" href={`/nalozi?n=${encodeURIComponent(NM.get(p.id)!)}`}>{NM.get(p.id)}</Link>}</td>
              <td className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                <Link className="btn sm" href={`/vlez?edit=${p.id}`}>Отвори</Link>
                <Link className="btn sm" href={`/print/kalk/${p.id}`} target="_blank">Калк. PDF</Link>
                <Link className="btn sm" href={`/print/kalk/${p.id}?t=plt`} target="_blank">ПЛТ</Link>
                {md === 'warehouse' && write && <Link className="btn sm pri" href="/prenosi?nov" title="Пренеси ја стоката од оваа калкулација во продавница">→ Продавница</Link>}
                {del && <RowAction action={deletePurchaseAction.bind(null, p.id)} label="🗑" title="Избриши ја калкулацијата/фактурата заедно со налогот" confirm={`Да се избрише влезната фактура бр. ${p.number || p.calcNo || ''} од ${dmy(p.date)}? Ќе се избрише и налогот и приемот на залиха.`} />}
              </td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={7}>Вкупно</td><td className="n">{fmt(T('nab'))}</td><td className="n">{Object.entries(fxBy).map(([c, v]) => <div key={c}>{fmt(v)} {c}</div>)}</td><td className="n">{fmt(T('mg'))}</td><td className="n">{fmt(T('sp'))}</td><td colSpan={2} /></tr></tfoot>
        </table></div>
      ) : <div className="card empty">Нема {md === 'store' ? 'директни приеми од добавувачи' : 'влезни калкулации'}{wh ? ' за ' + L.locName(wh) : ''} во {year}. Внесете ја фактурата во <Link href="/vlez">Влез</Link> или кликнете „+ Нова калкулација“.</div>}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{md === 'store' ? `Приеми од магацин (преносници) ${year}` : `Излез од магацин – преносници во продавница ${year}`}</h2>
          <Link className="btn" href={md === 'store' ? '/prenosi' : '/prenosi?nov'}>{md === 'store' ? 'Сите преноси' : '+ Нов пренос'}</Link>
        </div>
        {TRs.length ? (
          <div className="tw"><table>
            <thead><tr><th>Датум</th><th>Бр.</th><th>Од</th><th>Во</th><th className="n">Ставки</th><th /></tr></thead>
            <tbody>{TRs.map((x) => <tr key={x.id}><td>{dmy(x.date)}</td><td><b>{x.number}</b></td><td>{L.locName(x.fromLocationId)}</td><td>{L.locName(x.toLocationId)}</td><td className="n">{x.lines.length}</td><td><Link className="btn sm" href={`/prenosi?view=${x.id}`}>Преносница</Link></td></tr>)}</tbody>
          </table></div>
        ) : <p className="note">{md === 'store' ? 'Нема преноси од магацин во продавница.' : 'Нема излез кон продавница.'}</p>}
      </div>
    </>
  );
}
