'use client';
/** Wraps the firm table: the ticked „ready“ firms are confirmed and posted (legacy `pbGo`). */
import { useState, useTransition } from 'react';
import { confirmBatch } from './actions';

export function ConfirmForm({ month, mode, ready, label, children }: { month: string; mode: 'prev' | 'cal'; ready: number; label: string; children: React.ReactNode }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState('');
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const ids = new FormData(e.currentTarget).getAll('fid').map(String);
      if (!ids.length) { setMsg('Нема избрани фирми за потврда.'); return; }
      if (!window.confirm(`Да се потврдат и прокнижат прегледаните плати за ${label} за ${ids.length} фирми без известувања за промени?\n\n(${mode === 'prev' ? 'како претходниот месец – исти вработени и плати, постојаните задршки; работните часови и празниците според календарот на новиот месец; БЕЗ прекувремени, недела, празник, бонус' : 'стандардни часови по календар за активните вработени'})\n\nФирмите со „⛔ Чека промени“ и „📥 Excel“ не се допираат.`)) return;
      start(async () => { const r = await confirmBatch(month, mode, ids); setMsg(r.error ?? r.ok ?? ''); });
    }}>
      <div className="row" style={{ gap: 8, margin: '8px 0', alignItems: 'center' }}>
        <button className="btn pri" disabled={pending || !ready}>{pending ? 'Се книжи…' : `✅ Потврди и прокнижи (${ready})`}</button>
        {msg && <span className="callout" style={{ margin: 0 }}>{msg}</span>}
      </div>
      {children}
    </form>
  );
}
