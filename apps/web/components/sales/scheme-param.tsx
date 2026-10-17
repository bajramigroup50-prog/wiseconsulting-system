'use client';
/**
 * „Шема“ for a batch save („Зачувај ги сите спремни“): kept in the URL (`?sch=2`) so the server buttons of the page
 * pass it to their action. Empty = by the rules (the partner's default, else Шема 1).
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function SchemeParam({ schemes }: { schemes: { no: number; label: string }[] }) {
  const router = useRouter(), path = usePathname(), sp = useSearchParams();
  if (!schemes.length) return null;
  const set = (v: string) => {
    const q = new URLSearchParams(sp.toString());
    if (v) q.set('sch', v); else q.delete('sch');
    router.replace(`${path}${q.size ? '?' + q.toString() : ''}`, { scroll: false });
  };
  return (
    <label className="mini" title="Со која шема на книжење се книжат зачуваните фактури">Шема{' '}
      <select value={sp.get('sch') ?? ''} onChange={(e) => set(e.target.value)} style={{ width: 'auto' }} data-testid="batch-scheme">
        <option value="">Автоматски (според комитентот / Шема 1)</option>
        <option value="1">Шема 1 – основна</option>
        {schemes.map((s) => <option key={s.no} value={s.no}>{s.label}</option>)}
      </select>
    </label>
  );
}
