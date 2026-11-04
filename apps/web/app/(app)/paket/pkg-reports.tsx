'use client';
/**
 * The generated reports of a saved package, picked with ☑ and added in one click: the period (од – до) and the kontos
 * of the analytic cards are set here, every ticked report is rendered from its print view to a server PDF in a hidden
 * frame (`captureUrl`) and appended to the package (`/api/pdf` `pkg`), one after another – no tab per report.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { captureUrl, requestPdf, waitForFile } from '@/lib/pdf-capture';

const dmy = (d: string) => d.split('-').reverse().join('.');

export function PkgReports({ pkg, reports, picked, from: f0, to: t0, ks: k0, note }: {
  pkg: string;
  /** [key, print URL (no period), label] */
  reports: readonly (readonly [string, string, string])[];
  picked: readonly string[];
  from: string; to: string; ks: string; note: string;
}) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(picked));
  const [from, setFrom] = useState(f0), [to, setTo] = useState(t0), [ks, setKs] = useState(k0);
  const [busy, setBusy] = useState(false);
  const [st, setSt] = useState('');
  const router = useRouter();
  const bad = !from || !to || from > to;
  const urlOf = (k: string, href: string) => `${href}${href.includes('?') ? '&' : '?'}from=${from}&to=${to}${k === 'kart' ? `&ks=${encodeURIComponent(ks.trim().split(/[\s,;]+/).join(','))}` : ''}`;
  const flip = (k: string) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const run = async () => {
    const J = reports.filter(([k]) => sel.has(k));
    if (!J.length || bad) return;
    setBusy(true);
    const ids: string[] = [], err: string[] = [];
    try {
      for (const [k, href, label] of J) {
        setSt(`⏳ ${label}…`);
        try {
          const c = await captureUrl(urlOf(k, href));
          ids.push(await requestPdf({ ...c, title: `${label} ${dmy(from)} – ${dmy(to)}`, pkg }));
        } catch (e) { err.push(`${label}: ${(e as Error).message}`); }
      }
      setSt('⏳ Се чека серверот за PDF…');
      for (const id of ids) await waitForFile(id, 40);
      setSt(err.length ? `Додадени ${ids.length}; не успеа: ${err.join(' · ')}` : `✓ Додадени во пакетот: ${ids.length}. Сега испратете го подолу.`);
      router.refresh();
    } finally { setBusy(false); }
  };
  return (
    <div style={{ marginTop: 8, padding: 8, border: '1px solid var(--line, #ddd)', borderRadius: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <b className="mini">Извештаи за пакетот – период:</b>
        <label className="mini">од <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} /></label>
        <label className="mini">до <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} /></label>
        {bad && <span className="pill bad">периодот не е точен</span>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 6 }}>
        {reports.map(([k, , label]) => (
          <label key={k} className="chk"><input type="checkbox" checked={sel.has(k)} onChange={() => flip(k)} /> {label}</label>
        ))}
      </div>
      {sel.has('kart') && (
        <label className="mini" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }} title="Почеток на контото: 1200 = 1200 и неговите аналитики">
          картици за конта <input value={ks} onChange={(e) => setKs(e.target.value)} style={{ width: 'auto', flex: 1, minWidth: 260 }} />
        </label>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <button type="button" className="btn pri" disabled={busy || bad || !sel.size} onClick={run}>{busy ? 'Се додава…' : `+ Додај ги избраните во пакетот (${sel.size})`}</button>
        {st && <span className="mini">{st}</span>}
      </div>
      <p className="mini mut" style={{ margin: '6px 0 0' }}>{note}</p>
    </div>
  );
}
