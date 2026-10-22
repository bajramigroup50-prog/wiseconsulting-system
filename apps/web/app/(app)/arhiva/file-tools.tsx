'use client';
/**
 * Loose files of the archive („Датотека“ rows): ⇄ move one file to another firm, and the bulk bar for the ticked
 * rows — „🗑 Избриши избраните“ / „⇄ Премести избраните“ (rows carry `SelBox` of `components/sales/bulk-select`).
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { ticked } from '@/components/sales/bulk-select';

type Res = { ok?: string; error?: string };
type FirmOpt = { id: string; name: string };
type Move = (ids: string[], to: string) => Promise<Res>;

function FirmSelect({ firms, value, onChange }: { firms: FirmOpt[]; value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 'auto', maxWidth: 280 }} aria-label="Фирма">
      <option value="">— во фирма —</option>
      {firms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
    </select>
  );
}

/** ⇄ on one row: pick the firm, confirm, move. */
export function ArMoveOne({ id, name, firms, move }: { id: string; name: string; firms: FirmOpt[]; move: Move }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState('');
  const [pending, start] = useTransition();
  if (!open) return <button type="button" className="btn sm ghost" title="Премести во друга фирма" onClick={() => setOpen(true)}>⇄</button>;
  return (
    <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
      <FirmSelect firms={firms} value={to} onChange={setTo} />
      <button type="button" className="btn sm pri" disabled={!to || pending} onClick={() => {
        const t = firms.find((f) => f.id === to);
        if (!t || !window.confirm(`Да се премести „${name}“ во „${t.name}“?`)) return;
        start(async () => { const r = await move([id], to); if (r.error) window.alert(r.error); else { setOpen(false); router.refresh(); } });
      }}>{pending ? '…' : 'Премести'}</button>
      <button type="button" className="btn sm ghost" onClick={() => setOpen(false)} title="Откажи">✕</button>
    </span>
  );
}

/** Bulk bar for the ticked loose files (group `ar`). */
export function ArBulk({ firms, del, move, group = 'ar' }: { firms: FirmOpt[]; del?: (ids: string[]) => Promise<Res>; move?: Move; group?: string }) {
  const router = useRouter();
  const [n, setN] = useState(0);
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  useEffect(() => {
    const f = () => setN(ticked(group).length);
    document.addEventListener('wise-sel', f);
    return () => document.removeEventListener('wise-sel', f);
  }, [group]);
  const run = (ask: string, f: (ids: string[]) => Promise<Res>) => {
    const ids = ticked(group);
    if (!ids.length) { setMsg('Штиклирајте датотеки (кутичката лево).'); return; }
    if (!window.confirm(ask.replaceAll('{n}', String(ids.length)))) return;
    start(async () => {
      const r = await f(ids);
      setMsg(r.error ?? r.ok ?? '');
      document.querySelectorAll<HTMLInputElement>(`input[data-sel-g="${group}"]`).forEach((x) => { x.checked = false; });
      setN(0);
      router.refresh();
    });
  };
  const t = firms.find((f) => f.id === to);
  return (
    <div className="row noprint" style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg)', padding: '6px 0', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="mini">Датотеки без документ или што чекаат одобрување – штиклирајте (☑ горе = сите) и:</span>
      {del && <button type="button" className="btn danger" disabled={!n || pending} onClick={() => run('Да се избришат {n} датотеки? Ова не може да се врати.', del)}>🗑 Избриши избраните ({n})</button>}
      {move && firms.length > 0 && <>
        <FirmSelect firms={firms} value={to} onChange={setTo} />
        <button type="button" className="btn" disabled={!n || !t || pending} onClick={() => run(`Да се преместат {n} датотеки во „${t?.name ?? ''}“?`, (ids) => move(ids, to))}>⇄ Премести избраните ({n})</button>
      </>}
      {pending && <span className="mini">Се работи…</span>}
      {msg && <span className="note">{msg}</span>}
    </div>
  );
}
