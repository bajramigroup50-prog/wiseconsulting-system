/** Legacy `cenPdf` 7371 — ЦЕНОВНИК: every item with price, discount of the chosen price list, VAT and price with VAT. */
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { priceListRows } from '@wise/core/codebooks';
import { codes, items } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { todayIso } from '@/lib/stock';
import { FirmHead, Sig } from '../firm-head';
import { printGuard } from '../guard';

export default async function PrintCenovnik({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const { firm } = await printGuard('sifrarnik');
  const [c] = id && /^[0-9a-f-]{36}$/i.test(id)
    ? await db().select().from(codes).where(and(eq(codes.id, id), eq(codes.firmId, firm.id), eq(codes.cb, 'cenovnik'))).limit(1)
    : [];
  if (id && !c) notFound();
  const data = (c?.data ?? {}) as { rabat?: number; date?: string };
  const rb = Number(data.rabat ?? 0) || 0;
  const I = await db().select().from(items).where(eq(items.firmId, firm.id));
  const R = priceListRows(I.map((i) => ({ code: i.code, name: i.name, unit: i.unit, price: Number(i.price ?? 0), rate: i.vatRate })), rb);
  const sub = (data.date ? `Важи од ${dmy(data.date)}` : `На ден ${dmy(todayIso())}`) + (rb ? ` · рабат ${rb}%` : '');
  return (
    <div className="pdfdoc printarea">
      <FirmHead firm={firm} title={`ЦЕНОВНИК${c ? ` – ${c.name}` : ''}`} sub={sub} />
      <table>
        <thead><tr><th>Шифра</th><th>Назив</th><th>Ед.</th><th className="n">Цена без ДДВ</th>{rb ? <><th className="n">Рабат</th><th className="n">Цена по рабат</th></> : null}<th className="n">ДДВ %</th><th className="n">Цена со ДДВ</th></tr></thead>
        <tbody>{R.map((r, i) => (
          <tr key={i}><td>{r.code ?? ''}</td><td>{r.name}</td><td>{r.unit ?? ''}</td><td className="n">{fmt(r.price)}</td>
            {rb ? <><td className="n">{rb}%</td><td className="n">{fmt(r.net)}</td></> : null}
            <td className="n">{r.rate}%</td><td className="n">{fmt(r.gross)}</td></tr>
        ))}</tbody>
      </table>
      <Sig who={['Изготвил', 'Одобрил']} />
    </div>
  );
}
