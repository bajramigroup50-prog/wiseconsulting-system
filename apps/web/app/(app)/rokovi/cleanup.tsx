'use client';
/**
 * „🧹 Означи ги минатите како направени“ (owner / administrator): every open deadline before the chosen date, in the
 * current scope, is marked done (note „означено рачно (чистење)“) after a confirm with the count;
 * „↺ Врати го последното чистење“ reopens the rows of the last clean-up.
 */
import { useState, useTransition } from 'react';
import { RowAction } from '@/components/row-action';
import { rokCleanupAction, rokCleanupPreview, rokCleanupUndoAction } from './actions';

export function RokCleanup({ def, scope, last }: { def: string; scope: string; last: string | null }) {
  const [before, setBefore] = useState(def);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const dmy = (d: string) => d.split('-').reverse().join('.');
  const run = () => start(async () => {
    setMsg(null);
    const p = await rokCleanupPreview(before);
    if (p.error) { setMsg({ error: p.error }); return; }
    if (!p.n) { setMsg({ ok: `Нема отворени рокови пред ${dmy(before)} (${scope}).` }); return; }
    if (!window.confirm(`Ќе се означат како направени ${p.n} отворени рокови со рок пред ${dmy(before)} (${scope}), со белешка „означено рачно (чистење)“.\n\nМоже да се врати со „↺ Врати го последното чистење“. Продолжи?`)) return;
    setMsg(await rokCleanupAction(before));
  });
  return (
    <div className="row" style={{ gap: '6px 12px', flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
      <label>Сите отворени рокови пред <input type="date" value={before} onChange={(e) => setBefore(e.target.value)} style={{ width: 'auto' }} aria-label="Пред датум" /></label>
      <button type="button" className="btn" id="rokCleanBtn" disabled={pending || !before} onClick={run}>✓ Означи ги минатите како направени</button>
      {last && <RowAction action={rokCleanupUndoAction} label="↺ Врати го последното чистење" className="btn sm ghost" showOk
        title={`Ги враќа како отворени роковите означени со чистењето од ${last}`} confirm={`Да се вратат како отворени роковите од чистењето од ${last}?`} />}
      {msg && <div className={`callout ${msg.error ? 'bad' : 'good'}`} role="status" style={{ flexBasis: '100%', margin: 0 }}>{msg.error ?? msg.ok}</div>}
    </div>
  );
}
