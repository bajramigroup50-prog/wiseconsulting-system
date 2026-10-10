import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { can, ROLES } from '@wise/core';
import { firms, userFirms, users } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { Hd, dmyHm } from '@/components/hd';
import { MyPassword } from './my-password';
import { UserForm } from './user-form';
import { DeleteUser } from './delete-user';

export default async function KorisniciPage({ searchParams }: { searchParams: Promise<{ edit?: string; nov?: string; saved?: string }> }) {
  const sp = await searchParams;
  const me = await requireUser();
  const selfBox = (
    <div className="card">
      <h2>Мојот профил</h2>
      <p className="note">{me.name} · <b>{me.username}</b> · {ROLES[me.role].n}</p>
      <MyPassword />
    </div>
  );
  if (!can(me.principal, 'users')) return <><Hd t="Мојот профил" />{selfBox}</>;

  const [U, F, UF] = await Promise.all([
    db().select().from(users).orderBy(asc(users.name)),
    db().select({ id: firms.id, name: firms.name }).from(firms).orderBy(asc(firms.name)),
    db().select().from(userFirms),
  ]);
  const fname = new Map(F.map((f) => [f.id, f.name]));
  const firmsOf = (uid: string) => UF.filter((x) => x.userId === uid).map((x) => x.firmId);

  const editing = sp.edit ? U.find((u) => u.id === sp.edit) : undefined;
  const showForm = sp.nov !== undefined || !!editing;

  const urow = (u: (typeof U)[number]) => (
    <tr key={u.id}>
      <td><b>{u.name}</b>{u.id === me.id && <> <span className="pill info">вие</span></>}</td>
      <td>{u.username}</td>
      <td><span className={`pill ${u.role === 'admin' ? 'bad' : u.role === 'view' ? '' : 'info'}`}>{ROLES[u.role]?.n ?? u.role}</span></td>
      <td>{u.allFirms || u.role === 'admin' ? 'сите' : firmsOf(u.id).map((id) => fname.get(id)).filter(Boolean).join(', ') || '—'}</td>
      <td>{u.active ? <span className="pill good">активен</span> : <span className="pill">неактивен</span>}</td>
      <td>{dmyHm(u.lastLoginAt)}</td>
      <td className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
        <Link className="btn sm" href={`/korisnici?edit=${u.id}`}>Измени</Link>
        {u.id !== me.id && <DeleteUser id={u.id} name={u.name} />}
      </td>
    </tr>
  );
  const uth = <thead><tr><th>Име</th><th>Корисничко име</th><th>Улога</th><th>Фирми</th><th>Статус</th><th>Последна најава</th><th></th></tr></thead>;
  const UC = U.filter((u) => u.role !== 'klient'), UK = U.filter((u) => u.role === 'klient');

  return (
    <>
      <Hd t="Корисници и улоги" sub={`${UC.length} колеги · ${UK.length} компании`}>
        <Link className="btn pri" href="/korisnici?nov">+ Нов корисник</Link>
      </Hd>
      {sp.saved && <div className="callout good" role="status">✓ Промените се зачувани.</div>}
      {showForm && (
        <UserForm
          user={editing ? { ...editing, firms: firmsOf(editing.id) } : null}
          allFirms={F}
          isSelf={editing?.id === me.id}
        />
      )}
      <div className="card"><h2>👥 Колеги во канцеларијата</h2><div className="tw"><table>{uth}<tbody>
        {UC.length ? UC.map(urow) : <tr><td colSpan={7} className="mut">Нема колеги – кликнете „+ Нов корисник“.</td></tr>}
      </tbody></table></div></div>
      <div className="card"><h2>🏢 Компании (клиенти – портал)</h2><div className="tw"><table>{uth}<tbody>
        {UK.length ? UK.map(urow) : <tr><td colSpan={7} className="mut">Нема клиенти со пристап.</td></tr>}
      </tbody></table></div></div>
      <div className="card"><h2>Улоги</h2><div className="tw"><table>
        <thead><tr><th>Улога</th><th>Што може</th></tr></thead>
        <tbody>{Object.values(ROLES).map((r) => <tr key={r.n}><td><b>{r.n}</b></td><td>{r.d}</td></tr>)}</tbody>
      </table></div></div>
      {selfBox}
    </>
  );
}
