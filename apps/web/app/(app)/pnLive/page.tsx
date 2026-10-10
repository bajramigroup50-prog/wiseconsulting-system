/**
 * Legacy `VIEWS.pnLive` 9452 — Возила во живо: travel orders on the road with the last position sent by the driver's
 * phone (age, speed), delivered stops, next stop, Google Maps link, and the track of the selected vehicle
 * (legacy `pnTrackSVG`). The page refreshes itself every 30 s.
 */
import Link from 'next/link';
import { agoText, mapsUrl, stalePosition, trackProjection } from '@wise/core/industry';
import { eventsOf, liveVehicles, orderTrack, stopsOf } from '@wise/db';
import { db } from '@/lib/db';
import { industryPage } from '@/lib/industry';
import { AutoRefresh } from '@/components/auto-refresh';
import { Hd } from '@/components/hd';

const COL: Record<string, string> = { dep: '#555', ret: '#111', pick: '#e08a00', deliv: '#1f8a4c' };

export default async function PnLive({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('pnLive', 'Возила во живо');
  if (g.blocked) return g.blocked;
  const L = await liveVehicles(db(), g.firm.id);
  const sel = L.find((x) => x.o.id === sp.id) ?? L[0];
  const T = sel ? await orderTrack(db(), g.firm.id, sel.o.id) : [];
  const ev = sel ? eventsOf(sel.o).filter((e) => e.geo).map((e) => ({ lat: e.geo!.lat, lon: e.geo!.lon, k: e.k, txt: e.txt })) : [];
  const pr = sel ? trackProjection(T, ev, sel.pos) : null;
  const now = Date.now();
  return (
    <>
      <AutoRefresh seconds={30} />
      <Hd t="Возила во живо" sub={`${L.length} на пат`}><Link className="btn" href="/pnalozi">🚚 Патни налози</Link></Hd>
      {L.length ? (
        <>
          <div className="tw"><table><thead><tr><th>Возило</th><th>Возач</th><th>Последна позиција</th><th className="n">Брзина</th><th>Испорачано</th><th>Следно застанување</th><th /></tr></thead>
            <tbody>{L.map(({ o, pos }) => {
              const S = stopsOf(o);
              const nx = S.find((s) => s.status !== 'done');
              return (
                <tr key={o.id} style={o.id === sel?.o.id ? { background: 'var(--accent-soft)' } : undefined}>
                  <td><Link href={`/pnLive?id=${o.id}`}><b>{o.plate}</b></Link> <span className="mini">{o.vname}</span></td><td>{o.driver}</td>
                  <td>{pos ? <span style={stalePosition(pos.at, now) ? { color: 'var(--bad)' } : undefined}>{agoText(pos.at, now)}</span> : <span className="mini">нема сигнал</span>}</td>
                  <td className="n">{pos?.spd != null ? `${pos.spd} км/ч` : ''}</td>
                  <td>{S.filter((s) => s.status === 'done').length}/{S.length}</td>
                  <td className="mini">{nx ? (nx.kind === 'pick' ? '📦 ' : '🚚 ') + nx.partner : '—'}</td>
                  <td>{pos && <a className="btn sm" href={mapsUrl(pos)} target="_blank" rel="noopener noreferrer">📍 Мапа</a>}</td>
                </tr>);
            })}</tbody></table></div>
          {sel && (
            <div className="card">
              <div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>{sel.o.plate} · {sel.o.driver} · налог {sel.o.number}</h2>
                {sel.pos && <a className="btn sm pri" href={mapsUrl(sel.pos)} target="_blank" rel="noopener noreferrer">Отвори ја позицијата во Google Maps</a>}</div>
              {pr ? (
                <>
                  <svg viewBox={`0 0 ${pr.W} ${pr.H}`} style={{ width: '100%', maxWidth: pr.W, background: 'var(--accent-soft)', borderRadius: 8, display: 'block' }} role="img" aria-label="Изминат пат">
                    {pr.line.length > 1 && <polyline points={pr.line.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#1f6feb" strokeWidth={3} strokeLinejoin="round" />}
                    {pr.marks.map((e, i) => <circle key={i} cx={e.x} cy={e.y} r={7} fill={COL[e.k] ?? '#1f8a4c'} stroke="#fff" strokeWidth={2}><title>{e.txt}</title></circle>)}
                    {pr.cur && <circle cx={pr.cur.x} cy={pr.cur.y} r={10} fill="#d11a2a" stroke="#fff" strokeWidth={3}><title>Сега: {sel.pos?.at.slice(11, 16)}</title></circle>}
                  </svg>
                  <div className="mini" style={{ marginTop: 4 }}>🔴 сега · 🟢 испорака · 🟠 преземање · ⚫ тргнување/враќање · сина линија = изминат пат</div>
                </>
              ) : <p className="note">Сè уште нема GPS точки.</p>}
            </div>
          )}
        </>
      ) : <div className="card empty">Нема возила на пат. Кога возачот ќе притисне „🚚 Тргнав“ на телефонот, возилото се појавува тука.</div>}
      <p className="note">Позицијата ја праќа телефонот на возачот додека страницата „Мои патни налози“ е отворена (екранот останува вклучен) – на секои ~40 секунди или 150 м. Страницата се освежува сама. За следење и кога телефонот е заклучен, потребен е GPS уред во возилото.</p>
    </>
  );
}
