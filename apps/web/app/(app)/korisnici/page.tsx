import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { can, ROLES } from '@wise/core';
import { employees, firms, getOfficeProfile, userFirms, users } from '@wise/db';
import { IzjCell } from './izj-cell';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { ownTemplateKinds } from '@/lib/own-template';
import { Hd, dmyHm } from '@/components/hd';
import { MyPassword } from './my-password';
import { UserForm } from './user-form';
import { DeleteUser } from './delete-user';
import { FirmGo } from '@/components/firm-go';
import { RowAction } from '@/components/row-action';
import { activeLocks } from '@/lib/login-guard';
import { isOfficeOwner } from '@/lib/office-owner';
import { unlockLogin } from './actions';

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
  // login locks (5 failures per username / 20 per IP → 15 min): the owner sees them and can unlock early
  const owner = await isOfficeOwner(me);
  const LOCKS = owner ? await activeLocks() : [];
  const hm = (ms: number) => new Date(ms).toLocaleTimeString('mk-MK', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Skopje' });
  const unlockBtn = (key: string, what: string) => (
    <RowAction action={unlockLogin.bind(null, key)} label="🔓 Отклучи" className="btn sm" confirm={`Да се отклучи најавата за ${what}?`} />
  );
  const lockOf = (username: string) => LOCKS.find((l) => l.scope === 'u' && l.id === username.toLowerCase());
  const IZJ_K = 'd:Изјава за доверливост';
  const izjOwn = (await ownTemplateKinds([IZJ_K])).has(IZJ_K);
  // legacy „Изјава · Договор“: the colleague's employment contract in the office's own firm (matched by name)
  const office = (await db().select({ id: firms.id, settings: firms.settings }).from(firms)).find((f) => (f.settings as { officeFirm?: boolean }).officeFirm);
  const EMP = office ? await db().select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.firmId, office.id)) : [];
  const IZJ = (await getOfficeProfile(db())).zzlp?.izj ?? {};
  const empOf = (n: string) => EMP.find((e) => e.name.trim().toLowerCase() === n.trim().toLowerCase());
  const firmsOf = (uid: string) => UF.filter((x) => x.userId === uid).map((x) => x.firmId);

  const editing = sp.edit ? U.find((u) => u.id === sp.edit) : undefined;
  const showForm = sp.nov !== undefined || !!editing;

  const urow = (u: (typeof U)[number]) => (
    <tr key={u.id}>
      <td><b>{u.name}</b>{u.id === me.id && <> <span className="pill info">вие</span></>}</td>
      <td>{u.username}</td>
      <td><span className={`pill ${u.role === 'admin' ? 'bad' : u.role === 'view' ? '' : 'info'}`}>{ROLES[u.role]?.n ?? u.role}</span></td>
      <td>{u.allFirms || u.role === 'admin' ? 'сите' : firmsOf(u.id).map((id) => fname.get(id)).filter(Boolean).join(', ') || '—'}</td>
      <td>{u.active ? <span className="pill good">активен</span> : <span className="pill">неактивен</span>}
        {lockOf(u.username) && <> <span className="pill bad" title="Премногу неуспешни обиди за најава">🔒 заклучен до {hm(lockOf(u.username)!.until)}</span>{' '}{unlockBtn(lockOf(u.username)!.key, u.username)}</>}</td>
      <td>{dmyHm(u.lastLoginAt)}</td>
      {u.role !== 'klient' && <td style={{ whiteSpace: 'nowrap' }}>
        {u.role === 'admin' ? <span className="pill info" title="Изјава за доверливост не е потребна за сопственикот">👑 сопственик</span> : <IzjCell uid={u.id} signed={!!IZJ[u.id]?.signed} at={IZJ[u.id]?.at} fileId={IZJ[u.id]?.fileId} fileName={IZJ[u.id]?.fileName} />}{' '}
        <a className="btn sm" href={`/print/izjava?u=${u.id}`} target="_blank" title="Изјава за доверливост (ЗЗЛП)">📄 Изјава</a>{' '}
        {izjOwn && <><a className="btn sm" href={`/api/office/tpl/own?${new URLSearchParams({ k: IZJ_K, src: `user:${u.id}`, fmt: 'word' })}`} title="Word од сопствениот шаблон">📝 Word</a>{' '}</>}
        {empOf(u.name) && <FirmGo fid={office!.id} to={`/vraboteni/${empOf(u.name)!.id}/dogovor`} className="btn sm" title="Договор за вработување (фирма на канцеларијата)">📄 Договор</FirmGo>}
      </td>}
      <td className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
        <Link className="btn sm" href={`/korisnici?edit=${u.id}`}>Измени</Link>
        {u.id !== me.id && <DeleteUser id={u.id} name={u.name} />}
      </td>
    </tr>
  );
  const uth = <thead><tr><th>Име</th><th>Корисничко име</th><th>Улога</th><th>Фирми</th><th>Статус</th><th>Последна најава</th><th>Изјава · Договор</th><th></th></tr></thead>;
  const uthK = <thead><tr><th>Име</th><th>Корисничко име</th><th>Улога</th><th>Фирми</th><th>Статус</th><th>Последна најава</th><th></th></tr></thead>;
  const UC = U.filter((u) => u.role !== 'klient'), UK = U.filter((u) => u.role === 'klient');

  return (
    <>
      <Hd t="Корисници и улоги" sub={`${UC.length} колеги · ${UK.length} компании`}>
        <Link className="btn pri" href="/korisnici?nov">+ Нов корисник</Link>
      </Hd>
      {sp.saved && <div className="callout good" role="status">✓ Корисникот е зачуван.</div>}
      {LOCKS.length > 0 && (
        <div className="card" id="zaklucheni"><h2>🔒 Заклучени најави</h2>
          <p className="note">По 5 неуспешни обиди за едно корисничко име или 20 од една IP-адреса, најавата е заклучена 15 минути.</p>
          <div className="tw"><table className="dense">
            <thead><tr><th>Заклучено</th><th>Неуспешни обиди</th><th>До</th><th></th></tr></thead>
            <tbody>{LOCKS.map((l) => <tr key={l.key}>
              <td>{l.scope === 'ip' ? <>IP-адреса <b>{l.id}</b></> : <>корисничко име <b>{l.id}</b></>}</td>
              <td>{l.n}</td><td>{hm(l.until)}</td>
              <td>{unlockBtn(l.key, l.id)}</td>
            </tr>)}</tbody>
          </table></div>
        </div>
      )}
      {showForm && (
        <UserForm
          user={editing ? { ...editing, firms: firmsOf(editing.id) } : null}
          allFirms={F}
          isSelf={editing?.id === me.id}
        />
      )}
      <div className="card"><h2>👥 Колеги во канцеларијата</h2><div className="tw"><table>{uth}<tbody>
        {UC.length ? UC.map(urow) : <tr><td colSpan={8} className="mut">Нема колеги – кликнете „+ Нов корисник“.</td></tr>}
      </tbody></table></div>{!office && <p className="note">„📄 Договор“: Означете ја фирмата на канцеларијата (Фирми → „фирма на канцеларијата“).</p>}</div>
      <div className="card"><h2>🏢 Компании (клиенти – портал)</h2><div className="tw"><table>{uthK}<tbody>
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
