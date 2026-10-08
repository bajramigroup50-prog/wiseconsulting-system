/**
 * Нормативи (производство) — legacy `VIEWS.normativ` (final 13914), `saveBom` 13902, `unitCost` 5629.
 * FIX (LEGACY-MAP §7.4 item 13): `unitCost` has a cycle guard and a cyclic normativ is refused on save. AI-suggested
 * BOM (`bomAI` 13860) is not ported — TODO(ai).
 */
import Link from 'next/link';
import { r2, trackedItems, unitCost } from '@wise/core';
import { boms } from '@wise/db';
import { and, eq } from 'drizzle-orm';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { itemOptions, stockPage } from '@/lib/stock';
import { fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { BomEditor } from '../_stock/editors';

export default async function NormativPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const sp = await searchParams;
  const { u, firm, L } = await stockPage('normativ');
  if (!firm || !L) return <NoFirm t="Нормативи" />;
  const prods = (L.ctx.items ?? []).filter((i) => i.type === 'product');
  if (!prods.length) return <><Hd t="Нормативи" sub="состав на производот" /><div className="card empty">Нема производи. Во „Артикли“ додадете артикл од вид „Готов производ“ и неговите материјали.</div></>;
  const p = prods.find((x) => x.id === sp.p) ?? prods[0]!;
  const [bom] = await db().select().from(boms).where(and(eq(boms.firmId, firm.id), eq(boms.productId, p.id))).limit(1);
  const items = itemOptions(L);
  const opt = items.find((i) => i.id === p.id)!;
  const cost = unitCost(L.ctx, p);
  const price = Number(p.price) || 0;
  return (
    <>
      <Hd t="Нормативи" sub="состав на производот" />
      <div className="card">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {prods.map((x) => <Link key={x.id} className={`btn sm ${x.id === p.id ? 'pri' : ''}`} href={`/normativ?p=${x.id}`}>{x.name}</Link>)}
        </div>
        <p className="note">Цена на чинење за 1 {p.unit}: <b>{fmt(cost)}</b> (со подсклопови) · Продажна цена: {fmt(price)} · маржа {price ? r2(((price - cost) / price) * 100) : 0}%</p>
      </div>
      {canDo(u, 'saveBom', firm.id)
        ? <BomEditor key={p.id} product={opt} items={items} labor0={String(Number(bom?.labor ?? 0))} initial={(bom?.lines ?? []).map((l) => ({ itemId: l.itemId, qty: String(l.qty) }))} />
        : null}
      <div className="card">
        <h2>Маржа на артиклите на залиха</h2>
        <div className="tw"><table>
          <thead><tr><th>Артикл</th><th className="n">Просечна цена на чинење</th><th className="n">Продажна цена</th><th className="n">Маржа</th></tr></thead>
          <tbody>
            {trackedItems(L.ctx).map((i) => {
              const c = unitCost(L.ctx, i);
              const pr = Number(i.price) || 0;
              const mg = pr ? r2(((pr - c) / pr) * 100) : 0;
              return <tr key={i.id}><td>{i.name}</td><td className="n">{fmt(c)}</td><td className="n">{fmt(pr)}</td><td className="n">{c ? <span className={`pill ${mg < 10 ? 'bad' : mg < 20 ? 'warn' : 'good'}`}>{mg}%</span> : '—'}</td></tr>;
            })}
          </tbody>
        </table></div>
      </div>
    </>
  );
}
