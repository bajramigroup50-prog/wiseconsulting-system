/**
 * Работни налози (производство) — legacy `VIEWS.prod` (final 13986), `runProd` 5669, ACT `delProd` 7226.
 * FIX (LEGACY-MAP §7.4 item 8): accounts from the scheme (`prodWip` 6000, `prodLabour` 4900, `product` 6300) instead of
 * hard-coded literals. Custom materials per order (`pc*`, `?pc=1`), materials as % of the price without a normativ (`pnbRun`), the
 * v439 hint (normativ per unit, „Доволно за“, maximum) and the tab to the period write-off (`rasNorm`).
 */
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { productionNeeds } from '@wise/core';
import { bomHint, pnbPlan, rnItems } from '@wise/core/parity-stock';
import Link from 'next/link';
import { itemOptions } from '@/lib/stock';
import { CustomProdEditor, PnbPct, PnbRun } from '../_stock/prod-tools';
import { productionOrders } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dateInYear, locOptions, pickLoc, stockPage } from '@/lib/stock';
import { dmy, fmt, fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { ActionForm } from '@/components/stock-ui';
import { deleteProdAction, runProdAction } from '../_stock/actions';

type SP = { p?: string; q?: string; d?: string; wh?: string; pc?: string };

export default async function ProdPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year, L } = await stockPage('prod');
  if (!firm || !L) return <NoFirm t="Работни налози" />;
  const write = canDo(u, 'runProd', firm.id);
  const prods = (L.ctx.items ?? []).filter((i) => i.type === 'product');
  const p = prods.find((x) => x.id === sp.p) ?? prods[0];
  const q = Number(String(sp.q ?? '').replace(',', '.')) || 0;
  const date = dateInYear(sp.d, year);
  const wh = pickLoc(L, sp.wh) || 'main';
  const need = p && q ? productionNeeds(L.ctx, p, q, wh) : null;
  const short = need?.lines.filter((x) => x.short) ?? [];
  const list = await db().select().from(productionOrders)
    .where(and(eq(productionOrders.firmId, firm.id), gte(productionOrders.date, `${year}-01-01`), lte(productionOrders.date, `${year}-12-31`)))
    .orderBy(desc(productionOrders.date), desc(productionOrders.number));
  const names = new Map((L.ctx.items ?? []).map((i) => [i.id, i.name]));
  const hint = p && (p.bom ?? []).length ? bomHint(L.ctx, p, wh) : null;
  const rnPct = Number((L.firm.settings as Record<string, unknown> | null)?.rnPct) || 60;
  const pnb = p && !(p.bom ?? []).length && q > 0 ? pnbPlan(L.ctx, p, q, wh, rnPct, rnItems((L.ctx.items ?? []).map((i) => ({ ...i, active: L.items.get(i.id)?.active })))) : null;
  const payload = p && q ? JSON.stringify({ date, productId: p.id, qty: q, wh }) : '';
  return (
    <>
      <Hd t="Работни налози" sub="производство" />
      <div className="row" style={{ gap: 6, margin: '0 0 10px', flexWrap: 'wrap' }}>
        <Link className="btn pri" href="/prod">🏭 Работен налог (со или без норматив)</Link>
        <Link className="btn" href="/rasNorm">📦 Раздолжување за период – по попис или % од продажба</Link>
      </div>
      {prods.length ? (
        <div className="card">
          <h2>Нов работен налог</h2>
          <form className="form">
            <label className="f">Производ<select name="p" defaultValue={p?.id}>{prods.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label className="f">Количина за производство<input name="q" inputMode="decimal" defaultValue={sp.q ?? ''} /></label>
            <label className="f">Датум<input type="date" name="d" defaultValue={date} /></label>
            <label className="f">Објект (материјали и производ)<select name="wh" defaultValue={wh}>{locOptions(L).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
            <button className="btn">Пресметај</button>
          </form>
          {p && !(p.bom ?? []).length && <div className="callout warn">Овој производ нема норматив. <a className="btn sm" href={`/normativ?p=${p.id}`}>Креирај норматив</a> <Link className="btn sm" href="/rasNorm">📦 Раздолжување за период</Link></div>}
          {p && (p.bom ?? []).length > 0 && !q && hint && hint.rows.length > 0 && (
            <div className="callout" style={{ marginTop: 8 }}>Внесете <b>количина за производство</b> – програмот ќе пресмета колку материјал се троши и дали има доволно на залиха.
              <div className="tw" style={{ marginTop: 6 }}><table className="dense">
                <thead><tr><th>Норматив за 1 {p.unit} {p.name}</th><th className="n">По единица</th><th className="n">На залиха</th><th className="n">Доволно за</th></tr></thead>
                <tbody>{hint.rows.map((r) => { const it = L.ctx.items?.find((i) => i.id === r.itemId); return <tr key={r.itemId}><td>{it?.name}</td><td className="n">{fq(r.perUnit)} {it?.unit}</td><td className="n">{fq(r.have)} {it?.unit}</td><td className="n">{r.enough == null ? '—' : fq(r.enough) + ' ' + (p.unit ?? '')}</td></tr>; })}</tbody>
              </table></div>
              <div className="mini" style={{ marginTop: 4 }}>Најмногу може да се произведе: <b>{fq(hint.max)} {p.unit}</b></div>
            </div>
          )}
          {p && !(p.bom ?? []).length && !q && <div className="callout" style={{ marginTop: 6 }}>Без норматив: внесете <b>количина</b> и програмот ќе ги раздолжи суровините со еден клик (според % од продажната цена).</div>}
          {p && !(p.bom ?? []).length && q > 0 && pnb && (
            <div className="card" style={{ marginTop: 8, borderLeft: '4px solid var(--accent)' }}>
              <div className="row" style={{ gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
                <b>⚡ Раздолжи без норматив</b>{write && <PnbPct pct={rnPct} />}
                <span className="mini">{fq(q)} {p.unit} × продажна цена {fmt(p.price)} × {rnPct}% = <b>{fmt(pnb.total)}</b> материјал</span>
              </div>
              {pnb.lines.length ? (
                <div className="tw" style={{ marginTop: 6 }}><table className="dense">
                  <thead><tr><th>Суровина</th><th className="n">Се раздолжува</th><th className="n">На залиха</th><th className="n">Вредност</th></tr></thead>
                  <tbody>{pnb.lines.map((x) => { const it = L.ctx.items?.find((i) => i.id === x.itemId); return <tr key={x.itemId}><td>{it?.name}</td><td className="n">{fq(x.qty)} {it?.unit}</td><td className="n">{fq(x.have)}</td><td className="n">{fmt(x.value)}</td></tr>; })}</tbody>
                </table></div>
              ) : <div className="callout warn">Нема суровини на залиха во овој објект.</div>}
              {pnb.short > 0.5 && <div className="mini" style={{ color: 'var(--bad)' }}>Залихата не е доволна – недостигаат {fmt(pnb.short)} ден. суровини.</div>}
              {!(Number(p.price) > 0) && <div className="mini" style={{ color: 'var(--bad)' }}>Производот нема продажна цена – внесете ја во Артикли.</div>}
              {write && <div className="row" style={{ gap: 8, marginTop: 6 }}><PnbRun productId={p.id} qty={q} date={date} wh={wh} pct={rnPct} disabled={!pnb.lines.length || !(Number(p.price) > 0)}
                label={`⚡ Раздолжи и заведи ${fq(q)} ${p.unit ?? ''} (${fmt(pnb.lines.reduce((a, x) => a + x.value, 0))})`} /><span className="mini">Д 6000 / П 3100 за суровините · производот на залиха 6300 / 6000 по цена на чинење.</span></div>}
            </div>
          )}
          {p && q > 0 && write && sp.pc === '1' && (
            <CustomProdEditor key={p.id + q} items={itemOptions(L)} product={{ id: p.id, name: p.name ?? '', unit: p.unit ?? '' }} qty={q} date={date} wh={wh} labor={Number(p.labor ?? 0)}
              initial={(p.bom ?? []).map((b) => ({ itemId: b.item, qty: String(Math.round(Number(b.qty) * q * 10000) / 10000) }))} />
          )}
          {p && q > 0 && write && sp.pc !== '1' && <div className="row" style={{ marginTop: 6 }}><Link className="btn" href={`/prod?p=${p.id}&q=${q}&d=${date}&wh=${wh}&pc=1`}>✏ Измени / додади материјали за овој налог</Link></div>}
          {need && need.lines.length > 0 && sp.pc !== '1' && (
            <>
              <div className="tw"><table>
                <thead><tr><th>Материјал</th><th className="n">Потребно</th><th className="n">На залиха</th><th className="n">Вредност</th><th /></tr></thead>
                <tbody>
                  {need.lines.map((x) => <tr key={x.item.id}><td>{x.item.name ?? '?'}</td><td className="n">{fq(x.need)}</td><td className="n">{fq(x.have)}</td><td className="n">{fmt(x.value)}</td>
                    <td>{x.short ? <span className="pill bad">недостига {fq(x.need - x.have)}</span> : <span className="pill good">во ред</span>}</td></tr>)}
                  <tr><td>Труд и општи трошоци</td><td colSpan={2} /><td className="n">{fmt(need.lab)}</td><td /></tr>
                </tbody>
                <tfoot><tr><td colSpan={3}>Вкупна цена на чинење · по единица {fmt(q ? need.total / q : 0)}</td><td className="n">{fmt(need.total)}</td><td /></tr></tfoot>
              </table></div>
              {write && (
                <ActionForm action={runProdAction} className="">
                  <input type="hidden" name="payload" value={payload} />
                  <div className="row"><button className="btn pri" disabled={short.length > 0}>Пушти во производство и прокнижи</button>
                    {short.length > 0 && <span className="note">Недостига материјал на залиха. Внесете приемница пред производството.</span>}</div>
                </ActionForm>
              )}
              <p className="note">Автоматски: се раздолжуваат материјалите (Должи 6000 – Побарува залиха), се пренесува трудот (6000 – 4900) и производот се заведува на залиха (6300 – 6000) по реална цена на чинење.</p>
            </>
          )}
        </div>
      ) : <div className="card empty">Нема производи. Додадете артикл од вид „Готов производ“.</div>}
      {list.length > 0 && (
        <div className="tw"><table>
          <thead><tr><th>Датум</th><th>Бр.</th><th>Производ</th><th>Објект</th><th className="n">Количина</th><th className="n">Материјал</th><th className="n">Труд</th><th className="n">Цена по единица</th><th /></tr></thead>
          <tbody>
            {list.map((x) => (
              <tr key={x.id}>
                <td>{dmy(x.date)}</td><td>{x.number}</td><td>{names.get(x.productId)}</td><td>{L.locName(x.locationId)}</td><td className="n">{fq(x.qty)}</td>
                <td className="n">{fmt(x.mat)}</td><td className="n">{fmt(x.lab)}</td><td className="n">{fmt(x.unitCost)}</td>
                <td>{write && <RowAction action={deleteProdAction.bind(null, x.id)} label="Сторнирај" className="btn sm ghost danger" confirm={`Да се сторнира работниот налог ${x.number}?`} />}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  );
}
