'use client';
/**
 * Keyboard of „Преглед на финансови налози за книжење“ (the nalog list), like the old program: ↑ ↓ select a row,
 * Enter = open / change, Ins = new manual nalog, Del = delete (the row's own „🗑 Избриши“ with its preview / confirm),
 * F8 = „Синтетики“ of the selected nalog, F10 = „Книжење“ (the nalog's „+ Ставки“), + / − = selection with the sums
 * of the selected nalozi. Works on the server-rendered rows (`tr[data-nal]` with `data-d` / `data-p`).
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const nf = new Intl.NumberFormat('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ListKeys({ tableId, newHref }: { tableId: string; newHref?: string }) {
  const router = useRouter();
  const [sel, setSel] = useState(0);
  const [mark, setMark] = useState<Set<string>>(new Set());
  const rows = () => [...(document.getElementById(tableId)?.querySelectorAll<HTMLTableRowElement>('tr[data-nal]') ?? [])];

  useEffect(() => {
    const R = rows();
    R.forEach((tr, i) => {
      tr.setAttribute('aria-selected', String(i === sel));
      tr.style.outline = i === sel ? '2px solid var(--accent)' : '';
      tr.style.outlineOffset = '-2px';
      tr.style.background = mark.has(tr.dataset.nal!) ? 'var(--warn-bg, #fff7e0)' : '';
    });
    R[sel]?.scrollIntoView?.({ block: 'nearest' });
  });

  useEffect(() => {
    const tb = document.getElementById(tableId);
    const click = (e: MouseEvent) => {
      const tr = (e.target as HTMLElement).closest?.('tr[data-nal]');
      if (tr) setSel(rows().indexOf(tr as HTMLTableRowElement));
    };
    tb?.addEventListener('click', click);
    const k = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const tg = (e.target as HTMLElement)?.tagName;
      if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA') return;
      const R = rows();
      const tr = R[sel];
      const go = (f: () => void) => { e.preventDefault(); f(); };
      const open = (sel2: string) => { const a = tr?.querySelector<HTMLAnchorElement>(sel2); if (a) router.push(a.getAttribute('href')!); };
      if (e.key === 'ArrowDown') go(() => setSel((s) => Math.min(s + 1, R.length - 1)));
      else if (e.key === 'ArrowUp') go(() => setSel((s) => Math.max(s - 1, 0)));
      else if (e.key === 'Insert' && newHref) go(() => router.push(newHref));
      else if (e.key === 'Enter' && tg !== 'BUTTON' && tg !== 'A') go(() => open('a[data-open]'));
      else if (e.key === 'Delete') go(() => tr?.querySelector<HTMLButtonElement>('[data-del] button, button[data-del]')?.click());
      else if (e.key === 'F8') go(() => open('a[data-sint]'));
      else if (e.key === 'F10') go(() => open('a[data-book]'));
      else if (e.key === '+' || e.key === '-') go(() => {
        const id = tr?.dataset.nal;
        if (id) setMark((M) => { const n = new Set(M); if (e.key === '+') n.add(id); else n.delete(id); return n; });
        setSel((s) => Math.min(s + 1, R.length - 1));
      });
    };
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('keydown', k); tb?.removeEventListener('click', click); };
  });

  if (!mark.size) return <span className="note">↑ ↓ избор · Enter отвори · Ins нов · Del бриши · F8 синтетики · F10 книжење · + / − селекција</span>;
  const M = rows().filter((tr) => mark.has(tr.dataset.nal!));
  const D = M.reduce((s, tr) => s + Number(tr.dataset.d), 0), P = M.reduce((s, tr) => s + Number(tr.dataset.p), 0);
  return (
    <span className="row" style={{ gap: 8, alignItems: 'center' }} data-testid="list-sel">
      <span className="pill info">Селекција {mark.size}: Должи <b>{nf.format(D)}</b> · Побарува <b>{nf.format(P)}</b> · Салдо <b>{nf.format(D - P)}</b></span>
      <button type="button" className="btn sm ghost" onClick={() => setMark(new Set())}>✕</button>
    </span>
  );
}
