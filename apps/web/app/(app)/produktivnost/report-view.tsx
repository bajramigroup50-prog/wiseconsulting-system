/**
 * The productivity report body — the screen and the print view (PDF) render the same tables; `print` drops the links.
 * Server component (no client code): CSS bars and an inline SVG chart.
 */
import Link from 'next/link';
import { ROLES } from '@wise/core';
import { WORK_CATS, WORK_CAT_LBL, catTotal, daysOf, firmCount, fmtMinutes, type UserWork } from '@wise/core/office/productivity';
import { fmt } from '@/lib/fmt';
import { firmName, userName, type ProdData, type ProdFilter } from './data';

const PALETTE = ['#0f5a46', '#1d4ed8', '#b45309', '#7c3aed', '#be123c', '#0e7490', '#4d7c0f', '#a16207', '#475569', '#c2410c'];
export const userColor = (i: number) => PALETTE[i % PALETTE.length]!;
const n0 = (n: number) => n.toLocaleString('mk-MK');
const den = (cents: number) => fmt(cents / 100);

/** Drill-down into the raw log (Дневник на активности) for a user / firm / day range. */
export function logHref(f: ProdFilter, o: { user?: string | null; firm?: string | null; from?: string; to?: string }): string {
  const q = new URLSearchParams({ od: o.from ?? f.from, do: o.to ?? f.to });
  const u = o.user === undefined ? f.user : o.user === null ? '-' : o.user;
  if (u) q.set('u', u);
  const fi = o.firm === undefined ? f.firm : o.firm;
  if (fi) q.set('f', fi);
  return `/aktivnost?${q}`;
}

function Bar({ v, max, color }: { v: number; max: number; color: string }) {
  return (
    <div style={{ height: 8, background: 'var(--line,#e5e7eb)', borderRadius: 4, minWidth: 80 }}>
      <div style={{ height: 8, width: `${max ? Math.max(v ? 2 : 0, (v / max) * 100) : 0}%`, background: color, borderRadius: 4 }} />
    </div>
  );
}

