'use client';
/** „🗑 Избриши ги сите документи и книжења за годината“: 1. what will go, 2. type the firm name, 3. delete. */
import { useState, useTransition } from 'react';
import { wipePlanAction, wipeYearAction, type WipeState } from './wipe-actions';

export function WipeYearBox({ firmId, firmName, year }: { firmId: string; firmName: string; year: number }) {
  const [st, setSt] = useState<WipeState | null>(null);
  const [name, setName] = useState('');
  const [busy, start] = useTransition();
  return (
    <div className="card" style={{ borderLeft: '4px solid var(--bad)' }}>
      <h2 style={{ margin: '0 0 4px' }}>🗑 Избриши ги сите документи и книжења за {year}</h2>
      <p className="mini" style={{ margin: '0 0 8px' }}>Налози, фактури, изводи, благајна, плати, залиха, ДДВ, завршна сметка и скенирани документи на <b>{firmName}</b> за {year}, и комитентите / артиклите што потоа не се користат никаде. Фирмата, банкарските сметки, поставките и другите години остануваат. <b>Не може да се врати</b> (има ноќна резервна копија).</p>
      {!st?.plan && <button type="button" className="btn" disabled={busy} onClick={() => start(async () => setSt(await wipePlanAction(firmId)))}>Покажи што ќе се избрише</button>}
      {st?.plan && st.plan.length > 0 && !st.ok && (
        <>
          <ul className="mini" style={{ margin: '4px 0 8px' }}>{st.plan.map((p) => <li key={p.label}>{p.label}: <b>{p.n}</b></li>)}</ul>
          <label className="f">За потврда напишете го името на фирмата<input value={name} onChange={(e) => setName(e.target.value)} placeholder={firmName} /></label>
          <button type="button" className="btn danger" style={{ marginTop: 6 }} disabled={busy || !name.trim()}
            onClick={() => { if (window.confirm(`Конечно да се избришат сите документи и книжења на ${firmName} за ${year}?`)) start(async () => setSt({ ...(await wipeYearAction(firmId, name)), plan: st.plan })); }}>
            {busy ? 'Се брише…' : `🗑 Избриши сè за ${year}`}</button>
        </>
      )}
      {st?.error && <div className="callout bad" style={{ marginTop: 6 }}>{st.error}</div>}
      {st?.ok && <div className="callout good" style={{ marginTop: 6 }}>{st.ok}</div>}
    </div>
  );
}
