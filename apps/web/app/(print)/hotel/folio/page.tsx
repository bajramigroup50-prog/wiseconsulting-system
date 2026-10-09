/** Legacy `htFolioHTML` (9569): сметка за престој (not a fiscal receipt). */
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { BOARD, htCalc } from '@wise/core/industry';
import { firmHotelConfig, hotelReservations, hotelRooms, partners } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { DocHead, Signs } from '@/components/industry-print';

export default async function Folio({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const g = await industryPage('hotel', 'Сметка за престој');
  if (g.blocked || !id) notFound();
  const [r] = await db().select().from(hotelReservations).where(and(eq(hotelReservations.id, id), eq(hotelReservations.firmId, g.firm.id))).limit(1);
  if (!r) notFound();
  const [rm] = await db().select().from(hotelRooms).where(eq(hotelRooms.id, r.roomId));
  const [p] = r.partnerId ? await db().select().from(partners).where(eq(partners.id, r.partnerId)) : [];
  const cfg = firmHotelConfig(g.firm);
  const k = htCalc({ ...r, price: Number(r.price), advance: Number(r.advance ?? 0) }, cfg);
  return (
    <>
      <DocHead firm={g.firm} title="СМЕТКА ЗА ПРЕСТОЈ" sub={`бр. ${r.number}`} />
      <table><tbody>
        <tr><td style={{ width: '30%' }}>Гостин</td><td><b>{r.guestName}</b>{p ? ` · ${p.name}` : ''}</td></tr>
        <tr><td>Соба</td><td>{rm?.no} {rm?.kind}</td></tr>
        <tr><td>Престој</td><td>{dmy(r.from)} – {dmy(r.to)} ({k.n} ноќи)</td></tr>
      </tbody></table>
      <table><thead><tr><th>Опис</th><th className="n">Кол.</th><th className="n">Цена</th><th className="n">ДДВ</th><th className="n">Износ</th></tr></thead>
        <tbody>
          <tr><td>Ноќевање ({(BOARD as Record<string, string>)[r.board]})</td><td className="n">{k.n}</td><td className="n">{fmt(Number(r.price))}</td><td className="n">{cfg.rate}%</td><td className="n">{fmt(k.acc)}</td></tr>
          {r.charges.map((x, i) => <tr key={i}><td>{dmy(x.date)} {x.name}</td><td className="n">{x.qty}</td><td className="n">{fmt(x.price)}</td><td className="n">{x.rate}%</td><td className="n">{fmt(x.qty * x.price)}</td></tr>)}
          {k.tax > 0 && <tr><td>Такса за привремен престој ({k.tu.units} лица × {k.n} ноќи)</td><td /><td className="n">{fmt(cfg.tax)}</td><td className="n">—</td><td className="n">{fmt(k.tax)}</td></tr>}
          <tr><td colSpan={4}><b>Вкупно</b></td><td className="n"><b>{fmt(k.tot)}</b></td></tr>
          {k.adv > 0 && <><tr><td colSpan={4}>Аванс</td><td className="n">−{fmt(k.adv)}</td></tr><tr><td colSpan={4}><b>За плаќање</b></td><td className="n"><b>{fmt(k.rest)}</b></td></tr></>}
        </tbody></table>
      <p style={{ fontSize: '9pt' }}>Цените се со вклучен ДДВ. Оваа сметка не е фискална сметка.</p>
      <Signs L={['Рецепција', 'Гостин']} />
    </>
  );
}
