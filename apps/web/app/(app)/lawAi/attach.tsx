'use client';
/** „📎 Додај во контрола“: pick an inspection case of the firm and link the memo to it (id only). */
import { useState, useTransition } from 'react';
import type { RowResult } from '@/components/row-action';

export function AttachKontrola({ action, options, current }: {
  action: (kontrolaId: string | null) => Promise<RowResult>;
  options: { id: string; label: string }[];
  current: string | null;
}) {
  const [v, setV] = useState(current ?? '');
  const [res, setRes] = useState<RowResult | null>(null);
  const [pending, start] = useTransition();
  if (!options.length && !current) return <span className="note">Фирмата нема евидентирани контроли (Контроли и решенија).</span>;
  return (
    <span className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <select value={v} onChange={(e) => setV(e.target.value)} aria-label="Контрола">
        <option value="">— без контрола —</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <button type="button" className="btn sm" disabled={pending || v === (current ?? '')}
        onClick={() => start(async () => setRes(await action(v || null)))}>📎 Додај во контрола</button>
      {res?.error && <span className="pill bad" role="alert">{res.error}</span>}
      {res?.ok && <span className="pill good" role="status">{res.ok}</span>}
    </span>
  );
}
