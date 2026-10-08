/** Legacy `VIEWS.klPortal` 9074 — which portal sections a client firm sees, and its business profile. */
import { and, eq } from 'drizzle-orm';
import { KL_BASEC, KL_PROF, KL_SEC, klRecommended, klSections, type KlConfig } from '@wise/core/office';
import { users, userFirms } from '@wise/db';
import { db } from '@/lib/db';
import { officePage } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { savePortal } from './actions';

export default async function KlPortalPage() {
  const { firm } = await officePage('klPortal', { perm: 'office' });
  if (!firm) return <NoFirm t="👥 Портал за клиенти" />;
  const kl = (firm.settings as { kl?: KlConfig }).kl ?? {};
  const on = new Set(klSections(kl).map((s) => s[0]));
  // Client users of this firm: names only (FIX #2 — never hashes or initial passwords).
  const clients = await db().select({ name: users.name, username: users.username, active: users.active, last: users.lastLoginAt })
    .from(users).innerJoin(userFirms, eq(userFirms.userId, users.id))
    .where(and(eq(userFirms.firmId, firm.id), eq(users.role, 'klient')));
  return (
    <>
      <Hd t="👥 Портал за клиенти" sub={firm.name} />
      <ActionForm action={savePortal} reset={false}>
        <h2>Дејност на фирмата</h2>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          {KL_PROF.map(([k, n]) => <label key={k} className="chk"><input type="checkbox" name="prof" value={k} defaultChecked={kl.prof?.includes(k)} /> {n}</label>)}
        </div>
        <h2 style={{ marginTop: 12 }}>Делови што ги гледа клиентот</h2>
        <div className="tw"><table className="dense"><tbody>
          {KL_SEC.map((s) => (
            <tr key={s[0]}>
              <td><label className="chk"><input type="checkbox" name="on" value={s[0]} defaultChecked={on.has(s[0])} /> {s[2]} <b>{s[1]}</b></label></td>
              <td className="mini">{s[5]}</td>
              <td>{KL_BASEC.includes(s[0]) ? <span className="pill info">основно</span> : klRecommended(s, kl.prof) ? <span className="pill good">препорачано</span> : null}</td>
            </tr>
          ))}
        </tbody></table></div>
        <p className="note">Клиентот гледа само ги вклучените делови; серверот ги одбива другите страници и сите акции на канцеларијата (одобрување, книжење, бришење).</p>
        <div className="row"><button className="btn pri">Зачувај</button></div>
      </ActionForm>
      <div className="card">
        <h2 style={{ fontSize: 15 }}>🔑 Корисници на клиентот</h2>
        {clients.length ? <table className="dense"><tbody>{clients.map((c) => <tr key={c.username}><td>{c.name}</td><td>{c.username}</td><td>{c.active ? 'активен' : 'неактивен'}</td></tr>)}</tbody></table>
          : <p className="note">Фирмата нема корисник со улога „Клиент“. Додадете го во <a href="/korisnici">Корисници</a> (улога Клиент, пристап до оваа фирма). Привремената лозинка се прикажува само еднаш и мора да се смени при прва најава.</p>}
      </div>
    </>
  );
}
