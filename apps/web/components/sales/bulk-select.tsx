'use client';
/**
 * Row selection for document lists (legacy `purSel` / `delPurSel` 7192 → 17354 and the admin bulk delete `bulkScan`
 * 16904–16926): server-rendered rows carry `<input type="checkbox" data-sel={id}>`; the bar collects the ticked ids.
 */
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const ticked = (g: string) => [...document.querySelectorAll<HTMLInputElement>(`input[data-sel-g="${g}"]:checked`)].map((x) => x.value);

export function SelAll({ group = 'r' }: { group?: string }) {
  return <input type="checkbox" aria-label="Избери ги сите" title="Избери ги сите" onChange={(e) => {
    document.querySelectorAll<HTMLInputElement>(`input[data-sel-g="${group}"]`).forEach((x) => { x.checked = e.target.checked; });
    document.dispatchEvent(new Event('wise-sel'));
  }} />;
}

export function SelBox({ id, group = 'r' }: { id: string; group?: string }) {
  return <input type="checkbox" value={id} data-sel-g={group} aria-label="Избери" onChange={() => document.dispatchEvent(new Event('wise-sel'))} />;
}

export function BulkBar({ group = 'r', label, confirm: ask, action, extra }: {
  /** Texts with `{n}` = number of ticked rows (strings: server pages can't pass functions to this client component). */
  group?: string; label?: string; confirm?: string;
  /** Bulk delete; without it the bar shows only the `extra` buttons. */
  action?: (ids: string[]) => Promise<{ ok?: string; error?: string }>;
  /** Extra buttons that receive the selection (e.g. „Опомени →“). */
  /** `href` gets `{ids}` replaced by the comma-separated selection. */
  extra?: { label: string; href: string }[];
}) {
  const router = useRouter();
  const [n, setN] = useState(0);
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  useEffect(() => {
    const f = () => setN(ticked(group).length);
    document.addEventListener('wise-sel', f);
    return () => document.removeEventListener('wise-sel', f);
  }, [group]);
  return (
    <div className="row noprint" style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg)', padding: '6px 0', gap: 8, alignItems: 'center' }}>
      <span className="mini">Штиклирајте и:</span>
      {action && <button type="button" className="btn danger" disabled={!n || pending} onClick={() => {
        const ids = ticked(group);
        if (!ids.length) { setMsg('Изберете (кутичката лево).'); return; }
        if (!window.confirm((ask ?? '').replaceAll('{n}', String(ids.length)))) return;
        start(async () => { const r = await action(ids); setMsg(r.error ?? r.ok ?? ''); router.refresh(); });
      }}>{pending ? 'Се брише…' : (label ?? '').replaceAll('{n}', String(n))}</button>}
      {extra?.map((x) => <button key={x.label} type="button" className="btn" disabled={!n} onClick={() => { window.location.href = x.href.replaceAll('{ids}', encodeURIComponent(ticked(group).join(','))); }}>{x.label.replaceAll('{n}', String(n))}</button>)}
      {msg && <span className="note">{msg}</span>}
    </div>
  );
}

/**
 * Legacy `opGoSel` (16895): the „Опомени →“ button of the overdue hint — with ticked invoices the letters cover only
 * those (`/opomeni?ids=…`), otherwise every overdue invoice.
 */
export function OpGoSel({ group = 'r' }: { group?: string }) {
  return <button type="button" className="btn sm pri" title="Ако има штиклирани фактури – опомена само за нив" onClick={() => {
    const ids = ticked(group);
    window.location.href = ids.length ? '/opomeni?ids=' + encodeURIComponent(ids.join(',')) : '/opomeni';
  }}>Опомени →</button>;
}
