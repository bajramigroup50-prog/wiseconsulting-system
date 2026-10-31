'use client';
/** The list of „📊 Извештаи“: search (name / description / group), ⭐ favourites on top (this browser), the common period. */
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { reportHref, type ReportEntry } from '@/lib/reports-registry';

const FAV = 'wise.reports.fav';
const keyOf = (r: ReportEntry) => r.href ?? '/' + r.view;

export function ReportsHub({ groups, year }: { groups: [string, ReportEntry[]][]; year: number }) {
  const [q, setQ] = useState('');
  const [fav, setFav] = useState<string[]>([]);
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  useEffect(() => { try { setFav(JSON.parse(localStorage.getItem(FAV) ?? '[]') as string[]); } catch { /* no storage */ } }, []);
  const toggle = (k: string) => setFav((F) => {
    const n = F.includes(k) ? F.filter((x) => x !== k) : [...F, k];
    try { localStorage.setItem(FAV, JSON.stringify(n)); } catch { /* no storage */ }
    return n;
  });
  const t = q.trim().toLowerCase();
  const hit = (r: ReportEntry, g: string) => !t || `${r.label} ${r.desc} ${g}`.toLowerCase().includes(t);
  const all = useMemo(() => groups.flatMap(([g, L]) => L.map((r) => ({ ...r, g }))), [groups]);
  const favs = all.filter((r) => fav.includes(keyOf(r)) && hit(r, r.g));
  const card = (r: ReportEntry, g: string) => {
    const k = keyOf(r), on = fav.includes(k);
    return (
      <div key={g + k} className="rp-card">
        <Link href={reportHref(r, from, to)}><b>{r.label}</b>{r.isNew && <span className="pill good" style={{ marginLeft: 6 }}>ново</span>}<small>{r.desc}</small>{r.p && <i className="mini mut">со периодот {from.split('-').reverse().join('.')} – {to.split('-').reverse().join('.')}</i>}</Link>
        <button type="button" className="btn sm ghost" aria-pressed={on} title={on ? 'Тргни од омилени' : 'Додај во омилени'} onClick={() => toggle(k)}>{on ? '⭐' : '☆'}</button>
      </div>
    );
  };
  return (
    <div className="rp-hub">
      <div className="card row" style={{ gap: '8px 14px', alignItems: 'end', flexWrap: 'wrap' }}>
        <label className="f" style={{ flex: '1 1 280px' }}>Барај извештај<input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="на пр. лагер, ДДВ, картица, плата…" /></label>
        <label className="f">Период од<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="f">до<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <span className="mini mut">Периодот важи за извештаите што имаат „од – до“.</span>
      </div>
      {favs.length > 0 && (
        <section className="card"><h2>⭐ Омилени</h2><div className="rp-grid">{favs.map((r) => card(r, '★'))}</div></section>
      )}
      {groups.map(([g, L]) => {
        const S = L.filter((r) => hit(r, g));
        return S.length ? <section key={g} className="card"><h2>{g}</h2><div className="rp-grid">{S.map((r) => card(r, g))}</div></section> : null;
      })}
      {t && !all.some((r) => hit(r, r.g)) && <div className="card empty">Нема извештај за „{q}“.</div>}
    </div>
  );
}
