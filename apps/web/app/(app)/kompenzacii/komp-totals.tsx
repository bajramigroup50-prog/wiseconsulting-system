'use client';
/** Legacy `kompTot` footer 8939 / 8944: Побарувања (П 1200) / Обврски (Д 2200) / Разлика, live while typing. */
import { useEffect, useRef, useState } from 'react';
import { fmt } from '@/lib/fmt';

const n = (s: string) => Number(String(s).replace(/\s/g, '').replace(',', '.')) || 0;

export function KompTotals() {
  const ref = useRef<HTMLTableSectionElement>(null);
  const [t, setT] = useState({ rec: 0, pay: 0 });
  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const calc = () => {
      let rec = 0, pay = 0;
      form.querySelectorAll<HTMLInputElement>('input[data-side]').forEach((x) => { if (x.dataset.side === 'rec') rec += n(x.value); else pay += n(x.value); });
      setT({ rec: Math.round(rec * 100) / 100, pay: Math.round(pay * 100) / 100 });
    };
    calc();
    form.addEventListener('input', calc);
    return () => form.removeEventListener('input', calc);
  }, []);
  const d = Math.round((t.rec - t.pay) * 100) / 100;
  return (
    <tfoot ref={ref}>
      <tr><td colSpan={6}>Побарувања (П 1200)</td><td className="n">{fmt(t.rec)}</td></tr>
      <tr><td colSpan={6}>Обврски (Д 2200)</td><td className="n">{fmt(t.pay)}</td></tr>
      <tr><td colSpan={6}>Разлика</td><td className="n" style={d ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{fmt(d)}</td></tr>
    </tfoot>
  );
}
