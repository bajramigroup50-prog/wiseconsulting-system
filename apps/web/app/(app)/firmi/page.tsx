/**
 * Фирми — legacy `VIEWS.firmi` with its patches: list (Фирма · ЕДБ · ДДВ · Заклучено до + 🔓 Отклучи),
 * row actions Отвори / Измени / Избриши (6887), „📷 Нова фирма од решение“ (10614), the firm report card
 * „🖨 Извештај за фирмите“ with filter, examples, PDF and Excel (12074), Excel template / import (6887), the editor
 * with every tab (`firm-form.tsx`). Server additions: search, ⬇ Извоз (re-importable Excel), archived firms.
 */
import Link from 'next/link';
import { asc, eq, ilike, inArray, or, sql, and } from 'drizzle-orm';
import { can } from '@wise/core';
import { FR_F, frList, isFrFilter } from '@wise/core/firms/firmform';
import { firms, userFirms } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { Hd, dmy } from '@/components/hd';
import { FirmForm } from './firm-form';
import { openFirm, restoreFirm, unlockFirm } from './actions';
import { ConfirmButton } from './confirm-button';

type Sp = { q?: string; edit?: string; nova?: string; f?: string; ex?: string; arh?: string };

export default async function FirmiPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const cur = await currentFirm(u);
  const q = (sp.q ?? '').trim();
  const fk = isFrFilter(sp.f) ? sp.f : 'all';
  const withEx = sp.ex !== '0';
  const admin = u.role === 'admin';

  const scoped = u.principal.firms.includes('*')
    ? undefined
    : or(inArray(firms.id, db().select({ id: userFirms.firmId }).from(userFirms).where(eq(userFirms.userId, u.id))), eq(firms.ownerId, u.id));
  const search = q ? or(ilike(firms.name, `%${q}%`), ilike(firms.edb, `%${q}%`), ilike(firms.embs, `%${q}%`), ilike(firms.city, `%${q}%`), ilike(firms.code, `%${q}%`)) : undefined;

  const all = await db().select().from(firms).where(and(scoped, eq(firms.active, true))).orderBy(asc(firms.name));
  const archived = admin && sp.arh !== undefined ? await db().select().from(firms).where(eq(firms.active, false)).orderBy(asc(firms.name)) : [];
  const nArch = admin ? (await db().select({ n: sql<number>`count(*)::int` }).from(firms).where(eq(firms.active, false)))[0]?.n ?? 0 : 0;
  const ex = (f: typeof all[number]) => (f.settings as { example?: boolean }).example === true;
  const R = all.map((f) => ({ ...f, example: ex(f) }));
  const shown = new Set(frList(R, fk, withEx).map((f) => f.id));
  const matchQ = q ? new Set((await db().select({ id: firms.id }).from(firms).where(and(scoped, search))).map((r) => r.id)) : null;
  const rows = R.filter((f) => shown.has(f.id) && (!matchQ || matchQ.has(f.id)));

  const editId = sp.edit;
  const draft = editId ? (await db().select().from(firms).where(eq(firms.id, editId)).limit(1))[0] : undefined;
  const showForm = (sp.nova !== undefined && can(u.principal, 'newFirm')) || (draft && can(u.principal, 'saveFirm', draft.id));
  const office = all.find((f) => (f.settings as { officeFirm?: boolean }).officeFirm) ?? null;
  const ds = (draft?.settings ?? {}) as { officeFirm?: boolean; kdog?: { no?: string } };
  const withFee = !!showForm && u.role !== 'klient' && can(u.principal, 'office') && !ds.officeFirm && office?.id !== draft?.id;
  const feeNote = `Секој месец (последен работен ден) автоматски се издава фактура до оваа фирма${office ? ` од ${office.name}` : ''}.${ds.kdog?.no ? ` Договор ${ds.kdog.no}.` : ''}`;
  const n = (k: (typeof FR_F)[number][0]) => frList(R, k, withEx).length;
  const qs = (o: Partial<Sp>) => '?' + new URLSearchParams(Object.entries({ q, f: fk, ex: withEx ? '1' : '0', ...o }).filter(([, v]) => v !== undefined && v !== '') as [string, string][]).toString();

  return (
    <>
      <Hd t="Фирми" sub={`${all.length} фирми`}>
        {can(u.principal, 'firms') && <>
          <a className="btn" href="/firmi/izvoz" title="Сите фирми во Excel, во колоните што ги чита увозот">⬇ Извоз</a>
          <a className="btn" href="/firmiImp/obrazec" title="Празен Excel образец со сите колони за фирми">⬇ Excel образец</a>
          <Link className="btn" href="/firmiImp" title="Excel со листа на фирми (на пр. извоз од друга програма: Име на фирма, Жиро сметка, Матичен број, Даночен…)">📥 Увоз од Excel</Link>
          <Link className="btn pri" href="/firmiResh" title="Скенирајте решение од ЦРМ – фирмата се внесува сама">📷 Нова фирма од решение</Link>
          <Link className="btn" href="/firmi/kirilica">🔧 Поправка на увезени фирми</Link>
        </>}
        {can(u.principal, 'newFirm') && <Link className="btn pri" href="/firmi?nova">+ Нова фирма</Link>}
      </Hd>
      {showForm && <FirmForm key={draft?.id ?? 'new'} firm={draft ?? null} withFee={withFee} feeNote={feeNote} canDelete={admin} canResh={can(u.principal, 'firms')} />}
      {!showForm && <>
        {all.length > 0 && (
          <form className="card" style={{ padding: '10px 14px' }}>
            <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <b>🖨 Извештај за фирмите</b>
              <label className="mini">Прикажи <select name="f" defaultValue={fk} style={{ width: 'auto' }}>{FR_F.map(([k, t]) => <option key={k} value={k}>{t} ({n(k)})</option>)}</select></label>
              <input type="hidden" name="ex" value="0" />
              <label className="chk"><input type="checkbox" name="ex" value="1" defaultChecked={withEx} /> вклучи примери</label>
              <input name="q" defaultValue={q} placeholder="🔍 Назив, ЕДБ, ЕМБС, шифра или град…" style={{ flex: 1, minWidth: 200 }} />
              <button className="btn">Прикажи</button>
              <span style={{ flex: 1 }} />
              <a className="btn pri" style={{ fontWeight: 700 }} href={`/print/firmi${qs({})}`} target="_blank">🖨 PDF</a>
              <a className="btn" href={`/firmi/izvestaj${qs({})}`}>Excel</a>
            </div>
          </form>
        )}
        {all.length ? (
          <div className="tw">
            <table>
              <thead><tr><th>Фирма</th><th>ЕДБ</th><th>ДДВ</th><th>Заклучено до</th><th></th></tr></thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id}>
                    <td>{f.code && <span className="mut">{f.code} · </span>}{f.name}{f.example && <> <span className="pill warn">пример</span></>}{f.id === cur?.id && <> <span className="pill good">тековна</span></>}</td>
                    <td>{f.edb ?? ''}</td>
                    <td>{f.vatRegistered ? 'Да · ' + (f.vatPeriod === 'month' ? 'месечно' : 'тримесечно') : 'Не'}</td>
                    <td>{f.lockDate ? dmy(f.lockDate) : '—'}
                      {f.lockDate && admin && <form action={unlockFirm} style={{ display: 'inline' }}>
                        <input type="hidden" name="id" value={f.id} />{' '}
                        <ConfirmButton className="btn sm ghost" title="Отклучи (за корекција / бришење)"
                          msg={`Фирмата „${f.name}“ е заклучена до ${dmy(f.lockDate)}.\n\nДа се отклучи ${f.lockDate.slice(0, 4)}? Заклучувањето се враќа до 31.12.${Number(f.lockDate.slice(0, 4)) - 1}, па документите и налозите од ${f.lockDate.slice(0, 4)} може да се менуваат и бришат.\n(По корекцијата заклучете ја годината повторно.)`}>🔓 Отклучи</ConfirmButton>
                      </form>}
                    </td>
                    <td className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                      <form action={openFirm}><input type="hidden" name="id" value={f.id} /><button className="btn sm">Отвори</button></form>
                      {can(u.principal, 'saveFirm', f.id) && <Link className="btn sm" href={`/firmi?edit=${f.id}`}>Измени</Link>}
                      {admin && <Link className="btn sm ghost danger" href={`/firmi?edit=${f.id}#del`} title="Бришењето е во картичката на фирмата (две потврди)">Избриши</Link>}
                    </td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={5} className="mut">{q ? `Нема фирма што одговара на „${q}“.` : 'Нема фирми за избраниот филтер.'}</td></tr>}
              </tbody>
            </table>
          </div>
        ) : <div className="card empty">Додадете ја вашата фирма. Сметководствено биро тука ги додава сите клиенти.</div>}
        {admin && nArch > 0 && (
          <div style={{ marginTop: 10 }}>
            {sp.arh === undefined ? <Link className="btn sm ghost" href="/firmi?arh">🗄 Избришани фирми ({nArch})</Link> : (
              <div className="card"><h2>🗄 Избришани фирми</h2><p className="note">Избришаните фирми се архивирани – книгите и документите се чуваат и фирмата може да се врати.</p>
                <div className="tw"><table><thead><tr><th>Фирма</th><th>ЕДБ</th><th></th></tr></thead><tbody>
                  {archived.map((f) => <tr key={f.id}><td>{f.name}</td><td>{f.edb ?? ''}</td><td><form action={restoreFirm}><input type="hidden" name="id" value={f.id} /><button className="btn sm">↩ Врати</button></form></td></tr>)}
                </tbody></table></div>
              </div>
            )}
          </div>
        )}
      </>}
    </>
  );
}
