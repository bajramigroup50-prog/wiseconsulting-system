/** Legacy `VIEWS.partneri` 6818 → `partneri0` 6819 (`simpleList`), Шифрарник › Комитенти. */
import Link from 'next/link';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { journalLines, partners } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { nextCode } from '@/lib/codes';
import { db } from '@/lib/db';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { deletePartner, setPartnerActive } from './actions';
import { PartnerForm } from './partner-form';

const LIMIT = 500;

export default async function PartneriPage({ searchParams }: { searchParams: Promise<{ q?: string; edit?: string; nov?: string }> }) {
  const sp = await searchParams;
  const { u, firm } = await booksPage('partneri');
  if (!firm) return <NoFirm t="Партнери" />;
  const q = (sp.q ?? '').trim();
  const where = and(eq(partners.firmId, firm.id), q
    ? or(ilike(partners.name, `%${q}%`), ilike(partners.edb, `%${q}%`), ilike(partners.code, `%${q}%`), ilike(partners.city, `%${q}%`))
    : undefined);
  const [rows, [total], usage, allCodes] = await Promise.all([
    db().select().from(partners).where(where).orderBy(asc(partners.name)).limit(LIMIT),
    db().select({ n: sql<number>`count(*)::int` }).from(partners).where(where),
    db().select({ id: journalLines.partnerId, n: sql<number>`count(*)::int` }).from(journalLines)
      .where(and(eq(journalLines.firmId, firm.id), sql`${journalLines.partnerId} is not null`)).groupBy(journalLines.partnerId),
    db().select({ code: partners.code }).from(partners).where(eq(partners.firmId, firm.id)),
  ]);
  const used = new Map(usage.map((x) => [x.id!, x.n]));
  const write = canDo(u, 'write', firm.id), del = canDo(u, 'del', firm.id);
  const edit = sp.edit ? (await db().select().from(partners).where(and(eq(partners.id, sp.edit), eq(partners.firmId, firm.id))).limit(1))[0] : undefined;
  const showForm = write && (sp.nov !== undefined || !!edit);

  return (
    <>
      <Hd t="Партнери" sub={`${total?.n ?? 0} комитенти`}>
        {write && <Link className="btn pri" href="/partneri?nov">+ Додај</Link>}
      </Hd>
      {showForm && <PartnerForm p={edit ?? null} nextCode={nextCode(allCodes.map((c) => c.code))} used={edit ? used.get(edit.id) ?? 0 : 0} />}
      <form className="row" style={{ gap: 8, marginBottom: 10 }}>
        <input name="q" defaultValue={q} placeholder="🔍 Барај по назив, ЕДБ, шифра или град…" style={{ flex: 1, minWidth: 220 }} />
        <button className="btn">Барај</button>
      </form>
      {rows.length ? (
        <div className="tw"><table>
          <thead><tr><th>Шифра</th><th>Назив</th><th>ЕДБ</th><th>Адреса</th><th>Град</th><th>Е-пошта</th><th>Телефон (WhatsApp/Viber)</th><th>Жиро сметка</th><th>ДДВ обврзник</th><th>Активен</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const n = used.get(r.id) ?? 0;
              return (
                <tr key={r.id} style={r.active ? undefined : { opacity: 0.55 }}>
                  <td>{r.code}</td><td>{r.name}</td><td>{r.edb}</td><td>{r.address}</td><td>{r.city}</td><td>{r.email}</td><td>{r.phone}</td>
                  <td>{r.bankAccount}</td><td>{r.vatRegistered ? 'Да' : 'Не'}</td><td>{r.active ? 'Да' : 'Не'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {write && <Link className="btn sm" href={`/partneri?edit=${r.id}${q ? '&q=' + encodeURIComponent(q) : ''}`}>Измени</Link>}{' '}
                    {n > 0 ? (
                      <>
                        <span className="pill" title={`Користен во ${n} ставки – не може да се избрише.`}>🔒 {n}</span>{' '}
                        {write && <RowAction action={setPartnerActive.bind(null, r.id, !r.active)} label={r.active ? 'Неактивен' : 'Активирај'} />}
                      </>
                    ) : del && (
                      <RowAction action={deletePartner.bind(null, r.id)} label="Избриши" confirm={`Да се избрише „${r.name}“?`} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      ) : <div className="card empty">{q ? `Нема комитент што одговара на „${q}“.` : 'Листата е празна.'}</div>}
      {(total?.n ?? 0) > LIMIT && <p className="note">Прикажани се првите {LIMIT}. Користете пребарување.</p>}
    </>
  );
}