/** Per-day (≤ 62 days) or per-month stacked bars, one colour per user. */
function DayChart({ D, f, W }: { D: ProdData; f: ProdFilter; W: UserWork[] }) {
  const days = daysOf(f.from, f.to);
  const monthly = days.length > 62;
  const keys = monthly ? [...new Set(days.map((d) => d.slice(0, 7)))] : days;
  const val = (w: UserWork, k: string) => (monthly ? Object.entries(w.days).filter(([d]) => d.startsWith(k)).reduce((a, [, n]) => a + n, 0) : w.days[k] ?? 0);
  const tot = keys.map((k) => W.reduce((a, w) => a + val(w, k), 0));
  const max = Math.max(1, ...tot);
  const bw = Math.max(8, Math.min(36, Math.floor(900 / Math.max(1, keys.length))));
  const H = 150, top = 14, base = top + H, width = keys.length * bw + 40;
  const every = Math.ceil(keys.length / 16);
  const lbl = (k: string) => (monthly ? `${k.slice(5, 7)}.${k.slice(2, 4)}` : `${k.slice(8, 10)}.${k.slice(5, 7)}`);
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${width} ${base + 24}`} style={{ width: '100%', minWidth: Math.min(width, 600), maxHeight: 240 }} role="img" aria-label="Движења по ден">
        <line x1={30} x2={width} y1={base} y2={base} stroke="#94a3b8" strokeWidth={1} />
        <text x={0} y={top + 4} fontSize={10} fill="#64748b">{max}</text>
        <text x={0} y={base} fontSize={10} fill="#64748b">0</text>
        {keys.map((k, i) => {
          let y = base;
          const x = 34 + i * bw;
          return (
            <g key={k}>
              <title>{`${monthly ? k : lbl(k)}: ${tot[i]} движења`}</title>
              {W.map((w, j) => {
                const v = val(w, k);
                if (!v) return null;
                const h = (v / max) * H;
                y -= h;
                return <rect key={j} x={x} y={y} width={bw - 2} height={h} fill={userColor(j)}><title>{`${userName(D, w.userId)} · ${monthly ? k : lbl(k)}: ${v}`}</title></rect>;
              })}
              {i % every === 0 && <text x={x + (bw - 2) / 2} y={base + 14} fontSize={9} textAnchor="middle" fill="#475569">{lbl(k)}</text>}
            </g>
          );
        })}
      </svg>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
        {W.map((w, j) => <span key={w.userId ?? '-'}><i style={{ display: 'inline-block', width: 10, height: 10, background: userColor(j), marginRight: 4, borderRadius: 2 }} />{userName(D, w.userId)}</span>)}
      </div>
    </div>
  );
}

export function ReportView({ D, f, print = false }: { D: ProdData; f: ProdFilter; print?: boolean }) {
  const W = D.report.users.filter((w) => w.total > 0);
  const quiet = D.report.users.filter((w) => w.total === 0);
  const maxT = Math.max(1, ...W.map((w) => w.total));
  const maxH = Math.max(1, ...W.map((w) => w.perHour ?? 0));
  const cats = WORK_CATS.filter(([c]) => W.some((w) => catTotal(w, c)));
  const L = (href: string, children: React.ReactNode) => (print ? <>{children}</> : <Link href={href}>{children}</Link>);
  const sumMin = W.reduce((a, w) => a + w.activeMin, 0);
  const firmsAll = new Set(W.flatMap((w) => w.firms.map((x) => x.firmId).filter(Boolean))).size;
  const Kpi = ({ l, v, s }: { l: string; v: string; s?: string }) => (
    <div className="card" style={{ flex: 1, minWidth: 150, margin: 0 }}><div className="muted" style={{ fontSize: 12 }}>{l}</div><div style={{ fontSize: 22, fontWeight: 700 }}>{v}</div>{s && <div className="mini">{s}</div>}</div>
  );
  if (!W.length) return <div className="card empty">Нема евидентирана работа за избраниот период и филтер.</div>;
  return (
    <>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', margin: '10px 0', alignItems: 'stretch' }}>
        <Kpi l="Вкупно движења" v={n0(D.report.total)} s={`${W.length} ${W.length === 1 ? 'корисник' : 'корисници'}`} />
        <Kpi l="Фирми на кои се работело" v={n0(firmsAll)} />
        <Kpi l="Проценето активно време" v={fmtMinutes(sumMin)} s="збир на сите корисници" />
        <Kpi l="Ставки во налози" v={n0(W.reduce((a, w) => a + w.vol.jLines, 0))} s={`изводи: ${n0(W.reduce((a, w) => a + w.vol.bankImported, 0))} увезени · ${n0(W.reduce((a, w) => a + w.vol.bankBooked, 0))} прокнижени`} />
      </div>

      <h2 style={{ fontSize: 16, margin: '14px 0 6px' }}>Преглед по корисник</h2>
      <div className="tw"><table className="dense">
        <thead><tr>
          <th>Корисник</th><th className="n">Вкупно движења</th><th className="n">Креирано</th><th className="n">Изменето</th><th className="n">Избришано</th>
          <th className="n">Фирми</th><th className="n">Активни денови</th><th className="n">Активно време</th><th className="n">Движења / час</th>
          <th className="n">Ставки во налози</th><th className="n">Изводи (увез. / прокн.)</th><th className="n">Излезни фактури</th><th className="n">Влезни фактури</th>
        </tr></thead>
        <tbody>{W.map((w, j) => {
          const u = w.userId ? D.users.get(w.userId) : null;
          return (
            <tr key={w.userId ?? '-'}>
              <td style={{ minWidth: 160 }}><i style={{ display: 'inline-block', width: 10, height: 10, background: userColor(j), marginRight: 6, borderRadius: 2 }} />
                {L(logHref(f, { user: w.userId }), userName(D, w.userId))}{u && <div className="mini">{ROLES[u.role]?.n ?? u.role}{u.active ? '' : ' · неактивен'}</div>}</td>
              <td className="n"><b>{n0(w.total)}</b><Bar v={w.total} max={maxT} color={userColor(j)} /></td>
              <td className="n">{n0(w.verbs.c)}</td><td className="n">{n0(w.verbs.u)}</td><td className="n">{n0(w.verbs.d)}</td>
              <td className="n">{firmCount(w)}</td><td className="n">{w.activeDays}</td><td className="n">{fmtMinutes(w.activeMin)}</td>
              <td className="n">{w.perHour ?? '—'}<Bar v={w.perHour ?? 0} max={maxH} color="#94a3b8" /></td>
              <td className="n">{n0(w.vol.jLines)}{w.vol.journals ? <div className="mini">{w.vol.journals} рачни налози</div> : null}</td>
              <td className="n">{n0(w.vol.bankImported)} / {n0(w.vol.bankBooked)}</td>
              <td className="n">{w.vol.inv ? <>{w.vol.inv}<div className="mini">{den(w.vol.invCents)} ден</div></> : ''}</td>
              <td className="n">{w.vol.pur ? <>{w.vol.pur}<div className="mini">{den(w.vol.purCents)} ден</div></> : ''}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      {quiet.length > 0 && <p className="note">Без движења во периодот (само најави / поставки): {quiet.map((w) => userName(D, w.userId)).join(', ')}.</p>}

      <h2 style={{ fontSize: 16, margin: '14px 0 6px' }}>Споредба по вид на работа</h2>
      <div className="tw"><table className="dense">
        <thead><tr><th>Вид на работа</th>{W.map((w, j) => <th key={w.userId ?? '-'} className="n" style={{ color: userColor(j) }}>{userName(D, w.userId)}</th>)}<th className="n">Вкупно</th></tr></thead>
        <tbody>{cats.map(([c, l]) => {
          const row = W.map((w) => catTotal(w, c));
          const mx = Math.max(...row);
          return (
            <tr key={c}><td>{l}</td>
              {W.map((w, j) => { const v = w.byCat[c]; const t = row[j]!; return (
                <td key={w.userId ?? '-'} className="n" title={v ? `креирано ${v.c} · изменето ${v.u} · избришано ${v.d}` : ''} style={t && t === mx && W.length > 1 ? { fontWeight: 700 } : undefined}>
                  {t ? n0(t) : ''}{v && t ? <div className="mini">{v.c}/{v.u}/{v.d}</div> : null}
                </td>); })}
              <td className="n"><b>{n0(row.reduce((a, b) => a + b, 0))}</b></td></tr>
          );
        })}</tbody>
      </table></div>
      <p className="note" style={{ marginTop: 4 }}>Во ќелиите: вкупно, а под него креирано / изменето / избришано. Задебелено = најмногу во тој вид на работа.</p>

      <h2 style={{ fontSize: 16, margin: '14px 0 6px' }}>Движења по {daysOf(f.from, f.to).length > 62 ? 'месец' : 'ден'}</h2>
      <div className="card" style={{ margin: 0 }}><DayChart D={D} f={f} W={W} /></div>

      <h2 style={{ fontSize: 16, margin: '14px 0 6px' }}>По фирми</h2>
      {W.map((w, j) => (
        <details key={w.userId ?? '-'} className="card" style={{ margin: '0 0 8px' }} open={print || W.length === 1}>
          <summary style={{ cursor: 'pointer' }}><b style={{ color: userColor(j) }}>{userName(D, w.userId)}</b> — {n0(w.total)} движења на {firmCount(w)} фирми</summary>
          <div className="tw" style={{ marginTop: 6 }}><table className="dense">
            <thead><tr><th>Фирма</th><th className="n">Движења</th><th>Најмногу</th></tr></thead>
            <tbody>{w.firms.map((x) => (
              <tr key={x.firmId ?? '-'}>
                <td>{L(logHref(f, { user: w.userId, firm: x.firmId ?? '' }), firmName(D, x.firmId))}</td>
                <td className="n"><b>{n0(x.total)}</b></td>
                <td className="mini">{Object.entries(x.byCat).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => `${WORK_CAT_LBL[c as keyof typeof WORK_CAT_LBL]} ${n}`).join(' · ')}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </details>
      ))}

      {Object.keys(D.report.unknown).length > 0 && (
        <p className="note">Акции кои уште не се во табелата на видови работа (распоредени по видот на записот или во „Друго“):{' '}
          {Object.entries(D.report.unknown).sort((a, b) => b[1] - a[1]).map(([a, n]) => `${a} (${n})`).join(', ')}.</p>
      )}
    </>
  );
}
