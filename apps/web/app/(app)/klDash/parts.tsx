/** klDash pieces (legacy `kdChart` / `kdRank` / `kdMonRows` 11575–11590, 14975). */
import Link from 'next/link';
import { MK_MON, kdBuckets } from '@wise/core/firms/dash';
import { dmy } from '@/lib/fmt';
import { kdMon, type KdData } from './data';

export const fi = (n: number) => Math.round(n).toLocaleString('mk-MK');

export function KdChart({ R, from, to, sel, href }: { R: KdData; from: string; to: string; sel: string | null; href: (k: string | null) => string }) {
  const { byMonth, keys } = kdBuckets(from, to);
  const B: Record<string, { i: number; o: number }> = {};
  for (const [d, v] of Object.entries(R.days)) { const k = byMonth ? d.slice(0, 7) : d; const o = (B[k] ??= { i: 0, o: 0 }); o.i += v.inv + v.kasa; o.o += v.pur; }
  const W = Math.max(900, keys.length * (byMonth ? 70 : 22)), H = 230, pad = 40;
  const mx = Math.max(1, ...keys.map((k) => Math.max(B[k]?.i ?? 0, B[k]?.o ?? 0)));
  const bw = (W - pad - 10) / keys.length;
  const y = (v: number) => H - 24 - (v / mx) * (H - 44);
  const lab = (k: string) => (byMonth ? ['јан', 'фев', 'мар', 'апр', 'мај', 'јун', 'јул', 'авг', 'сеп', 'окт', 'ное', 'дек'][+k.slice(5, 7) - 1] : k.slice(8, 10));
  return (
    <>
      <div className="tw" style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: Math.min(W, keys.length * 14 + 60), maxHeight: 300 }} preserveAspectRatio="none" role="img" aria-label="Приходи и набавки">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => { const v = mx * t; return <g key={t}><line x1={pad} x2={W} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} /><text x={pad - 6} y={y(v) + 4} textAnchor="end" fontSize={10} fill="var(--muted)">{v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'K' : Math.round(v)}</text></g>; })}
          {keys.map((k, i) => {
            const o = B[k] ?? { i: 0, o: 0 }, x = pad + i * bw, w = Math.max(2, bw / 2 - 2);
            return (
              <Link key={k} href={href(sel === k ? null : k)} scroll={false}>
                <g className="kd-bar"><title>{`${byMonth ? k : dmy(k)} · Приходи ${fi(o.i)} · Набавки ${fi(o.o)}`}</title>
                  <rect x={x} y={0} width={bw} height={H - 24} fill={sel === k ? 'color-mix(in srgb,var(--accent) 10%,transparent)' : 'transparent'} />
                  <rect x={x + 1} y={y(o.i)} width={w} height={Math.max(0, H - 24 - y(o.i))} rx={3} fill="var(--t1,#1a7f64)" />
                  <rect x={x + w + 2} y={y(o.o)} width={w} height={Math.max(0, H - 24 - y(o.o))} rx={3} fill="var(--t2,#c46a2a)" />
                  {(byMonth || keys.length <= 31 || i % 2 === 0) && <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--muted)">{lab(k)}</text>}
                </g>
              </Link>
            );
          })}
        </svg>
      </div>
      <div className="row" style={{ gap: 14, marginTop: 4 }}>
        <span className="mini"><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--t1,#1a7f64)' }} /> Приходи (фактури + каса)</span>
        <span className="mini"><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--t2,#c46a2a)' }} /> Набавки (влезни фактури)</span>
        <span className="mini">{byMonth ? 'по месеци' : 'по денови'} · кликнете на столб за детали</span>
      </div>
    </>
  );
}

export function KdRank({ obj, lab }: { obj: Record<string, number | { n: string; v: number; q: number; u: string }>; lab: string }) {
  const L = Object.entries(obj).map(([k, v]) => (typeof v === 'object' ? { n: v.n, v: v.v, q: v.q, u: v.u } : { n: k, v, q: 0, u: '' }))
    .filter((x) => Math.abs(x.v) >= 0.5).sort((a, b) => b.v - a.v).slice(0, 8);
  const mx = Math.max(1, ...L.map((x) => x.v));
  if (!L.length) return <p className="note" style={{ margin: 0 }}>Нема {lab} во периодот.</p>;
  return (
    <table className="dense kd-rank"><tbody>
      {L.map((x, i) => (
        <tr key={i}><td>{i + 1}</td><td>{x.n}{x.q ? <span className="mini"> {fi(x.q)} {x.u}</span> : null}<div className="kd-meter"><i style={{ width: `${Math.round(x.v / mx * 100)}%` }} /></div></td><td className="n">{fi(x.v)}</td></tr>
      ))}
    </tbody></table>
  );
}

export function KdMonTable({ R }: { R: KdData }) {
  const L = kdMon(R);
  const t = L.reduce((a, [, o]) => ({ s: a.s + o.s, p: a.p + o.p, e: a.e + o.e }), { s: 0, p: 0, e: 0 });
  return (
    <table className="dense">
      <thead><tr><th>Месец</th><th className="n">Приходи</th><th className="n">Набавки</th><th className="n">Трошоци (кл. 4)</th><th className="n">Приходи − набавки</th></tr></thead>
      <tbody>{L.map(([k, o]) => <tr key={k}><td>{MK_MON[+k.slice(5) - 1]} {k.slice(0, 4)}</td><td className="n">{fi(o.s)}</td><td className="n">{fi(o.p)}</td><td className="n">{fi(o.e)}</td><td className="n" style={{ color: o.s - o.p >= 0 ? 'var(--good,#067647)' : 'var(--bad,#b42318)' }}>{fi(o.s - o.p)}</td></tr>)}</tbody>
      <tfoot><tr><th>Вкупно</th><th className="n">{fi(t.s)}</th><th className="n">{fi(t.p)}</th><th className="n">{fi(t.e)}</th><th className="n">{fi(t.s - t.p)}</th></tr></tfoot>
    </table>
  );
}
