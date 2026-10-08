import { desc, eq } from 'drizzle-orm';
import { can } from '@wise/core';
import { auditLog, firms, users } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { Hd, dmyHm } from '@/components/hd';

const LBL: Record<string, string> = {
  login: 'Најава', logout: 'Одјава', newFirm: 'Нова фирма', saveFirm: 'Промена на фирма',
  uNew: 'Нов корисник', uSave: 'Промена на корисник', uDel: 'Бришење корисник', uMyPass: 'Промена на сопствена лозинка',
  fileUpload: 'Прикачен документ',
};

/** Legacy `aktivnost`: last 300 audit entries. Admin-only (users permission), as the log shows everyone's activity. */
export default async function AktivnostPage() {
  const me = await requireUser();
  if (!can(me.principal, 'users')) return <><Hd t="Дневник на активности" /><div className="card empty">Само за администратор.</div></>;
  const L = await db()
    .select({ a: auditLog, user: users.name, firm: firms.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .leftJoin(firms, eq(firms.id, auditLog.firmId))
    .orderBy(desc(auditLog.at))
    .limit(300);
  return (
    <>
      <Hd t="Дневник на активности" sub="кој што направил" />
      <p className="note">Најави, промени на фирми и корисници, прикачени документи. Секој запис се зачувува во истата трансакција како и промената.</p>
      <div className="tw"><table>
        <thead><tr><th>Време</th><th>Корисник</th><th>Фирма</th><th>Активност</th><th>Детали</th></tr></thead>
        <tbody>
          {L.map(({ a, user, firm }) => (
            <tr key={a.id}>
              <td className="num">{dmyHm(a.at)}</td>
              <td>{user ?? '—'}</td>
              <td>{firm ?? ''}</td>
              <td>{LBL[a.action] ?? a.action}</td>
              <td><small className="mini">{a.data ? JSON.stringify(a.data) : ''}</small></td>
            </tr>
          ))}
          {!L.length && <tr><td colSpan={5} className="mut">Нема записи.</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}
