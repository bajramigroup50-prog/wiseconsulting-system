/**
 * Фискална каса — legacy `VIEWS.kasa` 5680 + loyalty box 9937, `posSell` 5838 + wrapper 9940, `posFile` 7229:
 * location („Продавница / каса“), the fiscal-device callout, „Нова сметка“ (barcode scan, item select, cart, loyalty
 * card / coupon / points, record the sale, fiscal printer file) and „Дневни извештаи (Z)“ of the location.
 * The sale accumulates into the day document of the location (POS day, `sales_daily`), posted like a cash sale with
 * card payments on the card account (POS partner); goods issued at average cost, products with a BOM issue the BOM.
 * `?ro=<bill>` opens a restaurant bill in the till (legacy `roPay`); the bill is closed together with the sale.
 */
import Link from 'next/link';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { retailPrice, stock } from '@wise/core';
import { zBaseVat } from '@wise/core/retail';
import { coupons, itemBarcodes, listDocs, loyaltyCards, loyaltyRulesOf, salesDaily, type RestaurantOrder } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dateInYear, locOptions, pickLoc, stockPage, todayIso } from '@/lib/stock';
import { dmy, fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { PdfButton } from '@/components/pdf-button';
import { DownloadCsv } from '@/components/download-csv';
import { LocSelect } from '@/components/loc-select';
import { deleteSalesDayAction } from '../_stock/actions';
import { PosTill, type TillItem } from './pos-till';

type SP = { d?: string; wh?: string; ro?: string };

export default async function KasaPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year, L } = await stockPage('kasa');
  if (!firm || !L) return <NoFirm t="Фискална каса" />;
  const write = canDo(u, 'posSell', firm.id);
  const locs = locOptions(L);
  const wh = pickLoc(L, sp.wh) || L.settings.fiskOpt.wh || locs.find((l) => l.kind === 'store')?.id || 'main';
  const date = sp.d ? dateInYear(sp.d, year) : todayIso();
  const [days, bcs, C, P, ro] = await Promise.all([
    db().select().from(salesDaily)
      .where(and(eq(salesDaily.firmId, firm.id), gte(salesDaily.date, `${year}-01-01`), lte(salesDaily.date, `${year}-12-31`)))
      .orderBy(desc(salesDaily.date)),
    db().select({ itemId: itemBarcodes.itemId, barcode: itemBarcodes.barcode }).from(itemBarcodes).where(eq(itemBarcodes.firmId, firm.id)),
    write ? db().select().from(loyaltyCards).where(eq(loyaltyCards.firmId, firm.id)) : Promise.resolve([]),
    write ? db().select().from(coupons).where(eq(coupons.firmId, firm.id)) : Promise.resolve([]),
    sp.ro && /^[0-9a-f-]{36}$/i.test(sp.ro) ? listDocs<RestaurantOrder>(db(), firm.id, 'rord', 'open').then((O) => O.find((o) => o.id === sp.ro) ?? null) : Promise.resolve(null),
  ]);
  const bcOf = new Map<string, string[]>();
  for (const b of bcs) bcOf.set(b.itemId, [...(bcOf.get(b.itemId) ?? []), b.barcode]);
  const items: TillItem[] = (L.ctx.items ?? []).map((it) => ({
    id: it.id, code: it.code ?? '', name: it.name ?? '', type: String(it.type ?? ''), rate: L.settings.vatRegistered ? Number(it.rate ?? 18) : 0,
    price: retailPrice(it, wh), have: it.type && it.type !== 'service' ? stock(L.ctx, it.id, wh).qty : 0, barcodes: bcOf.get(it.id) ?? [],
  })).sort((a, b) => a.name.localeCompare(b.name, 'mk'));
  const list = days.filter((s) => (s.locationId ?? 'main') === wh);
  const rows = list.map((s) => ({ s, ...zBaseVat(s.groups) }));
  const T = rows.reduce((a, r) => ({ n: a.n + r.s.count, b: a.b + r.base, v: a.v + r.vat, t: a.t + Number(r.s.total) }), { n: 0, b: 0, v: 0, t: 0 });
  const initial = ro ? ro.data.lines.map((l) => ({ itemId: l.itemId, name: l.name, qty: Number(l.qty), price: Number(l.price), rate: Number(l.rate) })) : undefined;
  return (
    <>
      <Hd t="Фискална каса" sub={'малопродажба · ' + L.locName(wh === 'main' ? null : wh)}>
        <Link className="btn" href="/lojalnost">💳 Лојалност</Link>
      </Hd>
      <div className="card"><div className="row"><LocSelect label="Продавница / каса" param="wh" value={wh} options={locs.map((l) => ({ value: l.id, label: l.name }))} /></div></div>
      <div className="callout warn">Фискалниот апарат (Accent, David, Expert, Synergy…) се поврзува со компјутерот преку драјверот на производителот; од прелистувачот не може директно да му се испрати. Тука се евидентира продажбата, се раздолжува залихата и се презема датотека за фискалната сметка за програмата на апаратот.</div>
      {ro && <div className="callout">🍽 Сметка од маса во касата – додадете картичка/купон ако има и „Евидентирај продажба“. Масата се затвора со продажбата.</div>}
      <div className="cols">
        {write ? (
          <PosTill key={`${wh}:${ro?.id ?? ''}`} items={items} date={date} wh={wh} order={ro?.id ?? null} initial={initial}
            cards={C.map((c) => ({ id: c.id, no: c.number, name: c.name, phone: c.phone, disc: Number(c.discount), points: Number(c.points) }))}
            coupons={P.map((c) => ({ id: c.id, code: c.code, kind: c.kind, val: Number(c.value), from: c.validFrom, to: c.validTo, max: c.maxUses, used: c.used, minTotal: Number(c.minTotal) }))}
            rules={loyaltyRulesOf((firm.settings ?? {}) as Record<string, unknown>)} />
        ) : <div className="card"><div className="callout">Немате дозвола за продажба.</div></div>}
        <div className="card">
          <div className="hd"><h2>Дневни извештаи (Z) · {L.locName(wh === 'main' ? null : wh)}</h2>
            {rows.length > 0 && <div className="row noprint" style={{ gap: 6 }}>
              <PdfButton selector="#kasaZ" title={`Дневни извештаи ${year}`} className="btn sm" />
              <DownloadCsv name={`Kasa_Z_${year}.csv`} label="Excel (CSV)" rows={[['Датум', 'Сметки', 'Основица', 'ДДВ', 'Вкупно', 'Картичка'], ...rows.map((r) => [dmy(r.s.date), r.s.count, r.base, r.vat, Number(r.s.total), Number(r.s.card)])]} />
            </div>}
          </div>
          {rows.length ? (
            <div className="tw" id="kasaZ"><table>
              <thead><tr><th>Датум</th><th className="n">Сметки</th><th className="n">Основица</th><th className="n">ДДВ</th><th className="n">Вкупно</th><th className="noprint" /></tr></thead>
              <tbody>{rows.map(({ s, base, vat }) => (
                <tr key={s.id}><td>{dmy(s.date)}{s.kind === 'fisk' ? <span className="mini"> · фиск. изв.</span> : ''}</td><td className="n">{s.count}</td><td className="n">{fmt(base)}</td><td className="n">{fmt(vat)}</td><td className="n">{fmt(s.total)}</td>
                  <td className="noprint">{write && s.kind === 'pos' && <RowAction action={deleteSalesDayAction.bind(null, s.id)} label="🗑" title="Избриши" confirm={`Да се избрише дневниот промет ${dmy(s.date)}? Залихата и налозите се враќаат.`} />}</td></tr>
              ))}</tbody>
              <tfoot><tr><td>Вкупно</td><td className="n">{T.n}</td><td className="n">{fmt(T.b)}</td><td className="n">{fmt(T.v)}</td><td className="n">{fmt(T.t)}</td><td className="noprint" /></tr></tfoot>
            </table></div>
          ) : <div className="empty">Сè уште нема малопродажба.</div>}
        </div>
      </div>
    </>
  );
}
