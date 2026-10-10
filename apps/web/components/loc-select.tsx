'use client';
/** A `<select>` that re-renders the page with `?<param>=<value>` (legacy `locSel` + `onchange → render()`). */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function LocSelect({ label, param, value, options, keep = false, empty }: {
  label?: string; param: string; value: string; options: { value: string; label: string }[];
  /** Keep the other query parameters. */
  keep?: boolean;
  /** Label of an empty first option (e.g. „Сите продавници“). */
  empty?: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const sel = (
    <select value={value} onChange={(e) => {
      const q = new URLSearchParams(keep ? sp.toString() : '');
      if (e.target.value) q.set(param, e.target.value); else q.delete(param);
      router.push(`${path}${q.size ? '?' + q.toString() : ''}`);
    }}>
      {empty !== undefined && <option value="">{empty}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  return label ? <label className="f">{label}{sel}</label> : sel;
}
