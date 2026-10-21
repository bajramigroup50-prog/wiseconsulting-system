'use client';
/** Search box over the partner list of the cards: filters the rows as you type (name, ЕДБ, code – Latin or Cyrillic). */
import { useEffect, useRef } from 'react';
import { latToCyr } from '@wise/core/text/cyr';

const norm = (s: string) => latToCyr(s).toUpperCase().replace(/\s+/g, ' ').trim();

export function KcListFilter() {
  const ref = useRef<HTMLInputElement>(null);
  const run = () => {
    const box = ref.current?.closest('.kclist');
    const q = norm(ref.current?.value ?? '');
    box?.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((tr) => {
      tr.style.display = !q || norm(tr.textContent ?? '').includes(q) || (tr.dataset.k ?? '').includes(q) ? '' : 'none';
    });
  };
  // the selected partner stays in view
  useEffect(() => { ref.current?.closest('.kclist')?.querySelector('tr.sel')?.scrollIntoView({ block: 'nearest' }); }, []);
  return (
    <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)' }}>
      <input ref={ref} type="search" placeholder="🔍 Барај комитент…" onInput={run} style={{ width: '100%' }} aria-label="Барај комитент" />
    </div>
  );
}
