'use client';
/**
 * Bulk „Означи како чл. 32-а“ / „Означи како ослободено (чл. 24)“ for the ticked issued invoices (Излезни фактури):
 * invoices issued without VAT are re-marked as domestic reverse charge (ДДВ-04 поле 11, купувачи 1200009) or as
 * exempt with a chosen legal basis (поле 08), and re-posted. Open periods only; the server skips the others.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ticked } from './bulk-select';

const BASES = [
  'Ослободено од ДДВ согласно член 24 од ЗДДВ',
  'Ослободено од ДДВ согласно член 24 од ЗДДВ (без право на одбивка)',
  'Ослободено од ДДВ согласно член 30 од ЗДДВ',
];

export function VatMarkBar({ group = 'r', action }: {
  group?: string;
  action: (ids: string[], mode: 'art32' | 'exempt', note?: string) => Promise<{ ok?: string; error?: string }>;
}) {
  const router = useRouter();
  const [note, setNote] = useState(BASES[0]!);
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  const go = (mode: 'art32' | 'exempt') => {
    const ids = ticked(group);
    if (!ids.length) { setMsg('Изберете фактури (кутичката лево).'); return; }
    const q = mode === 'art32'
      ? `${ids.length} фактури без ДДВ да се означат како член 32-а (пренесување на даночната обврска)?\nСтавките добиваат стапка 18% без пресметан ДДВ, побарувањето оди на купувачи по чл. 32-а (1200009), во ДДВ-04 поле 11. Фактурите се прокнижуваат повторно (само во отворени периоди).`
      : `${ids.length} фактури без ДДВ да се означат како ослободени?\nОснов: ${note}\nСтапка 0%, ДДВ-04 поле 08. Фактурите се прокнижуваат повторно (само во отворени периоди).`;
    if (!window.confirm(q)) return;
    start(async () => { const r = await action(ids, mode, mode === 'exempt' ? note : undefined); setMsg(r.error ?? r.ok ?? ''); router.refresh(); });
  };
  return (
    <div className="row noprint" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '2px 0 6px' }}>
      <span className="mini">ДДВ на избраните:</span>
      <button type="button" className="btn" disabled={pending} onClick={() => go('art32')} title="Фактури издадени без ДДВ по член 32-а од ЗДДВ – ДДВ пресметува примателот">Означи како чл. 32-а</button>
      <button type="button" className="btn" disabled={pending} onClick={() => go('exempt')}>Означи како ослободено (чл. 24)</button>
      <input list="vatMarkBases" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} aria-label="Основ за ослободување" style={{ maxWidth: 380 }} />
      <datalist id="vatMarkBases">{BASES.map((x) => <option key={x} value={x} />)}</datalist>
      {msg && <span className="note">{msg}</span>}
    </div>
  );
}
