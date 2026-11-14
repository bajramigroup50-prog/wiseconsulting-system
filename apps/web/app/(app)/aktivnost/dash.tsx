/**
 * ✨ The colleagues' work dashboard on top of „Дневник на активности“: stat cards (work today vs yesterday, active
 * colleagues, firms, new documents), the last 14 days as bars and one card per colleague (today's work, firms, last
 * activity, main kind of work). Work = the audit rows `classifyAction` counts (no sign-ins, settings or postings made
 * automatically for a document). Same side scope as the log (`scopeAuditSql`).
 */
import Link from 'next/link';
import { and, gte } from 'drizzle-orm';
import { addDays } from '@wise/core/office';
import { todaySkopje } from '@wise/core/office/dates';
import { WORK_CAT_LBL, activeMinutes, classifyAction, fmtMinutes, perActiveHour, skopjeDayStart, type WorkCat } from '@wise/core/office/productivity';
import { auditLog, users } from '@wise/db';
import { db } from '@/lib/db';
import { scopeAuditSql } from '@/lib/demo-office';

type Me = Parameters<typeof scopeAuditSql>[0];
const WD = ['Нед', 'Пон', 'Вто', 'Сре', 'Чет', 'Пет', 'Саб'];
const COL = ['#f28c6b', '#2a9577', '#7f8cf0', '#f2b84b', '#e2574c', '#4fb3c8', '#b98ae6', '#5aa05a'];

