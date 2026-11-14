/**
 * 📅 Месечен извештај по колега (Дневник на активности → owner only): for a month, every colleague with the firms
 * delegated to them (`user_firms`; „сите фирми“ = every active firm) — was each firm worked on (work movements from
 * the activity log, `classifyAction`), how much, last day; coverage %, total work, active time, days, and a
 * suggestion for the owner (раст / во ред / разговор – ориентационо). Print → PDF for the salary decision.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, eq, gte, lt, ne } from 'drizzle-orm';
import { addDays } from '@wise/core/office';
import { todaySkopje } from '@wise/core/office/dates';
import { activeMinutes, classifyAction, fmtMinutes, perActiveHour, skopjeDayStart } from '@wise/core/office/productivity';
import { auditLog, firms, userFirms, users } from '@wise/db';
import { db } from '@/lib/db';
import { firmSideSql, scopeAuditSql, userSideSql } from '@/lib/demo-office';
import { OWNER_ONLY_MSG } from '@/lib/office-owner';
import { Hd } from '@/components/hd';
import { ownerGate } from '../../produktivnost/data';
import { PrintBtn } from './print-btn';

const T = '📅 Месечен извештај по колега';
const MN = ['јануари', 'февруари', 'март', 'април', 'мај', 'јуни', 'јули', 'август', 'септември', 'октомври', 'ноември', 'декември'];
const dm = (d: string) => d.slice(8, 10) + '.' + d.slice(5, 7);

export default async function MesecPage({ searchParams }: { searchParams: Promise<{ m?: string; min?: string }> }) {
  const { u, ok } = await ownerGate();
  if (u.role === 'klient' || u.role === 'teren') notFound();
  if (!ok) return <><Hd t={T} exp={false} /><div className="card empty">{OWNER_ONLY_MSG}</div></>;
  const sp = await searchParams;
  const td = todaySkopje();
  // default: the month that just ended (until the 10th), else the current one
  const prev = (() => { let y = +td.slice(0, 4), m = +td.slice(5, 7) - 1; if (!m) { m = 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; })();
  const mon = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m ?? '') ? sp.m! : +td.slice(8, 10) <= 10 ? prev : td.slice(0, 7);
  const from = mon + '-01';
  const to = addDays(((y, m) => `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`)(+mon.slice(0, 4), +mon.slice(5, 7)), -1);
  const minN = Math.max(1, Math.min(50, Math.floor(Number(sp.min) || 1)));
  const [U, F, UF, R] = await Promise.all([
    db().select({ id: users.id, name: users.name, role: users.role, all: users.allFirms }).from(users)
      .where(and(userSideSql(u), eq(users.active, true), ne(users.role, 'klient'))).orderBy(asc(users.name)),
    db().select({ id: firms.id, name: firms.name }).from(firms).where(and(firmSideSql(u), eq(firms.active, true))).orderBy(asc(firms.name)),
    db().select({ u: userFirms.userId, f: userFirms.firmId }).from(userFirms),
    db().select({ u: auditLog.userId, f: auditLog.firmId, a: auditLog.action, e: auditLog.entityType, d: auditLog.data, at: auditLog.at }).from(auditLog)
      .where(and(scopeAuditSql(u), gte(auditLog.at, skopjeDayStart(from)), lt(auditLog.at, skopjeDayStart(addDays(to, 1))))).limit(300000),
  ]);
  const FN = new Map(F.map((f) => [f.id, f.name]));
  // work per user per firm
  type W = { n: number; last: string; tm: number[]; days: Set<string>; byF: Map<string, { n: number; last: string }> };
  const work = new Map<string, W>();
  for (const r of R) {
    if (!r.u) continue;
    const c = classifyAction(r.a, r.e, r.d as Record<string, unknown> | null);
    if (!c || c.byProduct) continue;
    const day = todaySkopje(r.at);
    const w: W = work.get(r.u) ?? { n: 0, last: '', tm: [], days: new Set<string>(), byF: new Map() };
    w.n++; w.tm.push(r.at.getTime()); w.days.add(day); if (day > w.last) w.last = day;
    if (r.f) { const x = w.byF.get(r.f) ?? { n: 0, last: '' }; x.n++; if (day > x.last) x.last = day; w.byF.set(r.f, x); }
    work.set(r.u, w);
  }
  const ufs = new Map<string, string[]>();
  for (const x of UF) if (FN.has(x.f)) ufs.set(x.u, [...(ufs.get(x.u) ?? []), x.f]);
  const rows = U.map((x) => {
    const w = work.get(x.id);
    // „сите фирми“: nothing delegated – the firms they worked on are listed, no coverage
    const assigned = x.all ? [...(w?.byF.keys() ?? [])].filter((f) => FN.has(f)) : ufs.get(x.id) ?? [];
    const firmsRows = assigned.map((fid) => ({ id: fid, name: FN.get(fid) ?? '', n: w?.byF.get(fid)?.n ?? 0, last: w?.byF.get(fid)?.last ?? '' }))
      .sort((a, b) => (a.n >= minN ? 1 : 0) - (b.n >= minN ? 1 : 0) || a.name.localeCompare(b.name));
    const done = firmsRows.filter((f) => f.n >= minN).length;
    const cov = !x.all && assigned.length ? Math.round(done / assigned.length * 100) : null;
    const min = activeMinutes(w?.tm ?? []);
    return { ...x, assigned: assigned.length, firmsRows, done, cov, n: w?.n ?? 0, min, ph: perActiveHour(w?.n ?? 0, min), days: w?.days.size ?? 0 };
  }).filter((x) => x.id !== u.id && (x.assigned > 0 || x.n > 0));
  const med = (() => { const a = rows.map((r) => r.n).filter((n) => n > 0).sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)]! : 0; })();
  const verdict = (r: (typeof rows)[number]) => {
    if (r.cov == null) return { k: '', t: r.all ? '⚪ Пристап до сите фирми – доделете фирми за оценка' : 'нема делегирани фирми' };
    if (r.cov >= 95 && r.n >= med) return { k: 'good', t: '🟢 За пофалба / раст на плата' };
    if (r.cov >= 80) return { k: 'warn', t: '🟡 Во ред – следи ги необработените фирми' };
    return { k: 'bad', t: '🔴 Разговор / можна казна – многу фирми необработени' };
  };
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(+td.slice(0, 4), +td.slice(5, 7) - 1 - i, 1)); return d.toISOString().slice(0, 7); });
  return (
    <div className="pdfdoc-screen">
      <Hd t={T} sub={`${MN[+mon.slice(5, 7) - 1]} ${mon.slice(0, 4)} · ${dm(from)} – ${dm(to)}`} exp={false}>
        <PrintBtn />
        <Link className="btn" href="/aktivnost">← Дневник на активности</Link>
      </Hd>
      <form className="card noprint" method="get" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="f" style={{ margin: 0 }}>Месец<select name="m" defaultValue={mon}>{months.map((m) => <option key={m} value={m}>{MN[+m.slice(5, 7) - 1]} {m.slice(0, 4)}</option>)}</select></label>
        <label className="f" style={{ margin: 0 }}>Фирмата е „обработена“ со најмалку<select name="min" defaultValue={String(minN)}>{[1, 3, 5, 10, 20].map((x) => <option key={x} value={x}>{x} активности</option>)}</select></label>
        <button className="btn pri">Прикажи</button>
      </form>
      <div className="bh-stats" style={{ margin: '14px 0' }}>
        <div className="bh-card bh-g2"><span className="bh-ic">👥</span><span className="bh-t">Колеги со делегирани фирми</span><b className="bh-v">{rows.filter((r) => r.assigned && !r.all).length}</b><span className="bh-s">медијана {med} активности</span></div>
        <div className="bh-card bh-g1"><span className="bh-ic">🏢</span><span className="bh-t">Делегирани фирми – обработени</span><b className="bh-v">{rows.filter((r) => !r.all).reduce((s, r) => s + r.done, 0)} / {rows.filter((r) => !r.all).reduce((s, r) => s + r.assigned, 0)}</b><span className="bh-s">збир по колеги</span></div>
        <div className="bh-card bh-g3"><span className="bh-ic">🟢</span><span className="bh-t">За пофалба</span><b className="bh-v">{rows.filter((r) => verdict(r).k === 'good').length}</b><span className="bh-s">покриеност ≥ 95% и над медијаната</span></div>
        <div className="bh-card bh-g4"><span className="bh-ic">🔴</span><span className="bh-t">За разговор</span><b className="bh-v">{rows.filter((r) => verdict(r).k === 'bad').length}</b><span className="bh-s">покриеност под 80%</span></div>
      </div>
      <div className="card" style={{ borderRadius: 16 }}><div className="hd"><h2>Преглед по колега</h2></div>
        <div className="tw"><table>
          <thead><tr><th>Колега</th><th className="n">Делегирани</th><th className="n">Обработени</th><th style={{ width: '18%' }}>Покриеност</th><th className="n">Активности</th><th className="n">Активно време</th><th className="n">Во час</th><th className="n">Денови</th><th>Предлог</th><th>Одлука</th></tr></thead>
          <tbody>{rows.map((r) => { const v = verdict(r); return (
            <tr key={r.id}><td><a className="lnk" href={`#u-${r.id}`}><b>{r.name}</b></a>{r.all && <small className="mini"> (сите фирми)</small>}</td>
              <td className="n">{r.all ? '—' : r.assigned}</td><td className="n">{r.done}</td>
              <td>{r.cov != null && <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><div style={{ flex: 1, height: 10, borderRadius: 5, background: 'var(--soft)' }}><div style={{ width: `${r.cov}%`, height: '100%', borderRadius: 5, background: r.cov >= 95 ? 'var(--good)' : r.cov >= 80 ? '#d8a400' : 'var(--bad)' }} /></div><b>{r.cov}%</b></div>}</td>
              <td className="n">{r.n.toLocaleString('mk-MK')}</td><td className="n">{fmtMinutes(r.min)}</td><td className="n">{r.ph != null ? String(r.ph).replace('.', ',') : '—'}</td><td className="n">{r.days}</td>
              <td><span className={`pill ${v.k}`}>{v.t}</span></td><td style={{ minWidth: 120, borderBottom: '1px dotted var(--muted)' }} /></tr>); })}
            {!rows.length && <tr><td colSpan={10} className="empty">Нема колеги со делегирани фирми или активност во месецот.</td></tr>}</tbody>
        </table></div>
        <p className="mini" style={{ margin: '8px 0 0' }}>Делегирани = фирмите доделени на корисникот (Корисници → фирми); „сите фирми“ = сите активни фирми. Обработена = најмалку {minN} работни активности во фирмата во месецот. Предлогот е ориентационен – одлуката за раст или казна е ваша (колоната „Одлука“ за потпис на печатениот извештај).</p>
      </div>
      {rows.filter((r) => r.assigned && !r.all).map((r) => {
        const miss = r.firmsRows.filter((f) => f.n < minN);
        return (
          <div className="card" key={r.id} id={`u-${r.id}`} style={{ borderRadius: 16, marginTop: 14, breakInside: 'avoid' }}>
            <div className="hd"><h2>{r.name} · {r.done} / {r.assigned} фирми обработени</h2><span className={`pill ${verdict(r).k}`}>{r.cov}%</span></div>
            {miss.length > 0 && <p style={{ margin: '0 0 8px' }}><b style={{ color: 'var(--bad)' }}>❌ Необработени ({miss.length}):</b> {miss.map((f) => f.name).join(', ')}</p>}
            <div className="tw"><table className="dense">
              <thead><tr><th>Фирма</th><th className="n">Активности</th><th>Последно</th><th>Статус</th></tr></thead>
              <tbody>{r.firmsRows.map((f) => (
                <tr key={f.id}><td><Link className="lnk" href={`/aktivnost?u=${r.id}&f=${f.id}&od=${from}&do=${to}`}>{f.name}</Link></td><td className="n">{f.n}</td><td>{f.last ? dm(f.last) : '—'}</td>
                  <td>{f.n >= minN ? <span className="pill good">✅ обработена</span> : <span className="pill bad">❌ необработена</span>}</td></tr>))}</tbody>
            </table></div>
          </div>
        );
      })}
    </div>
  );
}
