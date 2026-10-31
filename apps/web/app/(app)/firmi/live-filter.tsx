'use client';
/**
 * The search box of „Фирми“: the list filters while typing (no page reload), Latin = Cyrillic („bajrami“ finds
 * „БАЈРАМИ“). Rows carry their searchable text in `data-s`; Enter / „Прикажи“ still sends the form (PDF / Excel use it).
 */
import { useEffect, useRef } from 'react';
import { wordsMatch } from '@wise/core/firms/picker';

export function FirmLiveFilter({ table, defaultValue, placeholder }: { table: string; defaultValue: string; placeholder: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const apply = () => {
    const q = ref.current?.value ?? '';
    const rows = document.querySelectorAll<HTMLTableRowElement>(`#${table} tbody tr[data-s]`);
    let shown = 0;
    rows.forEach((r) => { const ok = wordsMatch([r.dataset.s], q); r.hidden = !ok; if (ok) shown++; });
    const none = document.querySelector<HTMLElement>(`#${table}-none`);
    if (none) none.hidden = shown > 0 || !rows.length;
  };
  useEffect(() => { ref.current?.focus(); apply(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <input ref={ref} name="q" defaultValue={defaultValue} placeholder={placeholder} onInput={apply} autoComplete="off" style={{ flex: 1, minWidth: 200 }} aria-label="Барај фирма" />;
}
