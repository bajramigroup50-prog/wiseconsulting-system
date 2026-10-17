'use client';
/**
 * Searchable partner picker for the bank line forms: typing in either script finds the partner („ВЕНГ“ → „VENG HAUS DOO
 * SKOPJE“, „veng“ → „ВЕНГ ХАУС“; `searchPartners`). Its own small list under the field (not the native datalist,
 * which covered the statement table). With `name` it posts the partner id in a hidden input (server forms).
 */
import { useId, useMemo, useRef, useState } from 'react';
import { searchPartners } from '@wise/core/partners/search';

export interface PickerPartner { id: string; code: string | null; name: string }

export const partnerLabel = (p: PickerPartner | undefined): string => (p ? (p.code ? `${p.code} · ` : '') + p.name : '');

export function PartnerPicker({ partners, name, value, onChange, placeholder, width, invalid, ariaLabel }: {
  partners: PickerPartner[]; name?: string; value?: string | null; onChange?: (id: string) => void;
  placeholder?: string; width?: number | string; invalid?: boolean; ariaLabel?: string;
}) {
  const byId = useMemo(() => new Map(partners.map((p) => [p.id, p])), [partners]);
  const [id, setId] = useState(value ?? '');
  const [text, setText] = useState(partnerLabel(byId.get(value ?? '')));
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const hits = useMemo(() => (open ? searchPartners(partners, text === partnerLabel(byId.get(id)) ? '' : text, 15) : []), [open, partners, text, id, byId]);

  const pick = (pid: string) => {
    setId(pid);
    setText(partnerLabel(byId.get(pid)));
    setOpen(false);
    onChange?.(pid);
  };

  return (
    <div ref={box} style={{ position: 'relative', display: 'inline-block', width: width ?? '100%', minWidth: 160 }}
      onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
      {name && <input type="hidden" name={name} value={id} />}
      <input value={text} aria-label={ariaLabel ?? 'Комитент'} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        placeholder={placeholder ?? 'комитент – пребарај (кирилица / латиница)'} autoComplete="off"
        style={{ width: '100%', ...(invalid && !id ? { borderColor: 'var(--bad)' } : {}) }}
        onFocus={() => { setOpen(true); setHi(0); }}
        onChange={(e) => { setText(e.target.value); setOpen(true); setHi(0); if (!e.target.value.trim() && id) { setId(''); onChange?.(''); } }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, hits.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter' && open && hits[hi]) { e.preventDefault(); pick(hits[hi]!.id); }
          else if (e.key === 'Escape') setOpen(false);
        }} />
      {open && (
        <ul id={listId} role="listbox" className="card"
          style={{ position: 'absolute', left: 0, top: '100%', zIndex: 40, margin: 0, padding: 4, listStyle: 'none', minWidth: '100%', width: 'max-content', maxWidth: 420, maxHeight: 260, overflowY: 'auto' }}>
          <li role="option" aria-selected={!id} tabIndex={-1} className="mut" style={{ padding: '3px 6px', cursor: 'pointer' }} onMouseDown={(e) => { e.preventDefault(); pick(''); }}>— без комитент —</li>
          {hits.map((p, i) => (
            <li key={p.id} role="option" aria-selected={p.id === id} tabIndex={-1}
              style={{ padding: '3px 6px', cursor: 'pointer', background: i === hi ? 'var(--accent-bg, #eef4ff)' : undefined, whiteSpace: 'nowrap' }}
              onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(p.id); }}>{partnerLabel(p)}</li>
          ))}
          {!hits.length && <li className="mut" style={{ padding: '3px 6px' }}>нема комитент „{text}“</li>}
        </ul>
      )}
    </div>
  );
}
