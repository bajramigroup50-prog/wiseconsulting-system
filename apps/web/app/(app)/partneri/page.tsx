/** Legacy `VIEWS.partneri` 6818 → `partneri0` 6819 (`simpleList`), Шифрарник › Комитенти. */
import Link from 'next/link';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { partners } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { nextCode } from '@/lib/codes';
import { db } from '@/lib/db';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { autoCodesAction, deletePartner, deletePartnersAction, setPartnerActive } from './actions';
import { partnerUsage, usedList } from '@/lib/sales-parity';
import { BulkBar, SelAll, SelBox } from '@/components/sales/bulk-select';
import { PartnerForm } from './partner-form';

const LIMIT = 500;

export default async function PartneriPage({ searchParams }: { searchParams: Promise<{ q?: string; edit?: string; nov?: string; use?: string }> }) {
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
    partnerUsage(firm.id),
    db().select({ code: partners.code }).from(partners).where(eq(partners.firmId, firm.id)),
  ]);
  const used = usage;
  const admin = u.role === 'admin' && canDo(u, 'del', firm.id);
  const useP = sp.use ? rows.find((r) => r.id === sp.use) : undefined;
  const useL = useP ? await usedList(firm.id, 'partner', useP.id) : [];
  const noCode = allCodes.some((c) => !String(c.code ?? '').trim());
  const write = canDo(u, 'write', firm.id), del = canDo(u, 'del', firm.id);
  const edit = sp.edit ? (await db().select().from(partners).where(and(eq(partners.id, sp.edit), eq(partners.firmId, firm.id))).limit(1))[0] : undefined;
  const showForm = write && (sp.nov !== undefined || !!edit);

  return (
    <>
      <Hd t="Партнери" sub={`${total?.n ?? 0} комитенти`}>
        {write && !showForm && <Link className="btn" href="/uvoz?t=partners&back=partneri">Увоз од Excel</Link>}
        {write && noCode && <RowAction className="btn" action={autoCodesAction} label="Додели шифри" title="Автоматски шифри за сите без шифра" />}
        {write && <Link className="btn pri" href="/partneri?nov">+ Додај</Link>}
      </Hd>
      {showForm && <PartnerForm p={edit ?? null} nextCode={nextCode(allCodes.map((c) => c.code))} used={edit ? used.get(edit.id) ?? 0 : 0} />}
      {showForm && edit && !(used.get(edit.id) ?? 0) && canDo(u, 'del', firm.id) && <div className="row" style={{ marginTop: -6, marginBottom: 10 }}><RowAction className="btn danger" action={deletePartner.bind(null, edit.id)} label="Избриши" confirm={`Да се избрише „${edit.name}“?`} /></div>}
      {useP && <div className="card"><div className="hd"><h2>🔒 {useP.name} – се користи во {used.get(useP.id) ?? 0} документи</h2><Link className="btn sm" href="/partneri">✕</Link></div>
        <p className="note">Партнер/артикл што е користен не може да се избрише, за да не се расипат книжењата. Ако документите се погрешни, прво избришете ги нив (во нивната листа) – потоа ќе може да се избрише и овој. Инаку означете го како неактивен.</p>
        <div className="tw"><table className="dense"><thead><tr><th>Вид</th><th>Број</th><th>Датум</th><th className="n">Износ</th></tr></thead><tbody>{useL.map((x, k) => <tr key={k}><td>{x.kind}</td><td>{x.number}</td><td>{x.date.split('-').reverse().join('.')}</td><td className="n">{x.total == null ? '' : x.total.toLocaleString('mk-MK', { minimumFractionDigits: 2 })}</td></tr>)}</tbody></table></div></div>}
      <form className="row" style={{ gap: 8, marginBottom: 10 }}>
        <input name="q" defaultValue={q} placeholder="🔍 Барај по назив, ЕДБ, шифра или град…" style={{ flex: 1, minWidth: 220 }} />
        <button className="btn">Барај</button>
      </form>
      {rows.length ? (<>
        {admin && <BulkBar label={(k) => `🗑 Избриши ги избраните (${k})`} confirm={(k) => `Да се избришат ${k} избрани?\nТие што се користат во фактури, каса, налози или плати НЕ се бришат (може „Неактивен“).\n\nОва не може да се врати.`} action={deletePartnersAction} />}
        <div className="tw"><table>
          <thead><tr>{admin && <th style={{ width: 30 }}><SelAll /></th>}<th>Шифра</th><th>Назив</th><th>ЕДБ</th><th>Адреса</th><th>Град</th><th>Е-пошта</th><th>Телефон (WhatsApp/Viber)</th><th>Жиро сметка</th><th>ДДВ обврзник</th><th>Активен</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const n = used.get(r.id) ?? 0;
              return (
                <tr key={r.id} style={r.active ? undefined : { opacity: 0.55 }}>
                  {admin && <td><SelBox id={r.id} /></td>}
                  <td>{r.code}</td><td>{r.name}</td><td>{r.edb}</td><td>{r.address}</td><td>{r.city}</td><td>{r.email}</td><td>{r.phone}</td>
                  <td>{r.bankAccount}</td><td>{r.vatRegistered ? 'Да' : 'Не'}</td><td>{r.active ? 'Да' : 'Не'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {write && <Link className="btn sm" href={`/partneri?edit=${r.id}${q ? '&q=' + encodeURIComponent(q) : ''}`}>Измени</Link>}{' '}
                    {n > 0 ? (
                      <>
                        <Link className="btn sm ghost" href={`/partneri?use=${r.id}${q ? '&q=' + encodeURIComponent(q) : ''}`} title={`Користен во ${n} документи – не може да се избрише. Кликнете за да видите каде.`}>🔒 {n}</Link>{' '}
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
        </table></div></>
      ) : <div className="card empty">{q ? `Нема комитент што одговара на „${q}“.` : 'Листата е празна.'}</div>}
      {(total?.n ?? 0) > LIMIT && <p className="note">Прикажани се првите {LIMIT}. Користете пребарување.</p>}
    </>
  );
}
