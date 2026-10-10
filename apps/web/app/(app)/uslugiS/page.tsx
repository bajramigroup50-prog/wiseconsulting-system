/**
 * Услуги — legacy `VIEWS.uslugiS` 6974 (`simpleList('items', …, i => i.type === 'service')`, Шифрарник hub 6984).
 * The services of the item master; adding and editing uses the shared item form of Производи и артикли.
 */
import Link from 'next/link';
import { and, asc, eq } from 'drizzle-orm';
import { items } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';

export default async function UslugiSPage() {
  const { u, firm } = await booksPage('uslugiS');
  if (!firm) return <NoFirm t="Услуги" />;
  const write = canDo(u, 'write', firm.id);
  const rows = await db().select().from(items).where(and(eq(items.firmId, firm.id), eq(items.type, 'service'))).orderBy(asc(items.name));
  return (
    <>
      <Hd t="Услуги" sub={`${rows.length}`}>{write && <Link className="btn pri" href="/artikli?nov">+ Додај</Link>}</Hd>
      {rows.length ? (
        <div className="tw"><table>
          <thead><tr><th>Шифра</th><th>Назив</th><th>Ед. мерка</th><th className="n">Цена без ДДВ</th><th>ДДВ %</th><th>Конто за приход</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} style={r.active ? undefined : { opacity: 0.55 }}>
              <td>{r.code}</td><td>{r.name}</td><td>{r.unit}</td><td className="n">{r.price ? fmt(r.price) : ''}</td><td>{r.vatRate}</td><td>{r.revenueAccount}</td>
              <td>{write && <Link className="btn sm" href={`/artikli?edit=${r.id}`}>Измени</Link>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <div className="card empty">Нема услуги. Додајте артикл со вид „Услуга“.</div>}
    </>
  );
}
