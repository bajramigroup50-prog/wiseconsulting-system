/**
 * Каса — legacy `VIEWS.kasa` 5680 → 9937, `posSell` 5838 → 9940: cart, cash / card, the day document `z-{wh-}date`
 * accumulates the sales of the day; posted like a cash sale with card payments on the card account (POS partner),
 * goods issued at average cost. Discounts / loyalty / coupons (9940) and BOM explosion are not ported (Phase 10).
 */
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { salesDaily } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dateInYear, itemOptions, locOptions, pickLoc, stockPage } from '@/lib/stock';
import { dmy, fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { deleteSalesDayAction } from '../_stock/actions';
import { PosCart } from '../_stock/editors';

type SP = { d?: string; wh?: string; ok?: string };

export default async function KasaPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year, L } = await stockPage('kasa');
  if (!firm || !L) return <NoFirm t="Каса" />;
  const write = canDo(u, 'posSell', firm.id);
  const locs = locOptions(L);
  const wh = pickLoc(L, sp.wh) || L.settings.fiskOpt.wh || locs.find((l) => l.kind === 'store')?.id || 'main';
  const date = dateInYear(sp.d, year);
  const days = await db().select().from(salesDaily)
    .where(and(eq(salesDaily.firmId, firm.id), eq(salesDaily.kind, 'pos'), gte(salesDaily.date, `${year}-01-01`), lte(salesDaily.date, `${year}-12-31`)))
    .orderBy(desc(salesDaily.date));
  const items = itemOptions(L, { services: true });
  const names = new Map(items.map((i) => [i.id, (i.code ? i.code + ' · ' : '') + i.name]));
  const today = days.find((d) => d.date === date && (d.locationId ?? 'main') === wh);
  return (
    <>
      <Hd t="Каса" sub="малопродажба · дневен промет" />
      {sp.ok && <div className="callout good">Продажбата е прокнижена во дневниот промет.</div>}
      {write ? <PosCart items={items} locs={locs} date={date} wh={wh} /> : <div className="callout">Немате дозвола за продажба.</div>}
      {today && (
        <div className="card">
          <h2>Дневен промет {dmy(today.date)} · {L.locName(today.locationId)}</h2>
          <div className="tw"><table>
            <thead><tr><th>Артикл</th><th className="n">Количина</th><th className="n">Цена</th><th className="n">Износ</th></tr></thead>
            <tbody>{today.lines.map((l, i) => <tr key={i}><td>{names.get(l.itemId)}</td><td className="n">{l.qty}</td><td className="n">{fmt(l.price)}</td><td className="n">{fmt(l.qty * l.price)}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={3}>Вкупно (картичка {fmt(today.card)})</td><td className="n">{fmt(today.total)}</td></tr></tfoot>
          </table></div>
        </div>
      )}
      {days.length ? (
        <div className="tw"><table>
          <thead><tr><th>Датум</th><th>Објект</th><th className="n">Сметки</th><th className="n">Вкупно</th><th className="n">Картичка</th><th>ДДВ групи</th><th /></tr></thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.id}>
                <td>{dmy(d.date)}</td><td>{L.locName(d.locationId)}</td><td className="n">{d.count}</td><td className="n">{fmt(d.total)}</td><td className="n">{fmt(d.card)}</td>
                <td className="mini">{d.groups.map((g) => `${g.rate}%: ${fmt(g.base + g.vat)}`).join(' · ')}</td>
                <td>{write && <RowAction action={deleteSalesDayAction.bind(null, d.id)} label="🗑" title="Избриши" confirm={`Да се избрише дневниот промет ${dmy(d.date)}? Залихата и налозите се враќаат.`} />}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : <div className="card empty">Нема продажби од каса во {year}.</div>}
    </>
  );
}
