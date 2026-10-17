'use client';
/**
 * Bulk „Означи како чл. 32-а“ / „Ослободено со право на одбивка (поле 08)“ / „Ослободено без право на одбивка –
 * чл. 24 (поле 09)“ for the ticked issued invoices (Излезни фактури): invoices issued without VAT are re-marked as
 * domestic reverse charge (ДДВ-04 поле 11, купувачи 1200009) or as exempt with an editable legal basis, and re-posted.
 * Open periods only; the server skips the others. Article mapping ЗА ПРОВЕРКА (to be confirmed by the owner).
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ticked } from './bulk-select';

/** Default basis per kind (the same texts as `EXEMPT_NOTE_DEFAULT` in @wise/db). */
export const EXEMPT_BASES: Record<'ded' | 'noded', string> = {
  ded: 'Ослободено од ДДВ со право на одбивка на претходниот данок согласно член 23 од ЗДДВ',
  noded: 'Ослободено од ДДВ без право на одбивка на претходниот данок согласно член 24 од ЗДДВ',
};
export const EXEMPT_LABEL: Record<'ded' | 'noded', string> = {
  ded: 'Ослободено со право на одбивка (поле 08)',
  noded: 'Ослободено без право на одбивка – чл. 24 (поле 09)',
};

export function VatMarkBar({ group = 'r', action }: {
  group?: string;
  action: (ids: string[], mode: 'art32' | 'ded' | 'noded', note?: string) => Promise<{ ok?: string; error?: string }>;
}) {
  const router = useRouter();
  const [note, setNote] = useState<Record<'ded' | 'noded', string>>({ ...EXEMPT_BASES });
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  const go = (mode: 'art32' | 'ded' | 'noded') => {
    const ids = ticked(group);
    if (!ids.length) { setMsg('Изберете фактури (кутичката лево).'); return; }
    const q = mode === 'art32'
      ? `${ids.length} фактури без ДДВ да се означат како член 32-а (пренесување на даночната обврска)?\nСтавките добиваат стапка 18% без пресметан ДДВ, побарувањето оди на купувачи по чл. 32-а (1200009), во ДДВ-04 поле 11. Фактурите се прокнижуваат повторно (само во отворени периоди).`
      : `${ids.length} фактури без ДДВ да се означат: ${EXEMPT_LABEL[mode]}?\nОснов: ${note[mode]}\nСтапка 0%. Фактурите се прокнижуваат повторно (само во отворени периоди).`;
    if (!window.confirm(q)) return;
    start(async () => { const r = await action(ids, mode, mode === 'art32' ? undefined : note[mode]); setMsg(r.error ?? r.ok ?? ''); router.refresh(); });
  };
  return (
    <div className="row noprint" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '2px 0 6px' }}>
      <span className="mini">ДДВ на избраните:</span>
      <button type="button" className="btn" disabled={pending} onClick={() => go('art32')} title="Фактури издадени без ДДВ по член 32-а од ЗДДВ – ДДВ пресметува примателот">Означи како чл. 32-а</button>
      {(['ded', 'noded'] as const).map((k) => (
        <span key={k} className="row" style={{ gap: 4, alignItems: 'center' }}>
          <button type="button" className="btn" disabled={pending} onClick={() => go(k)}>{EXEMPT_LABEL[k]}</button>
          <input value={note[k]} maxLength={500} onChange={(e) => setNote((o) => ({ ...o, [k]: e.target.value }))} aria-label={'Основ – ' + EXEMPT_LABEL[k]} style={{ maxWidth: 300 }} />
        </span>
      ))}
      <span className="mini" title="Мапирањето на членовите (чл. 23 → поле 08, чл. 24 → поле 09) треба да го потврди сопственикот">за проверка</span>
      {msg && <span className="note">{msg}</span>}
    </div>
  );
}
