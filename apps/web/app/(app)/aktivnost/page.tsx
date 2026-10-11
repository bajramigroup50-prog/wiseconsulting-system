import Link from 'next/link';
import { and, asc, count, desc, eq, gte, isNull, lt, type SQL } from 'drizzle-orm';
import { can } from '@wise/core';
import { addDays } from '@wise/core/office';
import { WORK_CAT_LBL, WORK_VERB_LBL, classifyAction, skopjeDayStart } from '@wise/core/office/productivity';
import { auditLog, firms, users } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { isUuid } from '@/lib/office';
import { isOfficeOwner } from '@/lib/office-owner';
import { Hd, dmyHm } from '@/components/hd';

const LBL: Record<string, string> = {
  login: 'Најава', logout: 'Одјава', newFirm: 'Нова фирма', saveFirm: 'Промена на фирма',
  uNew: 'Нов корисник', uSave: 'Промена на корисник', uDel: 'Бришење корисник', uMyPass: 'Промена на сопствена лозинка',
  fileUpload: 'Прикачен документ', ownerSet: 'Пренос на сопственост на канцеларијата',
};
const PAGE = 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Legacy `aktivnost`: the audit log, newest first, 100 per page. Admin-only (users permission), as the log shows
 * everyone's activity. Filters: firm, Од / До; the per-user filter (drill-down from 📊 Продуктивност на вработените)
 * only for the office owner.
 */
export default async function AktivnostPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  if (!can(me.principal, 'users')) return <><Hd t="Дневник на активности" /><div className="card empty">Само за администратор.</div></>;
  const sp = await searchParams;
  const owner = await isOfficeOwner(me);
  const od = DATE_RE.test(sp.od ?? '') ? sp.od! : '', dd = DATE_RE.test(sp.do ?? '') ? sp.do! : '';
  const fu = owner && (sp.u === '-' || isUuid(sp.u)) ? sp.u! : '';
  const ff = isUuid(sp.f) ? sp.f! : '';
  const pg = Math.max(1, Math.floor(Number(sp.pg) || 1));
  // Од / До are Skopje days
  const where: (SQL | undefined)[] = [
    od ? gte(auditLog.at, skopjeDayStart(od)) : undefined,
    dd ? lt(auditLog.at, skopjeDayStart(addDays(dd, 1))) : undefined,
    fu === '-' ? isNull(auditLog.userId) : fu ? eq(auditLog.userId, fu) : undefined,
    ff ? eq(auditLog.firmId, ff) : undefined,
  ];
  const W = and(...where);
  const [L, [cnt], U, F] = await Promise.all([
    db().select({ a: auditLog, user: users.name, firm: firms.name })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .leftJoin(firms, eq(firms.id, auditLog.firmId))
      .where(W)
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(PAGE).offset((pg - 1) * PAGE),
    db().select({ n: count() }).from(auditLog).where(W),
    owner ? db().select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.name)) : Promise.resolve([]),
    db().select({ id: firms.id, name: firms.name }).from(firms).orderBy(asc(firms.name)),
  ]);
  const n = cnt?.n ?? 0;
  const pages = Math.max(1, Math.ceil(n / PAGE));
  const href = (p: number) => { const q = new URLSearchParams(); if (od) q.set('od', od); if (dd) q.set('do', dd); if (fu) q.set('u', fu); if (ff) q.set('f', ff); if (p > 1) q.set('pg', String(p)); return `/aktivnost?${q}`; };
  const kind = (action: string, entityType: string | null, data: unknown) => {
    const c = classifyAction(action, entityType, data as Record<string, unknown> | null);
    if (!c) return '—';
    return c.byProduct ? `${WORK_CAT_LBL[c.cat]} (автоматски)` : `${WORK_CAT_LBL[c.cat]} · ${WORK_VERB_LBL[c.verb]}`;
  };
  return (
    <>
      <Hd t="Дневник на активности" sub="кој што направил" />
      <form className="card" method="get">
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="f" style={{ margin: 0 }}>Од<input type="date" name="od" defaultValue={od} /></label>
          <label className="f" style={{ margin: 0 }}>До<input type="date" name="do" defaultValue={dd} /></label>
          {owner && <label className="f" style={{ margin: 0 }}>Корисник<select name="u" defaultValue={fu} style={{ width: 'auto' }}>
            <option value="">Сите</option>
            {U.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            <option value="-">⚙ Автоматски (систем)</option>
          </select></label>}
          <label className="f" style={{ margin: 0 }}>Фирма<select name="f" defaultValue={ff} style={{ width: 'auto', maxWidth: 280 }}>
            <option value="">Сите фирми</option>
            {F.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select></label>
          <button className="btn pri">Прикажи</button>
          {(od || dd || fu || ff) && <Link className="btn" href="/aktivnost">✕ Исчисти</Link>}
          {owner && <Link className="btn" href={`/produktivnost${od || dd ? `?od=${od || dd}&do=${dd || od}` : ''}`}>📊 Продуктивност</Link>}
        </div>
      </form>
      <p className="note">Најави, промени на фирми и корисници, прикачени документи, секој зачуван документ. Секој запис се зачувува во истата трансакција како и промената. Вкупно {n.toLocaleString('mk-MK')} записи.</p>
      <div className="tw"><table>
        <thead><tr><th>Време</th><th>Корисник</th><th>Фирма</th><th>Активност</th><th>Вид на работа</th><th>Детали</th></tr></thead>
        <tbody>
          {L.map(({ a, user, firm }) => (
            <tr key={a.id}>
              <td className="num">{dmyHm(a.at)}</td>
              <td>{user ?? '—'}</td>
              <td>{firm ?? ''}</td>
              <td>{LBL[a.action] ?? a.action}</td>
              <td className="mini">{kind(a.action, a.entityType, a.data)}</td>
              <td><small className="mini">{a.data ? JSON.stringify(a.data).slice(0, 300) : ''}</small></td>
            </tr>
          ))}
          {!L.length && <tr><td colSpan={6} className="mut">Нема записи.</td></tr>}
        </tbody>
      </table></div>
      {pages > 1 && (
        <div className="row" style={{ gap: 8, justifyContent: 'center', margin: '10px 0' }}>
          {pg > 1 && <Link className="btn sm" href={href(pg - 1)}>‹ Понови</Link>}
          <span className="mini">страница {pg} од {pages}</span>
          {pg < pages && <Link className="btn sm" href={href(pg + 1)}>Постари ›</Link>}
        </div>
      )}
    </>
  );
}
