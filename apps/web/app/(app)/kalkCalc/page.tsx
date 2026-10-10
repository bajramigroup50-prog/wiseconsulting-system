/**
 * Калкулатор на цена — legacy `VIEWS.kalkCalc` 5611: quick retail-price calculation and the margin of every stocked
 * item (unit cost from `@wise/core` `unitCost`, BOM-aware, vs the net selling price).
 */
import Link from 'next/link';
import { Retail, unitCost } from '@wise/core';
import { stockPage } from '@/lib/stock';
import { fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { PriceCalc } from './calc';

export default async function KalkCalcPage() {
  const { firm, L } = await stockPage('kalkCalc');
  if (!firm || !L) return <NoFirm t="Калкулатор на продажна цена" />;
  const rows = (L.ctx.items ?? []).filter((i) => i.type && i.type !== 'service').map((i) => {
    const c = unitCost(L.ctx, i);
    return { i, c, mg: Retail.marginPct(i.price, c) };
  });
  return (
    <>
      <Hd t="Калкулатор на продажна цена" sub="брза пресметка"><Link className="btn" href="/kalkM">← Влезни калкулации</Link></Hd>
      <PriceCalc />
      <div className="card"><h2>Маржа на артиклите на залиха</h2>
        <div className="tw"><table>
          <thead><tr><th>Артикл</th><th className="n">Просечна цена на чинење</th><th className="n">Продажна цена</th><th className="n">Маржа</th></tr></thead>
          <tbody>{rows.map(({ i, c, mg }) => (
            <tr key={i.id}><td>{i.name}</td><td className="n">{fmt(c)}</td><td className="n">{fmt(i.price)}</td>
              <td className="n">{c ? <span className={'pill ' + Retail.marginTone(mg)}>{mg}%</span> : '—'}</td></tr>
          ))}</tbody>
        </table></div>
      </div>
    </>
  );
}
