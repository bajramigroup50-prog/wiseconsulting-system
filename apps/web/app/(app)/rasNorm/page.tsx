/**
 * Раздолжување на суровини без норматив — legacy `VIEWS.rasNorm` 13870 (later the "ras" tab of Работни налози, 13941),
 * `rnPost`, `rnDel`. Materials are issued for a period by count (opening + received − already issued − counted end) or
 * as a % of sales spread by stock value; optionally the product made from them is received (6300 / 6000).
 */
import Link from 'next/link';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { Retail, stockAt } from '@wise/core';
import { invoices, writeoffDocs } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { locOptions, numIn, pickLoc, stockPage, todayIso } from '@/lib/stock';
import { dmy, fmt, fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { ActionForm } from '@/components/action-form';
import { deleteWriteoffAction, saveWriteoffAction } from '../_retail/actions';

type SP = Record<string, string | undefined>;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function RasNormPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, L } = await stockPage('rasNorm');
  if (!firm || !L) return <NoFirm t="Раздолжување на суровини без норматив" />;
  const write = canDo(u, 'rnPost', firm.id), del = canDo(u, 'del', firm.id);
  const today = todayIso();
  const mode = sp.mode === 'pct' ? 'pct' : 'popis';
  const from = sp.from && ISO.test(sp.from) ? sp.from : today.slice(0, 8) + '01';
  const to = sp.to && ISO.test(sp.to) ? sp.to : today;
  const wh = pickLoc(L, sp.wh) || 'main';
  const prodId = sp.prod && L.ctx.items?.some((i) => i.id === sp.prod && i.type === 'product') ? sp.prod : '';
  // legacy `rnItems`: active materials and goods (materials first)
  const mats = (L.ctx.items ?? []).filter((i) => L.items.get(i.id)?.active !== false && (i.type === 'material' || i.type === 'goods'))
    .sort((a, b) => (a.type === 'material' ? 0 : 1) - (b.type === 'material' ? 0 : 1) || String(a.name).localeCompare(String(b.name), 'mk'));
  const inP = (m: { date: string; wh?: string; pend?: boolean }) => !m.pend && (m.wh || 'main') === wh && m.date >= from && m.date <= to;
  const rows: Retail.RasRow[] = mats.map((it) => {
    const a = stockAt(L.ctx, { item: it.id, wh, date: from, inclusive: false });
    const ms = L.ctx.moves.filter((m) => m.item === it.id && inP(m));
    const now = stockAt(L.ctx, { item: it.id, wh, date: to });
    return {
      itemId: it.id, a: { qty: a.qty, value: a.value },
      iq: ms.filter((m) => m.qty > 0).reduce((s, m) => s + m.qty, 0), iv: ms.filter((m) => m.qty > 0).reduce((s, m) => s + m.value, 0),
      oq: -ms.filter((m) => m.qty < 0).reduce((s, m) => s + m.qty, 0), now: { qty: now.qty, avg: now.avg },
    };
  }).filter((x) => x.a.qty || x.iq || x.now.qty);
  const [[sb], docs] = await Promise.all([
    db().select({ s: sql<string>`coalesce(sum(${invoices.base}), 0)` }).from(invoices)
      .where(and(eq(invoices.firmId, firm.id), eq(invoices.kind, 'invoice'), eq(invoices.status, 'posted'), gte(invoices.date, from), lte(invoices.date, to))),
    db().select().from(writeoffDocs).where(eq(writeoffDocs.firmId, firm.id)).orderBy(desc(writeoffDocs.date)),
  ]);
  const sales = sp.sales != null && sp.sales !== '' ? numIn(sp.sales) || 0 : Number(sb?.s ?? 0);
  const pct = numIn(sp.pct ?? '') || 0;
  const end: Record<string, number | null> = {};
  for (const r of rows) { const v = sp['e_' + r.itemId]; end[r.itemId] = v != null && v !== '' ? numIn(v) : null; }
  const plan = mode === 'popis' ? Retail.rasPlanCount(rows, end) : Retail.rasPlanPct(rows, sales, pct);
  const T = Math.round(plan.reduce((s, x) => s + x.v, 0) * 100) / 100;
  const it = (id: string) => L.ctx.items?.find((i) => i.id === id);
  const prods = (L.ctx.items ?? []).filter((i) => i.type === 'product');
  return (
    <>
      <Hd t="Раздолжување на суровини без норматив" sub="кога нема нормативи – по попис или како % од продажбата"><Link className="btn" href="/prod">🏭 Работни налози</Link></Hd>
      {sp.ok && <div className="callout good">Раздолжувањето е прокнижено.</div>}
      <form className="card">
        <div className="form">
          <label className="f">Начин<select name="mode" defaultValue={mode}><option value="popis">По попис (почетна + набавено − крајна залиха)</option><option value="pct">% од продажбата</option></select></label>
          <label className="f">Од<input type="date" name="from" defaultValue={from} /></label><label className="f">До<input type="date" name="to" defaultValue={to} /></label>
          <label className="f">Објект<select name="wh" defaultValue={wh}>{locOptions(L).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          {mode === 'pct' && <><label className="f">Продажба во периодот без ДДВ<input name="sales" inputMode="decimal" defaultValue={sp.sales ?? String(sales)} /></label><label className="f">Учество на суровините %<input name="pct" inputMode="decimal" defaultValue={sp.pct ?? ''} placeholder="на пр. 55" /></label></>}
          <label className="f">Книжи<select name="prod" defaultValue={prodId}><option value="">како трошок на суровини (Д 4000 / П 3100)</option>{prods.map((p) => <option key={p.id} value={p.id}>во производство на: {p.name} (6000 → 6300)</option>)}</select></label>
          {prodId && <label className="f">Произведена количина<input name="pq" inputMode="decimal" defaultValue={sp.pq ?? ''} /></label>}
        </div>
        <p className="note">{mode === 'popis' ? 'Се раздолжува = почетна залиха + набавено − веќе раздолжено (работни налози, продажба) − крајна залиха од пописот. Внесете ја крајната (пописна) количина; празно = состојбата во програмот.' : 'Вкупната вредност на суровините = продажба × %, распределена на суровините според нивната вредност на залиха (не повеќе од залихата).'}</p>
        <div className="tw"><table className="dense">
          <thead><tr><th>Суровина</th><th className="n">Почетна</th><th className="n">Набавено</th><th className="n">Веќе раздолжено</th><th className="n">{mode === 'popis' ? 'Крајна (попис)' : 'На залиха'}</th><th className="n">За раздолжување</th><th className="n">Просечна цена</th><th className="n">Вредност</th></tr></thead>
          <tbody>{plan.map((x) => (
            <tr key={x.itemId}>
              <td>{it(x.itemId)?.name} <span className="mini">{it(x.itemId)?.unit}</span></td><td className="n">{fq(x.a.qty)}</td><td className="n">{fq(x.iq)}</td><td className="n">{x.oq ? fq(x.oq) : '–'}</td>
              <td className="n">{mode === 'popis' ? <input name={'e_' + x.itemId} defaultValue={sp['e_' + x.itemId] ?? ''} placeholder={fq(x.now.qty)} style={{ width: 100, textAlign: 'right' }} /> : fq(x.now.qty)}</td>
              <td className="n"><b>{fq(x.q)}</b></td><td className="n">{fmt(x.avg)}</td><td className="n">{fmt(x.v)}</td>
            </tr>
          ))}{!plan.length && <tr><td colSpan={8} className="note">Нема суровини со залиха или набавки во периодот.</td></tr>}</tbody>
          <tfoot><tr><td colSpan={7}>Вкупно за раздолжување{mode === 'pct' && sales ? ` (${Math.round((T / sales) * 10000) / 100}% од продажба ${fmt(sales)})` : ''}</td><td className="n"><b>{fmt(T)}</b></td></tr></tfoot>
        </table></div>
        <div className="row" style={{ marginTop: 8 }}><button className="btn">Пресметај</button></div>
      </form>
      {write && (
        <ActionForm action={saveWriteoffAction} className="card" reset={false}>
          {[['mode', mode], ['from', from], ['to', to], ['wh', wh], ['pct', mode === 'pct' ? String(pct) : ''], ['productId', prodId], ['productQty', sp.pq ?? '']].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          {plan.filter((x) => x.q > 0).map((x) => <input key={x.itemId} type="hidden" name={'q_' + x.itemId} value={x.q} />)}
          <div className="row" style={{ gap: 8 }}><button className="btn pri" disabled={!(T > 0)}>Раздолжи и прокнижи ({fmt(T)})</button><span className="note">Се прави еден документ со датум {dmy(to)}; може да се сторнира од листата подолу.</span></div>
        </ActionForm>
      )}
      {docs.length > 0 && (
        <div className="tw"><table>
          <thead><tr><th>Датум</th><th>Начин</th><th>Период</th><th className="n">Вредност</th><th>Производ</th><th /></tr></thead>
          <tbody>{docs.map((d) => (
            <tr key={d.id}><td>{dmy(d.date)}</td><td>{d.mode === 'pct' ? `% од продажба (${Number(d.pct)}%)` : 'по попис'}</td><td>{dmy(d.dateFrom)} – {dmy(d.dateTo)}</td><td className="n">{fmt(d.total)}</td>
              <td>{d.productId ? it(d.productId)?.name : 'трошок 4000'}{d.productQty ? ' · ' + fq(d.productQty) : ''}</td>
              <td>{del && <RowAction action={deleteWriteoffAction.bind(null, d.id)} label="Сторнирај" className="btn sm ghost danger" confirm="Да се сторнира раздолжувањето (се бришат движењата и книжењето)?" />}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
