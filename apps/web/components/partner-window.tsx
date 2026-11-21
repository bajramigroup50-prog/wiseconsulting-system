'use client';
/**
 * The old program's „Комитенти“ window, opened with F8 from a nalog's line: the partner list with a search (шифра /
 * назив, Latin ↔ Cyrillic), ↑ ↓ to move, Enter to pick, Esc to close – and „Нов комитент (Ins)“ to type one by hand
 * when it is not in the list yet (saved at once, the line picks it).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { searchPartners } from '@wise/core/partners/search';
import { quickPartnerAction } from '@/app/(app)/partneri/actions';
import type { PickerPartner } from './partner-picker';

export function PartnerWindow({ partners, value, onPick, onClose }: {
  partners: PickerPartner[]; value?: string; onPick: (p: PickerPartner, isNew?: boolean) => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [nw, setNw] = useState<null | { name: string; code: string; edb: string }>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const qRef = useRef<HTMLInputElement>(null);
  const nRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const hits = useMemo(() => searchPartners(partners, q, 300), [partners, q]);
  useEffect(() => { if (nw) nRef.current?.focus(); else qRef.current?.focus(); }, [!!nw]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const i = value ? hits.findIndex((p) => p.id === value) : -1; if (!q && i >= 0) setHi(i); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' }); }, [hi]);

  const create = async () => {
    if (busy || !nw) return;
    if (!nw.name.trim()) { setErr('Внесете назив.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await quickPartnerAction({ name: nw.name, code: nw.code, edb: nw.edb });
      if (r.error || !r.partner) { setErr(r.error ?? 'Не е внесен.'); return; }
      onPick(r.partner, true);
    } finally { setBusy(false); }
  };

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // the line's own keys (Enter = next field, Esc = close the line) stay out of this window
    if (e.key === 'Escape') { e.preventDefault(); if (nw) { setNw(null); setErr(''); } else onClose(); return; }
    if (nw) {
      if (e.key === 'Enter' || e.key === 'F9') { e.preventDefault(); void create(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'PageDown') { e.preventDefault(); setHi((h) => Math.min(h + 12, hits.length - 1)); }
    else if (e.key === 'PageUp') { e.preventDefault(); setHi((h) => Math.max(h - 12, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const p = hits[hi]; if (p) onPick(p); }
    else if (e.key === 'Insert') { e.preventDefault(); setNw({ name: /\d/.test(q) ? '' : q, code: '', edb: '' }); }
  };

  return (
    <div className="hx-pw-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Комитенти" className="hx-pw" onKeyDown={onKey}>
        <div className="hx-title"><span>Комитенти (F8)</span><button type="button" className="hx-x" onClick={onClose} aria-label="Затвори">«</button></div>
        {!nw ? (
          <>
            <div className="hx-row" style={{ padding: '6px 8px' }}>
              <span className="hx-l" style={{ width: 'auto' }}>Барај</span>
              <input ref={qRef} className="hx-y" value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} placeholder="шифра / назив (кирилица / латиница)" aria-label="Барај комитент" style={{ flex: 1 }} />
              <button type="button" className="hx-btn" onClick={() => setNw({ name: /\d/.test(q) ? '' : q, code: '', edb: '' })}>Нов комитент (Ins)</button>
            </div>
            <div ref={listRef} className="hx-pw-list" role="listbox" aria-label="Листа на комитенти">
              <div className="hx-pw-h"><span>Шифра</span><span>Назив</span></div>
              {hits.map((p, i) => (
                <div key={p.id} data-i={i} role="option" aria-selected={i === hi} className={'hx-pw-r' + (i === hi ? ' on' : '') + (p.id === value ? ' cur' : '')}
                  onMouseEnter={() => setHi(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(p)} onDoubleClick={() => onPick(p)}>
                  <span>{p.code ?? ''}</span><span>{p.name}</span>
                </div>
              ))}
              {!hits.length && <div className="hx-pw-r"><span /><span>Нема комитент „{q}“ – Ins за нов, внесен рачно.</span></div>}
            </div>
            <div className="hx-hint" style={{ padding: '4px 8px' }}>↑ ↓ движење · Enter избор · Ins нов комитент · Esc излез — {hits.length} {q ? 'пронајдени' : 'комитенти'}</div>
          </>
        ) : (
          <div style={{ padding: 8, display: 'grid', gap: 6 }}>
            <b>Нов комитент – внес рачно</b>
            <label className="hx-row"><span className="hx-l">Назив</span><input ref={nRef} className="hx-y" value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} maxLength={300} aria-label="Назив на комитентот" style={{ flex: 1 }} /></label>
            <label className="hx-row"><span className="hx-l">Шифра</span><input value={nw.code} onChange={(e) => setNw({ ...nw, code: e.target.value })} maxLength={40} placeholder="празно = следна слободна" aria-label="Шифра на комитентот" style={{ width: 170 }} /></label>
            <label className="hx-row"><span className="hx-l">ЕДБ</span><input value={nw.edb} onChange={(e) => setNw({ ...nw, edb: e.target.value })} maxLength={20} aria-label="ЕДБ на комитентот" style={{ width: 170 }} /></label>
            {err && <div className="hx-err" role="alert">{err}</div>}
            <div className="hx-row" style={{ justifyContent: 'flex-end', gap: 6 }}>
              <button type="button" className="hx-btn" disabled={busy} onClick={() => void create()}>Во ред (F9)</button>
              <button type="button" className="hx-btn" onClick={() => { setNw(null); setErr(''); }}>Назад (Esc)</button>
            </div>
            <div className="hx-hint">Другите податоци (адреса, сметки…) се дополнуваат во Комитенти.</div>
          </div>
        )}
      </div>
    </div>
  );
}
