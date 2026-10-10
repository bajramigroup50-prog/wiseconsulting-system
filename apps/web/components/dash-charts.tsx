/**
 * Dashboard charts as SVG (legacy `spark` / `barChart` / `lineChart` / `hbars` 3767–3786; tooltips as `<title>`
 * instead of the legacy floating `data-tip`).
 */
import { MON, kfmt } from '@wise/core/firms/dash';
import { fmt } from '@/lib/fmt';

const nice4 = (mx: number) => { const p = Math.pow(10, Math.floor(Math.log10(mx))); return [1, 2, 2.5, 5, 10].map((x) => x * p).find((x) => x * 4 >= mx) ?? p * 10; };

export function Spark({ vals, hl, col = 'var(--c1)' }: { vals: number[]; hl?: [number, number] | null; col?: string }) {
  const W = 240, H = 30, n = vals.length;
  const mn = Math.min(0, ...vals), mx = Math.max(1, ...vals);
  const x = (i: number) => 2 + i * (W - 4) / (n - 1), y = (v: number) => H - 3 - (v - mn) / (mx - mn || 1) * (H - 8);
  const last = vals.reduce((a, v, i) => (v ? i : a), 0);
  const d = vals.slice(0, last + 1).map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1)).join('');
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {hl && <rect x={x(hl[0]) - 3} y={0} width={x(hl[1]) - x(hl[0]) + 6} height={H} fill="var(--soft)" />}
      <path d={d} fill="none" stroke={col} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(vals[last] ?? 0)} r={3} fill={col} stroke="var(--panel)" strokeWidth={2} />
    </svg>
  );
}

