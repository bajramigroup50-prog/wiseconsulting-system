/**
 * Работни налози (производство) — legacy `VIEWS.prod` (final 13986), `runProd` 5669, ACT `delProd` 7226.
 * FIX (LEGACY-MAP §7.4 item 8): accounts from the scheme (`prodWip` 6000, `prodLabour` 4900, `product` 6300) instead of
 * hard-coded literals. Custom materials per order (`pc*`), materials as % of price (`pnbRun`) and write-off without BOM
 * (`rasNorm`) are not ported.
 */
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { productionNeeds } from '@wise/core';
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

type SP = { p?: string; q?: string; d?: string; wh?: string };

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
  const payload = p && q ? JSON.stringify({ date, productId: p.id, qty: q, wh }) : '';
  return (
    <>
      <Hd t="Работни налози" sub="производство" />
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
          {p && !(p.bom ?? []).length && <div className="callout warn">Овој производ нема норматив. <a className="btn sm" href={`/normativ?p=${p.id}`}>Креирај норматив</a></div>}
          {need && need.lines.length > 0 && (
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
