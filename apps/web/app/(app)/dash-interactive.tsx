'use client';
/**
 * The interactive part of the dashboard, one card with four tabs (the hero cells open them through the hash
 * #det-rev / #det-exp / #det-res / #cash):
 *  📊 Детали – months as bars, the top customers / suppliers / expense groups, each opening its card;
 *  ✅ Денес – today's work: deadlines, checks, the autopilot; ticked as done (kept in this browser for the day);
 *  🧮 Што ако – more sales / more costs → profit, VAT and profit tax, and the year projected to December;
 *  💧 Пари – the bank + cash balance day by day (last 60 days) and the next 30 days from the open invoices by due date.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

export interface DashTop { id: string | null; n: string; v: number }
export interface DashTask { key: string; t: string; sub?: string; go: string; lvl: 'bad' | 'warn' | 'info' }
export interface DashData {
  firmId: string; year: number; today: string; label: string; m0: number; m1: number; lastM: number;
  R: number[]; E: number[]; rev: number; exp: number;
  topC: DashTop[]; topS: DashTop[]; expG: { n: string; v: number }[];
  tasks: DashTask[];
  cash: { past: { d: string; v: number }[]; now: number; ins: { d: string; v: number }[]; outs: { d: string; v: number }[]; overduePay: number; overdueRecv: number };
  vatRate: number;
}

const MN = ['јан', 'фев', 'мар', 'апр', 'мај', 'јун', 'јул', 'авг', 'сеп', 'окт', 'ное', 'дек'];
const nf = (v: number) => (Math.round(v * 100) / 100).toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = (v: number) => Math.round(v).toLocaleString('mk-MK');
const ddmm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
const addDays = (d: string, k: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };

type Tab = 'det' | 'today' | 'what' | 'cash';
type Det = 'rev' | 'exp' | 'res';

function Bars({ V, m0, m1, col, neg }: { V: number[]; m0: number; m1: number; col: string; neg?: boolean }) {
  const mx = Math.max(1, ...V.map((v) => Math.abs(v)));
  return (
    <div style={{ display: 'flex', alignItems: neg ? 'center' : 'flex-end', gap: 6, height: 150, padding: '6px 0' }}>
      {V.map((v, i) => {
        const h = Math.round(Math.abs(v) / mx * (neg ? 64 : 128));
        const on = i >= m0 && i <= m1;
        return (
          <div key={i} title={`${MN[i]}: ${nf(v)}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: neg ? 'center' : 'flex-end', height: '100%' }}>
            {neg ? <div style={{ height: 130, display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%' }}>
              <div style={{ height: 64, display: 'flex', alignItems: 'flex-end' }}>{v > 0 && <div style={{ width: '100%', height: h, background: 'var(--good)', opacity: on ? 1 : 0.35, borderRadius: '3px 3px 0 0' }} />}</div>
              <div style={{ height: 64 }}>{v < 0 && <div style={{ width: '100%', height: h, background: 'var(--bad)', opacity: on ? 1 : 0.35, borderRadius: '0 0 3px 3px' }} />}</div>
            </div> : <div style={{ width: '100%', height: h, background: col, opacity: on ? 1 : 0.35, borderRadius: '3px 3px 0 0' }} />}
            <small className="mini" style={{ marginTop: 2 }}>{MN[i]}</small>
          </div>
        );
      })}
    </div>
  );
}

function Top({ rows, href, unit }: { rows: { id?: string | null; n: string; v: number }[]; href?: (id: string) => string; unit: string }) {
  if (!rows.length) return <div className="empty">Нема податоци.</div>;
  const mx = Math.max(1, ...rows.map((r) => r.v)), tot = rows.reduce((s, r) => s + r.v, 0);
  return (
    <table className="dense"><thead><tr><th>#</th><th>Назив</th><th className="n">{unit}</th><th className="n">%</th></tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={r.n + i}>
          <td>{i + 1}</td>
          <td style={{ minWidth: 200 }}>{r.id && href ? <Link href={href(r.id)}>{r.n}</Link> : r.n}
            <div style={{ height: 4, background: 'var(--accent-soft)', borderRadius: 2, marginTop: 2 }}><div style={{ width: `${r.v / mx * 100}%`, height: 4, background: 'var(--accent)', borderRadius: 2 }} /></div></td>
          <td className="n">{nf(r.v)}</td><td className="n">{tot ? Math.round(r.v / tot * 1000) / 10 : 0}</td>
        </tr>
      ))}</tbody></table>
  );
}

function CashChart({ pts, today }: { pts: { d: string; v: number; f?: boolean }[]; today: string }) {
  if (pts.length < 2) return <div className="empty">Нема движења на парите.</div>;
  const W = 900, H = 220, P = 34;
  const vs = pts.map((p) => p.v), lo = Math.min(0, ...vs), hi = Math.max(1, ...vs);
  const x = (i: number) => P + (i / (pts.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P);
  const ti = pts.findIndex((p) => p.d === today);
  const line = (L: { i: number; v: number }[]) => L.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const past = pts.map((p, i) => ({ i, v: p.v })).filter((_, i) => ti < 0 || i <= ti);
  const fut = pts.map((p, i) => ({ i, v: p.v })).filter((_, i) => ti >= 0 && i >= ti);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Пари по денови">
      {lo < 0 && <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke="var(--bad)" strokeDasharray="4 4" />}
      <path d={line(past)} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
      {fut.length > 1 && <path d={line(fut)} fill="none" stroke="var(--c2, #e08a00)" strokeWidth={2.5} strokeDasharray="6 4" />}
      {ti >= 0 && <><line x1={x(ti)} x2={x(ti)} y1={P - 10} y2={H - P} stroke="var(--muted)" strokeDasharray="2 3" /><text x={x(ti) + 4} y={P - 2} fontSize={11} fill="var(--muted)">денес</text></>}
      <text x={4} y={y(hi) + 4} fontSize={11} fill="var(--muted)">{n0(hi)}</text>
      <text x={4} y={y(lo) + 4} fontSize={11} fill="var(--muted)">{n0(lo)}</text>
      {[0, Math.floor((pts.length - 1) / 2), pts.length - 1].map((i) => <text key={i} x={x(i)} y={H - 10} fontSize={11} fill="var(--muted)" textAnchor="middle">{ddmm(pts[i]!.d)}</text>)}
    </svg>
  );
}

export function DashInteractive({ D }: { D: DashData }) {
  const [tab, setTab] = useState<Tab>('det');
  const [det, setDet] = useState<Det>('rev');
  // the hero cells link to #det-rev / #det-exp / #det-res / #cash
  useEffect(() => {
    const go = () => {
      const h = window.location.hash.slice(1);
      if (h.startsWith('det-')) { setTab('det'); setDet(h.slice(4) as Det); } else if (h === 'cash' || h === 'today' || h === 'what') setTab(h as Tab); else return;
      document.getElementById('dashx')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, []);

  // ✅ today: done marks for this firm and day, kept in this browser
  const dkey = `wise.done.${D.firmId}.${D.today}`;
  const [done, setDone] = useState<Record<string, boolean>>({});
  useEffect(() => { try { setDone(JSON.parse(localStorage.getItem(dkey) || '{}')); } catch { /* private mode */ } }, [dkey]);
  const tick = (k: string) => setDone((o) => { const n = { ...o, [k]: !o[k] }; try { localStorage.setItem(dkey, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  const open = D.tasks.filter((t) => !done[t.key]).length;

  // 🧮 what if
  const [addRev, setAddRev] = useState(0);
  const [addExp, setAddExp] = useState(0);
  const [proj, setProj] = useState(true);
  const W = useMemo(() => {
    const k = Math.max(1, D.lastM + 1);
    const f = proj ? 12 / k : 1;
    const rev = D.rev * f + addRev, exp = D.exp * f + addExp;
    const res = rev - exp;
    return { rev, exp, res, tax: Math.max(0, res * 0.1), vat: (addRev - addExp) * D.vatRate, margin: rev ? res / rev * 100 : 0 };
  }, [D, addRev, addExp, proj]);

  // 💧 cash: past days + the next 30 days from the open documents
  const C = useMemo(() => {
    const pts: { d: string; v: number; f?: boolean }[] = D.cash.past.map((p) => ({ d: p.d, v: p.v }));
    let v = D.cash.now - D.cash.overduePay;
    let min = { d: D.today, v };
    const by = new Map<string, number>();
    for (const x of D.cash.ins) by.set(x.d, (by.get(x.d) ?? 0) + x.v);
    for (const x of D.cash.outs) by.set(x.d, (by.get(x.d) ?? 0) - x.v);
    for (let k = 1; k <= 30; k++) {
      const d = addDays(D.today, k);
      v += by.get(d) ?? 0;
      pts.push({ d, v, f: true });
      if (v < min.v) min = { d, v };
    }
    const in30 = D.cash.ins.reduce((s, x) => s + x.v, 0), out30 = D.cash.outs.reduce((s, x) => s + x.v, 0);
    return { pts, min, end: v, in30, out30 };
  }, [D]);

  const tabs: [Tab, string][] = [['det', '📊 Детали'], ['today', `✅ Денес${open ? ` (${open})` : ''}`], ['what', '🧮 Што ако'], ['cash', '💧 Пари – 30 дена']];
  const ak = (k: string) => (id: string) => `/akart?k=${k}&pid=${id}`;
  return (
    <div className="card" id="dashx" style={{ scrollMarginTop: 70 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {tabs.map(([k, t]) => <button key={k} type="button" className={`btn ${tab === k ? 'pri' : ''}`} onClick={() => setTab(k)}>{t}</button>)}
      </div>

      {tab === 'det' && <>
        <div className="row" style={{ gap: 6, marginBottom: 6 }}>
          {([['rev', 'Приходи'], ['exp', 'Расходи'], ['res', 'Добивка']] as const).map(([k, t]) => <button key={k} type="button" className={`chip ${det === k ? 'on' : ''}`} onClick={() => setDet(k)}>{t}</button>)}
          <span className="mini" style={{ marginLeft: 'auto' }}>{D.label} · {D.year} · кликнете на назив за картицата</span>
        </div>
        {det === 'rev' && <><h3 style={{ margin: '4px 0' }}>Приходи по месеци · {nf(D.R.reduce((a, b) => a + b, 0))}</h3><Bars V={D.R} m0={D.m0} m1={D.m1} col="var(--c1)" />
          <h3 style={{ margin: '10px 0 4px' }}>Најголеми купувачи</h3><div className="tw"><Top rows={D.topC} href={ak('1200')} unit="Промет без ДДВ" /></div></>}
        {det === 'exp' && <><h3 style={{ margin: '4px 0' }}>Расходи по месеци · {nf(D.E.reduce((a, b) => a + b, 0))}</h3><Bars V={D.E} m0={D.m0} m1={D.m1} col="var(--c2)" />
          <div className="cols" style={{ marginTop: 10 }}>
            <div><h3 style={{ margin: '0 0 4px' }}>Структура на расходите</h3><div className="tw"><Top rows={D.expG} unit="Расход" /></div></div>
            <div><h3 style={{ margin: '0 0 4px' }}>Најголеми добавувачи</h3><div className="tw"><Top rows={D.topS} href={ak('2200')} unit="Набавки без ДДВ" /></div></div>
          </div></>}
        {det === 'res' && <><h3 style={{ margin: '4px 0' }}>Добивка по месеци (приходи − расходи)</h3><Bars V={D.R.map((v, i) => v - D.E[i]!)} m0={D.m0} m1={D.m1} col="var(--accent)" neg />
          <table className="dense" style={{ width: 'auto' }}><tbody>
            <tr><td>Приходи · {D.label}</td><td className="n">{nf(D.rev)}</td></tr><tr><td>Расходи · {D.label}</td><td className="n">{nf(D.exp)}</td></tr>
            <tr><td><b>Добивка</b></td><td className="n"><b>{nf(D.rev - D.exp)}</b></td></tr>
            <tr><td>Маржа</td><td className="n">{D.rev ? (Math.round((D.rev - D.exp) / D.rev * 1000) / 10).toLocaleString('mk-MK') + '%' : '—'}</td></tr>
          </tbody></table></>}
      </>}

      {tab === 'today' && <>
        <p className="mini" style={{ margin: '0 0 6px' }}>Работите за денес – кликнете за да ја отворите, ✓ кога е готова (се памети за денес во овој прелистувач).</p>
        {D.tasks.length ? <ul className="todo">{D.tasks.map((x) => (
          <li key={x.key} style={{ display: 'flex', gap: 8, alignItems: 'center', opacity: done[x.key] ? 0.45 : 1 }}>
            <input type="checkbox" checked={!!done[x.key]} onChange={() => tick(x.key)} aria-label="Готово" />
            <Link className="lnk" href={`/${x.go}`} style={{ flex: 1, textDecoration: done[x.key] ? 'line-through' : undefined }}><span><b>{x.t}</b>{x.sub && <em>{x.sub}</em>}</span>
              <span className={`pill ${x.lvl}`}>{x.lvl === 'bad' ? 'итно' : x.lvl === 'warn' ? 'за правење' : 'инфо'}</span></Link>
          </li>
        ))}</ul> : <div className="callout good">✓ Нема ништо за денес.</div>}
      </>}

      {tab === 'what' && <>
        <p className="mini" style={{ margin: '0 0 8px' }}>Поместете ги лизгачите: колку повеќе продажба / трошоци → што се случува со добивката, ДДВ и данокот на добивка.</p>
        <div className="row" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="f" style={{ minWidth: 260 }}>+ Продажба (без ДДВ): <b>{n0(addRev)}</b>
            <input type="range" min={0} max={Math.max(100000, Math.round(D.rev / 2 / 10000) * 10000)} step={10000} value={addRev} onChange={(e) => setAddRev(+e.target.value)} /></label>
          <label className="f" style={{ minWidth: 260 }}>+ Трошоци (без ДДВ): <b>{n0(addExp)}</b>
            <input type="range" min={0} max={Math.max(100000, Math.round(D.exp / 2 / 10000) * 10000)} step={10000} value={addExp} onChange={(e) => setAddExp(+e.target.value)} /></label>
          <label className="chk"><input type="checkbox" checked={proj} onChange={(e) => setProj(e.target.checked)} /> проекција до крајот на {D.year} (според досегашните {D.lastM + 1} месеци)</label>
          <button type="button" className="btn sm" onClick={() => { setAddRev(0); setAddExp(0); }}>↺ Нула</button>
        </div>
        <div className="tiles kpi k4" style={{ marginTop: 10 }}>
          {([['Приходи', W.rev], ['Расходи', W.exp], ['Добивка', W.res], ['Данок на добивка 10%', W.tax]] as [string, number][]).map(([t, v]) => (
            <div key={t} className="tile kt"><div className="kh"><span>{t}{proj ? ' · проекција ' + D.year : ''}</span></div><b className="num" style={{ color: t === 'Добивка' ? (v >= 0 ? 'var(--good)' : 'var(--bad)') : undefined }}>{nf(v)}</b>
              <i>{t === 'Добивка' ? 'маржа ' + (Math.round(W.margin * 10) / 10).toLocaleString('mk-MK') + '%' : ''}</i></div>
          ))}
        </div>
        <p className="note">ДДВ од промената: {W.vat >= 0 ? 'повеќе за плаќање' : 'помалку за плаќање'} <b>{nf(Math.abs(W.vat))}</b> (по стапка {D.vatRate * 100}% на разликата продажба − трошоци). Проценка – не е книжење.</p>
      </>}

      {tab === 'cash' && <>
        <p className="mini" style={{ margin: '0 0 6px' }}>Полна линија: пари на банки + благајна по денови. Испрекината: следните 30 дена – наплати од фактурите и плаќања на добавувачите според рокот{D.cash.overduePay ? `; задоцнетите обврски (${n0(D.cash.overduePay)}) се одземени веднаш` : ''}.</p>
        <CashChart pts={C.pts} today={D.today} />
        <div className="tiles kpi k4" style={{ marginTop: 8 }}>
          <div className="tile kt"><div className="kh"><span>Денес</span></div><b className="num">{nf(D.cash.now)}</b><i>банки + благајна</i></div>
          <div className="tile kt"><div className="kh"><span>Ќе влезе (30 дена)</span></div><b className="num" style={{ color: 'var(--good)' }}>{nf(C.in30)}</b><i>{D.cash.overdueRecv ? `+ задоцнети ${n0(D.cash.overdueRecv)} (не се сметани)` : 'по рок на фактурите'}</i></div>
          <div className="tile kt"><div className="kh"><span>Ќе излезе (30 дена)</span></div><b className="num" style={{ color: 'var(--bad)' }}>{nf(C.out30 + D.cash.overduePay)}</b><i>добавувачи по рок</i></div>
          <div className="tile kt"><div className="kh"><span>Најниско · {ddmm(C.min.d)}</span></div><b className="num" style={{ color: C.min.v < 0 ? 'var(--bad)' : undefined }}>{nf(C.min.v)}</b><i>{C.min.v < 0 ? '⚠ парите не се доволни – наплатете или одложете' : `за 30 дена: ${n0(C.end)}`}</i></div>
        </div>
      </>}
    </div>
  );
}
