'use client';
/**
 * „Избор на конто“ of the old program: the whole chart of accounts in its own big window – search by шифра or опис,
 * ↑ ↓ / PageUp / PageDown to move, Enter (or double click) picks, Esc closes. Synthetic kontos (3 digits) are bold.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

export function KontoWindow({ chart, value, onPick, onClose }: {
  chart: { code: string; name: string }[]; value?: string; onPick: (code: string) => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const qRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    const L = [...chart].sort((a, b) => a.code.localeCompare(b.code));
    if (!t) return L;
    return L.filter((k) => k.code.startsWith(t) || k.name.toLowerCase().includes(t));
  }, [chart, q]);
  useEffect(() => { setTimeout(() => qRef.current?.focus(), 30); const i = value ? hits.findIndex((k) => k.code === value) : -1; if (i >= 0) setHi(i); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' }); }, [hi]);

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // the line's own keys stay out of this window
    const m = (d: number) => { e.preventDefault(); setHi((h) => Math.max(0, Math.min(hits.length - 1, h + d))); };
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') m(1);
    else if (e.key === 'ArrowUp') m(-1);
    else if (e.key === 'PageDown') m(20);
    else if (e.key === 'PageUp') m(-20);
    else if (e.key === 'Enter') { e.preventDefault(); const k = hits[hi]; if (k) onPick(k.code); }
  };

  return (
    <div className="kw-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{KW_CSS}</style>
      <div role="dialog" aria-modal="true" aria-label="Избор на конто" className="kw" onKeyDown={onKey}>
        <div className="kw-title"><b>Избор на конто</b><button type="button" className="kw-x" onClick={onClose} aria-label="Затвори">✕</button></div>
        <div className="kw-bar">
          <input ref={qRef} value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} placeholder="🔍 шифра или опис на конто…" aria-label="Барај конто" />
          <span className="mini">{hits.length} конта</span>
        </div>
        <div className="kw-body">
          <div ref={listRef} className="kw-list" role="listbox" aria-label="Контен план">
            <div className="kw-h"><span>Конто</span><span>Опис на конто</span></div>
            {hits.map((k, i) => (
              <div key={k.code} data-i={i} role="option" aria-selected={i === hi}
                className={'kw-r' + (i === hi ? ' on' : '') + (k.code === value ? ' cur' : '') + (k.code.length <= 3 ? ' syn' : '')}
                onMouseEnter={() => setHi(i)} onClick={() => onPick(k.code)}>
                <span>{k.code}</span><span>{k.name}</span>
              </div>
            ))}
            {!hits.length && <div className="kw-r"><span /><span>Нема конто „{q}“.</span></div>}
          </div>
          <div className="kw-side">
            <button type="button" className="btn pri" onClick={() => { const k = hits[hi]; if (k) onPick(k.code); }}>Избери (Enter)</button>
            <button type="button" className="btn" onClick={onClose}>Излез (Esc)</button>
            <p className="mini">↑ ↓ движење · PgUp / PgDn · двоен клик или Enter = избор</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const KW_CSS = `
.kw-back{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;padding:12px}
.kw{width:min(1100px,100%);height:min(88vh,900px);display:flex;flex-direction:column;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.25);overflow:hidden}
.kw-title{display:flex;justify-content:space-between;align-items:center;padding:6px 12px;border-bottom:1px solid var(--line);color:var(--accent);background:var(--bg)}
.kw-x{border:0;background:none;cursor:pointer;font-size:15px;color:var(--muted)}
.kw-bar{display:flex;gap:10px;align-items:center;padding:8px 12px}
.kw-bar input{flex:1;max-width:520px}
.kw-body{flex:1;display:flex;min-height:0;gap:10px;padding:0 12px 12px}
.kw-list{flex:1;overflow:auto;border:1px solid var(--line);border-radius:6px;font-size:12.5px}
.kw-h,.kw-r{display:grid;grid-template-columns:110px 1fr;gap:8px;padding:2px 8px}
.kw-h{position:sticky;top:0;background:var(--bg);font-weight:700;border-bottom:1px solid var(--line)}
.kw-r{cursor:pointer;border-bottom:1px solid color-mix(in srgb,var(--line) 50%,transparent)}
.kw-r.syn{font-weight:700}
.kw-r.cur{outline:1px dashed var(--accent)}
.kw-r.on{background:var(--accent-soft)}
.kw-side{width:170px;display:flex;flex-direction:column;gap:8px}
@media (max-width:700px){.kw-side{display:none}}
`;
