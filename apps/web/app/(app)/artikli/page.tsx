/** Legacy `VIEWS.artikli` 6820 → `artikli0` 6821 (`simpleList`), Шифрарник › Производи и артикли. */
import Link from 'next/link';
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { effectiveChart, itemBarcodes, items, itemSupplierCodes, partners } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { deleteItem } from './actions';
import { ItemForm } from './item-form';

const TYPES: Record<string, string> = { service: 'Услуга', goods: 'Стока (трговија)', material: 'Суровина / материјал', product: 'Готов производ' };
const LIMIT = 500;

export default async function ArtikliPage({ searchParams }: { searchParams: Promise<{ q?: string; edit?: string; nov?: string }> }) {
  const sp = await searchParams;
  const { u, firm } = await booksPage('artikli');
  if (!firm) return <NoFirm t="Артикли и услуги" />;
  const q = (sp.q ?? '').trim();
  const bcMatch = q ? db().select({ id: itemBarcodes.itemId }).from(itemBarcodes).where(and(eq(itemBarcodes.firmId, firm.id), eq(itemBarcodes.barcode, q))) : undefined;
  const where = and(eq(items.firmId, firm.id), q ? or(ilike(items.name, `%${q}%`), ilike(items.code, `%${q}%`), inArray(items.id, bcMatch!)) : undefined);
  const [rows, [total]] = await Promise.all([
    db().select().from(items).where(where).orderBy(asc(items.name)).limit(LIMIT),
    db().select({ n: sql<number>`count(*)::int` }).from(items).where(where),
  ]);
  const ids = rows.map((r) => r.id);
  const bcs = ids.length ? await db().select().from(itemBarcodes).where(inArray(itemBarcodes.itemId, ids)) : [];
  const bcOf = (id: string) => bcs.filter((b) => b.itemId === id).sort((a, b) => Number(b.primary) - Number(a.primary)).map((b) => b.barcode);
  const write = canDo(u, 'write', firm.id), del = canDo(u, 'del', firm.id);

  const edit = sp.edit ? (await db().select().from(items).where(and(eq(items.id, sp.edit), eq(items.firmId, firm.id))).limit(1))[0] : undefined;
  const showForm = write && (sp.nov !== undefined || !!edit);
  let form = null;
  if (showForm) {
    const [chart, editBc, sup] = await Promise.all([
      effectiveChart(db(), firm.id),
      edit ? db().select({ b: itemBarcodes.barcode, p: itemBarcodes.primary }).from(itemBarcodes).where(eq(itemBarcodes.itemId, edit.id)) : [],
      edit ? db().select({ code: itemSupplierCodes.code, partner: partners.name }).from(itemSupplierCodes)
        .leftJoin(partners, eq(partners.id, itemSupplierCodes.partnerId)).where(eq(itemSupplierCodes.itemId, edit.id)) : [],
    ]);
    form = (
      <ItemForm it={edit ?? null} barcodes={editBc.sort((a, b) => Number(b.p) - Number(a.p)).map((x) => x.b)} supplierCodes={sup}
        revAccounts={chart.filter((a) => a.code.startsWith('7') && !a.code.startsWith('70')).map((a) => [a.code, a.name])} />
    );
  }

  return (
    <>
      <Hd t="Артикли и услуги" sub={`${total?.n ?? 0} артикли`}>
        {write && <Link className="btn pri" href="/artikli?nov">+ Додај</Link>}
      </Hd>
      {form}
      <form className="row" style={{ gap: 8, marginBottom: 10 }}>
        <input name="q" defaultValue={q} placeholder="🔍 Барај по назив, шифра или баркод…" style={{ flex: 1, minWidth: 220 }} />
        <button className="btn">Барај</button>
      </form>
      {rows.length ? (
        <div className="tw"><table>
          <thead><tr><th>Шифра</th><th>Баркод</th><th>Назив</th><th>Вид</th><th>Ед. мерка</th><th className="n">Продажна цена без ДДВ</th><th>ДДВ %</th><th>Конто за приход</th><th className="n">Минимална залиха</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={r.active ? undefined : { opacity: 0.55 }}>
                <td>{r.code}</td><td>{bcOf(r.id).join(', ')}</td><td>{r.name}{r.madeInMk && <> <span className="pill">МК</span></>}</td>
                <td><span className="pill">{TYPES[r.type]}</span></td><td>{r.unit}</td>
                <td className="n"><span className="num">{r.price ? fmt(r.price) : ''}</span></td><td>{r.vatRate}</td><td>{r.revenueAccount}</td>
                <td className="n"><span className="num">{r.minStock ? fmt(r.minStock) : ''}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {write && <Link className="btn sm" href={`/artikli?edit=${r.id}${q ? '&q=' + encodeURIComponent(q) : ''}`}>Измени</Link>}{' '}
                  {del && <RowAction action={deleteItem.bind(null, r.id)} label="Избриши" confirm={`Да се избрише „${r.name}“?`} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : <div className="card empty">{q ? `Нема артикл што одговара на „${q}“.` : 'Листата е празна.'}</div>}
      {(total?.n ?? 0) > LIMIT && <p className="note">Прикажани се првите {LIMIT}. Користете пребарување.</p>}
    </>
  );
}
