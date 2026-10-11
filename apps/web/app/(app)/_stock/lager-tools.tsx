'use client';
/**
 * Stock-list selection bar (legacy admin patch 16998: checkbox column, „Избрани: N“, „🗑 Избриши ја залихата на
 * избраните“ → `ACT.lgDel` 17006). The row checkboxes live in the table (`name="lgs" form="lgDelForm"`).
 */
import { useActionState, useEffect, useState } from 'react';
import type { ActionState } from '@/lib/books';
import { deleteItemsStockAction } from './parity-actions';

const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[name="lgs"][form="lgDelForm"]'));

export function CheckAll() {
  return <input type="checkbox" title="Избери ги сите" aria-label="Избери ги сите" onChange={(e) => { for (const c of boxes()) c.checked = e.target.checked; document.dispatchEvent(new Event('lgsel')); }} />;
}

export function LgDelBar({ wh, whName }: { wh: string; whName: string }) {
  const [st, run, pending] = useActionState<ActionState, FormData>(deleteItemsStockAction, {});
  const [n, setN] = useState(0);
  useEffect(() => {
    const upd = () => setN(boxes().filter((c) => c.checked).length);
    document.addEventListener('change', upd);
    document.addEventListener('lgsel', upd);
    return () => { document.removeEventListener('change', upd); document.removeEventListener('lgsel', upd); };
  }, []);
  return (
    <form id="lgDelForm" className="card noprint" style={{ padding: '8px 12px' }} action={run}
      onSubmit={(e) => {
        if (!n) { e.preventDefault(); window.alert('Изберете артикли (кутичката лево).'); return; }
        if (!window.confirm(`Да се избрише залихата на ${n} артикли${wh ? ' во „' + whName + '“' : ' (сите објекти)'}?\n\nСе бришат движењата (почетна залиха, увоз, рачни приемници/издатници, преносници, попис) и ставките за тие артикли во преносниците и пописите. Движењата од фактури, каса и производство остануваат – тие се бришат од самиот документ.\nОва не може да се врати.`)) e.preventDefault();
      }}>
      <input type="hidden" name="wh" value={wh} />
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>Избрани: {n}</b>
        <button className="btn sm danger" disabled={pending}>🗑 Избриши ја залихата на избраните</button>
        <span className="mini">{wh ? `во „${whName}“` : 'сите објекти'}</span>
        {st.error && <span className="pill bad">{st.error}</span>}{st.ok && <span className="pill good">{st.ok}</span>}
      </div>
    </form>
  );
}
