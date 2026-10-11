/**
 * Планирање на производство (MRP) — legacy `VIEWS.mrp` 10000, `mrpCalc`, `mrpDemand`, `mrpReset`, `mrpPo`, `mrpProd`.
 * The plan defaults to open customer-order quantities − stock; BOMs are exploded through semi-products (their free stock
 * first); shortages become supplier orders; a planned product opens a work order.
 */
import Link from 'next/link';
import { Retail, stock } from '@wise/core';
import { customerOrders, lastSuppliers, partners } from '@wise/db';
import { asc, eq } from 'drizzle-orm';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { reservations } from '@/lib/retail';
import { stockPage } from '@/lib/stock';
import { fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { ActionForm } from '@/components/action-form';
import { createPosAction } from '../_retail/actions';

export default async function MrpPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { u, firm, L } = await stockPage('mrp');
  if (!firm || !L) return <NoFirm t="Планирање на производство" />;
  const write = canDo(u, 'mrpPo', firm.id);
  const [R, last, P] = await Promise.all([
    reservations(db(), firm.id), lastSuppliers(db(), firm.id),
    db().select({ id: partners.id, name: partners.name }).from(partners).where(eq(partners.firmId, firm.id)).orderBy(asc(partners.name)),
  ]);
  const pName = new Map(P.map((p) => [p.id, p.name]));
  const items = L.ctx.items ?? [];
  const prods = items.filter((i) => i.type === 'product' && L.items.get(i.id)?.active !== false);
  // open demand for products (legacy `mrpDemand`): rest of open / partly delivered orders
  const D = new Map<string, number>();
  const ords = await db().select().from(customerOrders).where(eq(customerOrders.firmId, firm.id));
  for (const o of ords) {
    const dl = R.deliveries.get(o.id) ?? {};
    const st = Retail.orderState({ id: o.id, status: o.status, lines: o.lines }, dl);
    if (st === 'cancel' || st === 'done') continue;
    for (const l of Retail.orderRest(o.lines, dl)) if (l.itemId && l.rest > 0 && items.find((i) => i.id === l.itemId)?.type === 'product') D.set(l.itemId, (D.get(l.itemId) ?? 0) + l.rest);
  }
  const qty = (id: string) => stock(L.ctx, id).qty;
  const plan: Record<string, number> = {};
  for (const p of prods) {
    const v = sp['p_' + p.id];
    plan[p.id] = v != null && v !== '' ? Number(v.replace(',', '.')) || 0 : Retail.mrpDefaultPlan(D.get(p.id) ?? 0, qty(p.id));
  }
  const r = Retail.mrpCalc(plan, { item: (id) => items.find((i) => i.id === id), stockOf: qty, reserved: R.reserved, onOrder: R.onOrder });
  const nm = (id: string) => items.find((i) => i.id === id);
  const short = r.mats.filter((x) => x.short > 0);
  const semi = r.prods.filter((x) => !plan[x.id]);
  const createMrp = createPosAction.bind(null, 'mrp');
  return (
    <>
      <Hd t="Планирање на производство" sub="потреба од материјали (MRP)">
        <Link className="btn" href="/mrp">↺ Од нарачките</Link><Link className="btn" href="/porachki">🧾 Нарачки од купувачи</Link><Link className="btn" href="/nabavki">📦 Нарачки до добавувачи</Link>
      </Hd>
      <form className="card">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>1. Што треба да се произведе</h2>
        <div className="tw"><table className="dense">
          <thead><tr><th>Производ</th><th className="n">Нарачано (отворено)</th><th className="n">Залиха</th><th className="n">План за производство</th><th /></tr></thead>
          <tbody>{prods.map((p) => (
            <tr key={p.id}>
              <td>{p.name}{!(p.bom ?? []).length && <> <span className="pill warn">нема норматив</span></>}</td>
              <td className="n">{D.get(p.id) ? fq(D.get(p.id)) : ''}</td><td className="n">{fq(qty(p.id))}</td>
              <td className="n"><input name={'p_' + p.id} inputMode="decimal" defaultValue={plan[p.id] || ''} style={{ width: 90 }} /></td>
              <td>{plan[p.id] ? <Link className="btn sm" href={`/prod?p=${p.id}&q=${plan[p.id]}`}>→ Работен налог</Link> : null}</td>
            </tr>
          ))}{!prods.length && <tr><td colSpan={5} className="note">Нема производи.</td></tr>}</tbody>
        </table></div>
        <div className="row savebar" style={{ marginTop: 6 }}><button className="btn">Пресметај</button><span className="note">Предлогот = отворени нарачки од купувачи − залиха. Изменете го планот по потреба.</span></div>
      </form>
      <ActionForm action={createMrp} className="card" reset={false}>
        <div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>2. Потребни материјали</h2>{write && short.length > 0 && <button className="btn pri">Креирај нарачки до добавувачи за недостигот ({short.length})</button>}</div>
        {short.map((x) => <span key={x.id}><input type="hidden" name={'q_' + x.id} value={Math.ceil(x.short * 100) / 100} /><input type="hidden" name={'pid_' + x.id} value={last.get(x.id)?.pid ?? ''} /><input type="hidden" name={'pr_' + x.id} value={last.get(x.id)?.price ?? 0} /></span>)}
        <div className="tw"><table className="dense">
          <thead><tr><th>Материјал</th><th className="n">Потребно</th><th className="n">Залиха</th><th className="n">Резервирано</th><th className="n">Нарачано</th><th className="n">Недостига</th><th>Добавувач</th></tr></thead>
          <tbody>{r.mats.map((x) => (
            <tr key={x.id}>
              <td>{nm(x.id)?.name ?? '?'}</td><td className="n">{fq(x.q)} {nm(x.id)?.unit}</td><td className="n">{fq(x.st)}</td><td className="n">{x.res ? fq(x.res) : ''}</td><td className="n">{x.oo ? fq(x.oo) : ''}</td>
              <td className="n">{x.short > 0 ? <b style={{ color: 'var(--bad)' }}>{fq(x.short)}</b> : <span className="pill good">доволно</span>}</td>
              <td className="mini">{pName.get(last.get(x.id)?.pid ?? '') ?? '—'}</td>
            </tr>
          ))}{!r.mats.length && <tr><td colSpan={7} className="note">Внесете план.</td></tr>}</tbody>
        </table></div>
        {semi.length > 0 && <p className="note">Полупроизводи што треба да се произведат: {semi.map((x) => `${nm(x.id)?.name ?? ''} ${fq(x.q)}`).join(', ')}</p>}
        <p className="note">Нормативите се разложуваат и низ полупроизводите (производ во производ); прво се користи залихата на полупроизводот.</p>
      </ActionForm>
    </>
  );
}
