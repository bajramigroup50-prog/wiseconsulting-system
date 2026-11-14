'use client';
/** CRM pipeline as a kanban: drag a card to another column (or use the ‹ › buttons) → `moveStage`. */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CRM_STAGES } from '@wise/core/firms/crm';
import { moveStage } from './actions';

export interface KCard { id: string; company: string; contact: string | null; stage: string; fee: number; source: string; nextDate: string | null; nextStep: string | null; firmId: string | null }

const dmy = (d: string | null) => (d ? d.split('-').reverse().join('.') : '');
const fmt0 = (n: number) => Math.round(n).toLocaleString('de-DE');

export function Kanban({ cards, today }: { cards: KCard[]; today: string }) {
  const r = useRouter();
  const [pending, start] = useTransition();
  const [over, setOver] = useState<string | null>(null);
  const [local, setLocal] = useState(cards);
  const [err, setErr] = useState('');
  const move = (id: string, stage: string) => {
    const c = local.find((x) => x.id === id);
    if (!c || c.stage === stage) return;
    let reason: string | undefined;
    if (stage === 'izguben') { const q = window.prompt('Зошто е изгубен? (цена, отиде кај друг, нема одговор…)', ''); if (q === null) return; reason = q; }
    setLocal((L) => L.map((x) => (x.id === id ? { ...x, stage } : x)));
    start(async () => {
      const res = await moveStage(id, stage, reason);
      if (res?.error) { setErr(res.error); setLocal(cards); }
      r.refresh();
    });
  };
  const idx = (s: string) => CRM_STAGES.findIndex(([k]) => k === s);
  return (
    <>
      {err && <div className="callout bad" role="alert">{err}</div>}
      <div className="crm-kanban" aria-busy={pending} style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(190px, 1fr))', gap: 10, overflowX: 'auto', paddingBottom: 6 }}>
        {CRM_STAGES.map(([k, name, color]) => {
          const C = local.filter((c) => c.stage === k);
          const sum = C.reduce((s, c) => s + c.fee, 0);
          return (
            <div key={k} onDragOver={(e) => { e.preventDefault(); setOver(k); }} onDragLeave={() => setOver((o) => (o === k ? null : o))}
              onDrop={(e) => { e.preventDefault(); setOver(null); move(e.dataTransfer.getData('text/plain'), k); }}
              style={{ background: over === k ? 'var(--hover, #eef5f2)' : 'var(--panel2, rgba(0,0,0,.03))', borderRadius: 10, padding: 8, minHeight: 220, borderTop: `3px solid ${color}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '2px 4px 8px' }}>
                <b style={{ color }}>{name}</b><span className="muted" style={{ fontSize: 12 }}>{C.length}{sum ? ` · ${fmt0(sum)} ден.` : ''}</span>
              </div>
              {C.map((c) => {
                const i = idx(c.stage);
                const late = c.nextDate && c.nextDate <= today;
                return (
                  <div key={c.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', c.id)} className="card" style={{ padding: '8px 10px', margin: '0 0 8px', cursor: 'grab' }}>
                    <Link href={`/crm?id=${c.id}`} style={{ fontWeight: 600, display: 'block' }}>{c.company}</Link>
                    {c.contact && <div className="muted" style={{ fontSize: 12 }}>{c.contact}</div>}
                    <div style={{ fontSize: 12, marginTop: 2 }}>{c.fee ? <span className="pill">{fmt0(c.fee)} ден./мес.</span> : null}{c.firmId && <span className="pill good" style={{ marginLeft: 4 }}>клиент</span>}</div>
                    {(c.nextStep || c.nextDate) && <div style={{ fontSize: 12, marginTop: 4, color: late ? '#b42318' : undefined }}>⏰ {dmy(c.nextDate)} {c.nextStep ?? ''}</div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                      <button type="button" className="btn sm ghost" disabled={i <= 0 || pending} onClick={() => move(c.id, CRM_STAGES[i - 1]![0])} title="Претходна фаза">‹</button>
                      <button type="button" className="btn sm ghost" disabled={i >= CRM_STAGES.length - 1 || pending} onClick={() => move(c.id, CRM_STAGES[i + 1]![0])} title="Следна фаза">›</button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}