export function BarChart({ R, E, m0, m1, year }: { R: number[]; E: number[]; m0: number; m1: number; year: number }) {
  const W = 720, H = 240, L = 50, T = 18, B = 28, ph = H - T - B, cw = (W - L - 8) / 12, bw = Math.min(18, (cw - 10) / 2);
  const mx = Math.max(1, ...R, ...E), nice = nice4(mx), top = nice * 4;
  const y = (v: number) => T + ph - Math.max(0, v) / top * ph;
  const bar = (x: number, v: number, c: string) => {
    if (v <= 0) return null;
    const yy = y(v), hh = T + ph - yy, r = Math.min(4, hh);
    return <path d={`M${x},${T + ph} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${T + ph} Z`} fill={`var(${c})`} />;
  };
  const lm = Math.max(...R.map((v, i) => (v || E[i] ? i : -1)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Приходи и расходи по месеци ${year}`}>
      <rect x={L + m0 * cw} y={T - 6} width={(m1 - m0 + 1) * cw} height={ph + 6} fill="var(--accent-soft)" opacity={0.55} rx={4} />
      {[0, 1, 2, 3, 4].map((i) => { const v = nice * i, yy = y(v); return <g key={i}><line x1={L} x2={W - 4} y1={yy} y2={yy} stroke="var(--line)" /><text x={L - 6} y={yy + 4} textAnchor="end" fontSize={10.5} fill="var(--muted)">{kfmt(v)}</text></g>; })}
      {MON.map((mn, i) => {
        const x0 = L + i * cw + (cw - 2 * bw - 2) / 2, on = i >= m0 && i <= m1;
        return (
          <g key={i}>
            <g className="hit">
              <title>{`${mn} ${year}\nПриходи: ${fmt(R[i])}\nРасходи: ${fmt(E[i])}\nРезултат: ${fmt(R[i]! - E[i]!)}`}</title>
              <rect x={L + i * cw} y={T} width={cw} height={ph} fill="transparent" />
              {bar(x0, R[i]!, '--c1')}{bar(x0 + bw + 2, E[i]!, '--c2')}
            </g>
            <text x={L + i * cw + cw / 2} y={H - 9} textAnchor="middle" fontSize={11} fill={on ? 'var(--ink)' : 'var(--muted)'} fontWeight={on ? 600 : 400}>{mn}</text>
          </g>
        );
      })}
      {lm >= 0 && R[lm]! > 0 && <text x={L + lm * cw + (cw - 2 * bw - 2) / 2 + bw / 2} y={y(R[lm]!) - 5} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="var(--ink)">{kfmt(R[lm]!)}</text>}
      {lm >= 0 && E[lm]! > 0 && <text x={L + lm * cw + (cw - 2 * bw - 2) / 2 + bw * 1.5 + 2} y={y(E[lm]!) - 5} textAnchor="middle" fontSize={10.5} fill="var(--muted)">{kfmt(E[lm]!)}</text>}
      <line x1={L} x2={W - 4} y1={T + ph} y2={T + ph} stroke="var(--muted)" />
    </svg>
  );
}

export function LineChart({ V, lastM, year }: { V: number[]; lastM: number; year: number }) {
  const W = 720, H = 200, L = 50, T = 16, B = 28, ph = H - T - B, cw = (W - L - 16) / 11;
  const vv = V.slice(0, lastM + 1);
  const mn = Math.min(0, ...vv), mx = Math.max(1, ...vv), span = mx - mn;
  const p = Math.pow(10, Math.floor(Math.log10(span || 1)));
  const nice = [1, 2, 2.5, 5, 10].map((x) => x * p).find((x) => x * 4 >= span) ?? p * 10;
  const lo = Math.floor(mn / nice) * nice, hi = lo + nice * Math.max(4, Math.ceil((mx - lo) / nice));
  const x = (i: number) => L + i * cw, y = (v: number) => T + ph - (v - lo) / (hi - lo) * ph;
  const grid: number[] = []; for (let v = lo; v <= hi + 1e-6; v += nice) grid.push(v);
  const d = vv.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1)).join('');
  const area = vv.length ? d + `L${x(vv.length - 1)},${y(Math.max(lo, 0))}L${x(0)},${y(Math.max(lo, 0))}Z` : '';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Пари на сметка и благајна по месеци">
      {grid.map((v) => <g key={v}><line x1={L} x2={W - 8} y1={y(v)} y2={y(v)} stroke={Math.abs(v) < 1e-6 ? 'var(--muted)' : 'var(--line)'} /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={10.5} fill="var(--muted)">{kfmt(v)}</text></g>)}
      <path d={area} fill="var(--c1)" opacity={0.1} />
      <path d={d} fill="none" stroke="var(--c1)" strokeWidth={2} strokeLinejoin="round" />
      {MON.map((mn, i) => (
        <g key={i}>
          <g className="hit xh"><title>{`${mn} ${year}\nСостојба на крај на месец: ${i <= lastM ? fmt(V[i]) : '—'}`}</title>
            <rect x={x(i) - cw / 2} y={T} width={cw} height={ph} fill="transparent" />
            {i <= lastM && <circle cx={x(i)} cy={y(V[i]!)} r={3} fill="var(--c1)" stroke="var(--panel)" strokeWidth={2} />}
          </g>
          <text x={x(i)} y={H - 9} textAnchor="middle" fontSize={11} fill="var(--muted)">{mn}</text>
        </g>
      ))}
      {lastM >= 0 && <text x={x(lastM)} y={y(V[lastM]!) - 9} textAnchor={lastM > 9 ? 'end' : 'middle'} fontSize={10.5} fontWeight={600} fill="var(--ink)">{kfmt(V[lastM]!)}</text>}
    </svg>
  );
}

export interface HBar { n: string; v: number; x?: string; c?: string }

export function HBars({ rows, col = 'var(--c1)', unit = 'Износ' }: { rows: HBar[]; col?: string; unit?: string }) {
  if (!rows.length) return <div className="empty">Нема податоци за периодот.</div>;
  const mx = Math.max(1, ...rows.map((r) => Math.abs(r.v)));
  return (
    <ul className="hbars">
      {rows.map((r, i) => (
        <li key={i} tabIndex={0} title={`${r.n}\n${unit}: ${fmt(r.v)}${r.x ? '\n' + r.x : ''}`}>
          <span className="hb-n">{r.n}</span>
          <span className="hb-t"><i style={{ width: `${Math.max(1.5, Math.abs(r.v) / mx * 100)}%`, background: r.c ?? col }} /></span>
          <b className="num">{kfmt(r.v)}</b>
        </li>
      ))}
    </ul>
  );
}
