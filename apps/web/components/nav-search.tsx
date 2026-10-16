'use client';
/**
 * P25 „Пребарај екран…“ — Ctrl+K (⌘K) or the 🔎 button in the menu bar: type a new or an old screen name, ↑ / ↓ to
 * choose, Enter to open, Esc to close. The list is the server-built index of the screens THIS user may open
 * (`lib/nav-search.ts`); nothing outside it can be reached from here.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { searchScreens, type ScreenEntry } from '@/lib/nav-search';

export function NavSearch({ index, open: go }: { index: readonly ScreenEntry[]; open: (id: string) => void }) {
  const [shown, setShown] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const back = useRef<HTMLElement | null>(null);
  const id = useId();
  const R = useMemo(() => searchScreens(index, q), [index, q]);

  const show = useCallback(() => {
    back.current = document.activeElement as HTMLElement | null;
    setQ(''); setSel(0); setShown(true);
  }, []);
  const hide = useCallback(() => {
    setShown(false);
    back.current?.focus?.();
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (shown) hide(); else show();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [shown, show, hide]);
  useEffect(() => { if (shown) input.current?.focus(); }, [shown]);
  useEffect(() => setSel(0), [q]);

  const pick = (e: ScreenEntry) => { setShown(false); go(e.id); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (R.length ? (s + 1) % R.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (R.length ? (s - 1 + R.length) % R.length : 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (R[sel]) pick(R[sel]!); }
    else if (e.key === 'Tab') e.preventDefault(); // the dialog has one control: focus stays in the field
  };
  useEffect(() => { document.getElementById(`${id}-${sel}`)?.scrollIntoView({ block: 'nearest' }); }, [sel, id]);

  return (
    <>
      <button type="button" className="navsearch" onClick={show} aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K" title="Пребарај екран (Ctrl+K)">
        🔎 <span className="ln">Пребарај…</span>
      </button>
      {shown && (
        <div className="nsk" onMouseDown={(e) => { if (e.target === e.currentTarget) hide(); }}>
          <div className="nsk-box" role="dialog" aria-modal="true" aria-label="Пребарај екран">
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
              placeholder="Пребарај екран… (ново или старо име)" aria-label="Пребарај екран"
              role="combobox" aria-expanded={R.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list"
              aria-activedescendant={R[sel] ? `${id}-${sel}` : undefined} autoComplete="off" spellCheck={false} />
            <ul className="nsk-list" id={`${id}-list`} role="listbox" aria-label="Екрани">
              {R.map((e, i) => (
                <li key={e.id} id={`${id}-${i}`} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => pick(e)}>
                  <span>{e.t}</span>{e.g && <small>{e.g}</small>}
                </li>
              ))}
              {q.trim() && !R.length && <li role="option" aria-selected={false} aria-disabled="true"><span className="mut">Нема таков екран (или немате пристап до него).</span></li>}
            </ul>
            <div className="nsk-foot">↑ ↓ избор · Enter отвори · Esc затвори</div>
          </div>
        </div>
      )}
    </>
  );
}