export async function ActivityDash({ me, owner }: { me: Me; owner: boolean }) {
  const td = todaySkopje(), d14 = addDays(td, -13), yd = addDays(td, -1), m0 = td.slice(0, 8) + '01';
  // from the 1st of the month (the ranking) or 14 days back (the chart), whichever is earlier
  const d0 = m0 < d14 ? m0 : d14;
  const [R, U] = await Promise.all([
    db().select({ u: auditLog.userId, f: auditLog.firmId, a: auditLog.action, e: auditLog.entityType, d: auditLog.data, at: auditLog.at })
      .from(auditLog).where(and(scopeAuditSql(me), gte(auditLog.at, skopjeDayStart(d0)))).limit(50000),
    db().select({ id: users.id, name: users.name }).from(users),
  ]);
  const UN = new Map(U.map((x) => [x.id, x.name]));
  const days = Array.from({ length: 14 }, (_, i) => addDays(d14, i));
  const perDay = new Map(days.map((d) => [d, 0]));
  type P = { n: number; n14: number; firms: Set<string>; last: Date | null; cats: Map<WorkCat, number>; nm: number; tm: number[]; fm: Set<string>; dm: Set<string> };
  const per = new Map<string, P>();
  const T = { n: 0, users: new Set<string>(), firms: new Set<string>(), docs: 0 }, Y = { n: 0, users: new Set<string>(), firms: new Set<string>(), docs: 0 };
  for (const r of R) {
    if (!r.u) continue; // ⚙ automatic (system) rows are not a colleague's work
    const c = classifyAction(r.a, r.e, r.d as Record<string, unknown> | null);
    if (!c || c.byProduct) continue;
    const day = todaySkopje(r.at);
    const p: P = per.get(r.u) ?? { n: 0, n14: 0, firms: new Set<string>(), last: null, cats: new Map(), nm: 0, tm: [] as number[], fm: new Set<string>(), dm: new Set<string>() };
    per.set(r.u, p);
    if (day >= m0) { p.nm++; p.tm.push(r.at.getTime()); if (r.f) p.fm.add(r.f); p.dm.add(day); }
    if (day < d14) continue;
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    p.n14++;
    const S = day === td ? T : day === yd ? Y : null;
    if (S) { S.n++; S.users.add(r.u); if (r.f) S.firms.add(r.f); if (c.verb === 'c') S.docs++; }
    if (day === td) {
      p.n++; if (r.f) p.firms.add(r.f);
      if (!p.last || r.at > p.last) p.last = r.at;
      p.cats.set(c.cat, (p.cats.get(c.cat) ?? 0) + 1);
    }
  }
  const ch = (a: number, b: number) => (b ? Math.round((a - b) / b * 100) : null);
  const people = [...per.entries()].map(([id, p]) => ({ id, name: UN.get(id) ?? '(избришан корисник)', ...p }))
    .sort((a, b) => b.n - a.n || b.n14 - a.n14);
  const mx = Math.max(1, ...perDay.values());
  // 🏆 this month: who works the most / the least (work movements, active time, movements per active hour)
  const rank = people.filter((p) => p.nm > 0).map((p) => { const min = activeMinutes(p.tm); return { ...p, min, ph: perActiveHour(p.nm, min) }; })
    .sort((a, b) => b.nm - a.nm);
  const mxR = Math.max(1, ...rank.map((p) => p.nm));
  const MNF = ['јануари', 'февруари', 'март', 'април', 'мај', 'јуни', 'јули', 'август', 'септември', 'октомври', 'ноември', 'декември'][+td.slice(5, 7) - 1];
  const hm = (d: Date) => new Intl.DateTimeFormat('mk-MK', { timeZone: 'Europe/Skopje', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  const ini = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  const href = (id: string) => (owner ? `/aktivnost?u=${id}&od=${td}&do=${td}` : `/aktivnost?od=${td}&do=${td}`);
  return (
    <div id="actDash" style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 14 }}>
      <div className="bh-stats">
        <Stat g="bh-g1" ic="⚡" t="Работни активности денес" v={T.n} d={ch(T.n, Y.n)} s={`вчера ${Y.n}`} />
        <Stat g="bh-g2" ic="👥" t="Активни колеги денес" v={T.users.size} s={`вчера ${Y.users.size}`} />
        <Stat g="bh-g3" ic="🏢" t="Фирми опфатени денес" v={T.firms.size} s={`вчера ${Y.firms.size}`} />
        <Stat g="bh-g4" ic="📄" t="Нови документи / записи денес" v={T.docs} d={ch(T.docs, Y.docs)} s={`вчера ${Y.docs}`} />
      </div>
      <div className="cols">
        <div className="card" style={{ borderRadius: 16 }}><div className="hd"><h2>Работа по денови · последни 14 дена</h2></div>
          <div className="bh-bars" style={{ gridTemplateColumns: 'repeat(14,1fr)' }}>{days.map((d) => { const v = perDay.get(d) ?? 0; const wd = new Date(d + 'T12:00:00Z').getUTCDay(); return (
            <Link key={d} href={`/aktivnost?od=${d}&do=${d}`} className={`bh-m ${d === td ? 'bh-cur' : ''}`} title={`${d.split('-').reverse().join('.')}: ${v} активности`} style={{ textDecoration: 'none' }}>
              <div className="bh-pair"><i style={{ width: 16, height: `${v / mx * 100}%`, background: d === td ? '#f28c6b' : wd === 0 || wd === 6 ? 'var(--line)' : '#2a9577' }} /></div>
              <small>{WD[wd]}<br />{d.slice(8)}</small></Link>); })}
          </div>
        </div>
        <div className="card" style={{ borderRadius: 16 }}><div className="hd"><h2>Колегите денес</h2><span className="note">{people.filter((p) => p.n).length} активни</span></div>
          {people.length ? <div style={{ display: 'grid', gap: 8 }}>{people.slice(0, 12).map((p, i) => {
            const top = [...p.cats.entries()].sort((a, b) => b[1] - a[1])[0];
            return (
              <Link key={p.id} href={href(p.id)} className="bh-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', opacity: p.n ? 1 : 0.6 }}>
                <span style={{ width: 38, height: 38, borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, background: COL[i % COL.length], flex: '0 0 auto' }}>{ini(p.name)}</span>
                <span style={{ flex: 1, minWidth: 0 }}><b>{p.name}</b><br /><small className="mini">{p.n ? `${p.firms.size} фирми · последно ${p.last ? hm(p.last) : '—'}${top ? ' · најмногу: ' + WORK_CAT_LBL[top[0]] : ''}` : 'денес без активност'} · 14 дена: {p.n14}</small></span>
                <b style={{ fontSize: 22 }}>{p.n}</b>
              </Link>); })}</div> : <div className="empty">Нема активност во последните 14 дена.</div>}
        </div>
      </div>
      {rank.length > 0 && (
        <div className="card" style={{ borderRadius: 16 }}>
          <div className="hd"><h2>🏆 Кој колку работи · {MNF}</h2>
            {owner && <span className="row" style={{ gap: 6 }}><Link className="btn sm pri" href="/aktivnost/mesec">📅 Месечен извештај</Link><Link className="btn sm" href={`/produktivnost?od=${m0}&do=${td}`}>📊 Детално</Link></span>}</div>
          <div className="tw"><table>
            <thead><tr><th>#</th><th>Колега</th><th style={{ width: '34%' }}>Работни активности</th><th className="n">Активности</th><th className="n">Активно време</th><th className="n">Во час</th><th className="n">Денови</th><th className="n">Фирми</th></tr></thead>
            <tbody>{rank.map((p, i) => { const last = i === rank.length - 1 && rank.length > 1; return (
              <tr key={p.id}>
                <td>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : last ? '🔻' : i + 1}</td>
                <td><Link className="lnk" href={owner ? `/aktivnost?u=${p.id}&od=${m0}&do=${td}` : '#'}><b>{p.name}</b></Link>{i === 0 && <span className="pill good" style={{ marginLeft: 6 }}>најмногу</span>}{last && <span className="pill bad" style={{ marginLeft: 6 }}>најмалку</span>}</td>
                <td><div style={{ height: 10, borderRadius: 5, background: 'var(--soft)' }}><div style={{ width: `${p.nm / mxR * 100}%`, height: '100%', borderRadius: 5, background: i === 0 ? '#2a9577' : last ? '#e2574c' : '#f28c6b' }} /></div></td>
                <td className="n"><b>{p.nm.toLocaleString('mk-MK')}</b></td><td className="n">{fmtMinutes(p.min)}</td>
                <td className="n">{p.ph != null ? String(p.ph).replace('.', ',') : '—'}</td><td className="n">{p.dm.size}</td><td className="n">{p.fm.size}</td>
              </tr>); })}</tbody>
          </table></div>
          <p className="mini" style={{ margin: '8px 0 0' }}>Се бројат само работни активности (внес, измена, книжење на документи), без најави и автоматски книжења. Активно време = периоди на работа во WISE (пауза над 15 мин. прекинува). „Во час“ = активности по активен час. Ориентационо – не ја мери тежината на работата.</p>
        </div>
      )}
    </div>
  );
}

function Stat({ g, ic, t, v, d, s }: { g: string; ic: string; t: string; v: number; d?: number | null; s: string }) {
  return (
    <div className={`bh-card ${g}`}>
      <span className="bh-ic" aria-hidden>{ic}</span>
      <span className="bh-t">{t}</span>
      <b className="bh-v">{v.toLocaleString('mk-MK')}</b>
      <span className="bh-s">{d != null && <span className={d >= 0 ? 'bh-up' : 'bh-dn'}>{d >= 0 ? '▲' : '▼'} {Math.abs(d)}% </span>}{s}</span>
    </div>
  );
}
