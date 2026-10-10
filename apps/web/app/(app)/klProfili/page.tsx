/**
 * Legacy `VIEWS.klProfili` (9170) — Профили на клиенти: one `klient` user per firm (random username + strong
 * temporary password, changed at the first login); create missing profiles, new password, rename sequence-number
 * usernames, print the access data.
 * FIX: passwords are never stored in clear (legacy `pw0`) — they are shown and printable once, right after they are
 * created or reset; afterwards the list only says whether the client still has the temporary one.
 */
import { notFound } from 'next/navigation';
import { asc, eq, inArray } from 'drizzle-orm';
import { can } from '@wise/core';
import { firms, userFirms, users } from '@wise/db';
import { db } from '@/lib/db';
import { allowedFirms, officePage } from '@/lib/office';
import { Hd, dmy } from '@/components/hd';
import { createAllProfiles, renameNumeric, resetPassword } from './actions';
import { CredButton } from './cred-buttons';

export default async function KlProfiliPage() {
  const { u } = await officePage('klProfili');
  if (!can(u.principal, 'users')) notFound();
  const L = await db().select({ id: users.id, name: users.name, username: users.username, must: users.mustChangePassword, last: users.lastLoginAt, active: users.active })
    .from(users).where(eq(users.role, 'klient')).orderBy(asc(users.name));
  const UF = L.length ? await db().select({ u: userFirms.userId, f: firms.id, name: firms.name }).from(userFirms)
    .innerJoin(firms, eq(firms.id, userFirms.firmId)).where(inArray(userFirms.userId, L.map((x) => x.id))) : [];
  const firmOf = new Map(UF.map((x) => [x.u, x.name]));
  const withProfile = new Set(UF.map((x) => x.f));
  const miss = (await allowedFirms(u)).filter((f) => !withProfile.has(f.id));
  const numU = L.filter((x) => /^\d+$/.test(x.username));
  return (
    <>
      <Hd t="Профили на клиенти" sub={`${L.length} профили`}>
        <CredButton className="btn pri" action={createAllProfiles} label={`+ Креирај профили за ${miss.length} фирми без профил`} confirm={`Да се креираат профили за ${miss.length} фирми?`} />
      </Hd>
      {numU.length > 0 && (
        <div className="callout warn">⚠ {numU.length} профили имаат корисничко име со реден број ({numU.slice(0, 5).map((x) => x.username).join(', ')}{numU.length > 5 ? '…' : ''}) – лесно се погодува.{' '}
          <CredButton className="btn sm pri" action={renameNumeric} label="🔐 Промени ги во случајни имиња и нови лозинки" confirm={`${numU.length} клиенти добиваат НОВО корисничко име (случајно, не реден број) и НОВА лозинка.\n\nСтарите податоци престануваат да важат – по промената испечатете ги новите пристапни податоци и доставете им ги на клиентите.\n\nДа продолжам?`} />
        </div>
      )}
      <p className="note">Секоја нова фирма (од решение или од Excel) може автоматски да добие профил: корисничко име од називот + 4 случајни знаци (пр. bajrami.k7m2 – не е реден број), лозинка од 12 знаци (пр. Kp7m-Xq3v-Rt9w); при прва најава клиентот ја менува. Деловите од порталот што клиентот ги гледа се избираат во „👥 Портал за клиенти“. Лозинката се гледа само веднаш по креирањето или „🔑 Нова лозинка“ – тогаш испечатете ги пристапните податоци.</p>
      <div className="tw"><table className="dense">
        <thead><tr><th>Бр.</th><th>Фирма</th><th>Корисничко име</th><th>Лозинка</th><th>Последна најава</th><th></th></tr></thead>
        <tbody>
          {L.map((x, i) => (
            <tr key={x.id} style={x.active ? undefined : { opacity: 0.55 }}>
              <td>{i + 1}</td><td>{firmOf.get(x.id) ?? '—'}</td><td><b>{x.username}</b></td>
              <td>{x.must ? <span className="mini">привремена – клиентот уште не ја сменил</span> : <span className="mini">сменета од клиентот</span>}</td>
              <td>{x.last ? dmy(x.last) : '—'}</td>
              <td style={{ whiteSpace: 'nowrap' }}><CredButton className="btn sm" action={resetPassword.bind(null, x.id)} label="🔑 Нова лозинка" confirm={`Нова лозинка за ${x.username} (${x.name})? Старата повеќе нема да важи.`} /></td>
            </tr>
          ))}
          {!L.length && <tr><td colSpan={6} className="note">Нема профили.</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}
