import Link from 'next/link';
import { asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { can } from '@wise/core';
import { firms, userFirms } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { Hd, dmy } from '@/components/hd';
import { FirmForm } from './firm-form';
import { PickButton } from './pick-button';

const PAGE = 100;

export default async function FirmiPage({ searchParams }: { searchParams: Promise<{ q?: string; edit?: string; nova?: string; p?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const cur = await currentFirm(u);
  const q = (sp.q ?? '').trim();
  const page = Math.max(0, Number(sp.p) || 0);

  const scoped = u.principal.firms.includes('*')
    ? undefined
    : or(inArray(firms.id, db().select({ id: userFirms.firmId }).from(userFirms).where(eq(userFirms.userId, u.id))), eq(firms.ownerId, u.id));
  const search = q ? or(ilike(firms.name, `%${q}%`), ilike(firms.edb, `%${q}%`), ilike(firms.embs, `%${q}%`), ilike(firms.city, `%${q}%`)) : undefined;
  const where = scoped && search ? sql`${scoped} and ${search}` : scoped ?? search;

  const [rows, [total]] = await Promise.all([
    db().select().from(firms).where(where).orderBy(asc(firms.name)).limit(PAGE).offset(page * PAGE),
    db().select({ n: sql<number>`count(*)::int` }).from(firms).where(where),
  ]);

  const editId = sp.edit;
  const draft = editId ? (await db().select().from(firms).where(eq(firms.id, editId)).limit(1))[0] : undefined;
  const showForm = (sp.nova !== undefined && can(u.principal, 'newFirm')) || (draft && can(u.principal, 'saveFirm', draft.id));

  return (
    <>
      <Hd t="Фирми" sub={`${total?.n ?? 0} фирми`}>
        {can(u.principal, 'firms') && <>
          <a className="btn" href="/firmi/izvoz">⬇ Извоз</a>
          <a className="btn" href="/firmiImp/obrazec">⬇ Excel образец</a>
          <Link className="btn" href="/firmiImp">📥 Увоз од Excel</Link>
          <Link className="btn pri" href="/firmiResh">📷 Нова фирма од решение</Link>
          <Link className="btn" href="/firmi/kirilica">🔧 Поправка на увезени фирми</Link>
        </>}
        {can(u.principal, 'newFirm') && <Link className="btn pri" href="/firmi?nova">+ Нова фирма</Link>}
      </Hd>
      {showForm && <FirmForm firm={draft ?? null} />}
      <form className="row" style={{ gap: 8, marginBottom: 10 }}>
        <input name="q" defaultValue={q} placeholder="🔍 Барај по назив, ЕДБ, ЕМБС или град…" style={{ flex: 1, minWidth: 220 }} />
        <button className="btn">Барај</button>
      </form>
      <div className="card">
        <div className="tw">
          <table>
            <thead><tr><th>Шифра</th><th>Назив</th><th>ЕДБ</th><th>ЕМБС</th><th>Град</th><th>ДДВ</th><th>Заклучено до</th><th></th></tr></thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id}>
                  <td>{f.code}</td>
                  <td><b>{f.name}</b>{f.id === cur?.id && <> <span className="pill good">тековна</span></>}</td>
                  <td className="num">{f.edb}</td>
                  <td className="num">{f.embs}</td>
                  <td>{f.city}</td>
                  <td>{f.vatRegistered ? (f.vatPeriod === 'month' ? 'месечно' : 'тромесечно') : '—'}</td>
                  <td>{f.lockDate ? dmy(f.lockDate) : '—'}</td>
                  <td className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                    {f.id !== cur?.id && <PickButton id={f.id} />}
                    {can(u.principal, 'saveFirm', f.id) && <Link className="btn sm" href={`/firmi?edit=${f.id}`}>Измени</Link>}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="mut">{q ? `Нема фирма што одговара на „${q}“.` : 'Нема фирми.'}</td></tr>}
            </tbody>
          </table>
        </div>
        {(total?.n ?? 0) > PAGE && (
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            {page > 0 && <Link className="btn sm" href={`/firmi?q=${encodeURIComponent(q)}&p=${page - 1}`}>← Претходни</Link>}
            {(page + 1) * PAGE < (total?.n ?? 0) && <Link className="btn sm" href={`/firmi?q=${encodeURIComponent(q)}&p=${page + 1}`}>Следни →</Link>}
          </div>
        )}
      </div>
    </>
  );
}
