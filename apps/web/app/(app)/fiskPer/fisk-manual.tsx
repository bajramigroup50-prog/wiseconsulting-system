'use client';
/**
 * Legacy `ACT.fkManual` 13048 — „✎ Внеси рачно – фискален извештај“: Вкупен промет, Од / До датум (ДД.ММ.ГГГГ), Од
 * картичка, Даночна група (Г-ставка без ДДВ / А 18% / Б 5% / В 0% / Г 10%), Апарат, „не е ДДВ обврзник“; invalid fields
 * get a red border. „✓ Внеси“ opens the result card (`?mt=…`) like a read report.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { fmDate } from '@wise/core/retail';

const num = (v: string) => { const x = Number(v.replace(/[\s ]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
const dmy = (iso: string) => (iso ? iso.split('-').reverse().join('.') : '');

export function FiskManual({ year, today, nonVat0, init }: { year: number; today: string; nonVat0: boolean; init?: { t?: string; f?: string; d?: string; c?: string; g?: string; a?: string } }) {
  const router = useRouter();
  const [t, setT] = useState(init?.t ?? '');
  const [f, setF] = useState(dmy(init?.f || `${year}-01-01`));
  const [d, setD] = useState(dmy(init?.d || today));
  const [c, setC] = useState(init?.c ?? '');
  const [g, setG] = useState(init?.g || (nonVat0 ? 'Г0' : 'А'));
  const [a, setA] = useState(init?.a ?? '');
  const [nv, setNv] = useState(nonVat0);
  const [bad, setBad] = useState<string>('');
  const dt = (v: string, set: (x: string) => void) => { const x = v.replace(/\D/g, ''); set(/^\d+$/.test(v) && x.length === 8 ? `${x.slice(0, 2)}.${x.slice(2, 4)}.${x.slice(4)}` : v); setBad(''); };
  const go = () => {
    const tot = num(t);
    if (!(tot > 0)) { setBad('t'); return; }
    const from = fmDate(f, year), to = fmDate(d, year);
    if (!from) { setBad('f'); return; }
    if (!to || from > to) { setBad('d'); return; }
    const grp = nv ? 'Г0' : g;
    const q = new URLSearchParams({ mt: String(tot), mf: from, md: to, mc: String(Math.min(tot, num(c))), mg: grp, ...(a.trim() ? { ma: a.trim() } : {}) });
    router.push('/fiskPer?' + q.toString());
  };
  const br = (k: string) => (bad === k ? { borderColor: 'var(--bad)' } : undefined);
  return (
    <div className="card" style={{ maxWidth: 520 }}>
      <h2 style={{ marginTop: 0 }}>✎ Внеси рачно – фискален извештај</h2>
      <div className="form">
        <label className="f">Вкупен промет (ден.)<input inputMode="decimal" placeholder="1 880 999,00" value={t} onChange={(e) => { setT(e.target.value); setBad(''); }} style={br('t')} autoFocus /></label>
        <label className="f">Од датум<input inputMode="numeric" placeholder="ДД.ММ.ГГГГ" value={f} onChange={(e) => dt(e.target.value, setF)} onBlur={() => { const x = fmDate(f, year); if (x) setF(dmy(x)); }} style={br('f')} /></label>
        <label className="f">До датум<input inputMode="numeric" placeholder="ДД.ММ.ГГГГ" value={d} onChange={(e) => dt(e.target.value, setD)} onBlur={() => { const x = fmDate(d, year); if (x) setD(dmy(x)); }} style={br('d')} /></label>
        <label className="f">Од картичка (ако има)<input inputMode="decimal" value={c} onChange={(e) => setC(e.target.value)} /></label>
        <label className="f">Даночна група<select value={nv ? 'Г0' : g} onChange={(e) => { setG(e.target.value); if (e.target.value === 'Г0') setNv(true); else setNv(false); }}>
          <option value="Г0">Г-ставка – не е ДДВ обврзник (без ДДВ)</option>{['А 18%', 'Б 5%', 'В 0%', 'Г 10%'].map((x) => <option key={x} value={x[0]}>{x}</option>)}</select></label>
        <label className="f">Апарат (рег. број)<input value={a} onChange={(e) => setA(e.target.value)} /></label>
      </div>
      <label style={{ display: 'block', margin: '8px 0' }}><input type="checkbox" checked={nv} onChange={(e) => { setNv(e.target.checked); if (!e.target.checked && g === 'Г0') setG('А'); }} /> фирмата <b>не е ДДВ обврзник</b> (само вкупен промет)</label>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}><button type="button" className="btn" onClick={() => router.push('/fiskPer')}>Откажи</button><button type="button" className="btn pri" onClick={go}>✓ Внеси</button></div>
    </div>
  );
}
