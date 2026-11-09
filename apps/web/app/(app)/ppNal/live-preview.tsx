'use client';
/**
 * The slip beside the payment-order editor, redrawn while typing / ticking invoices (it showed the last saved version
 * until „Зачувај“): reads the editor form on every input / change event.
 */
import { useEffect, useRef, useState } from 'react';
import type { PaymentOrder } from '@wise/core';
import { PpSlip } from '@/components/pp-slip';

const KEYS = ['date', 'valDate', 'nacin', 'code', 'payer', 'payerAcc', 'payerBank', 'payerTax', 'recip', 'recipAcc', 'recipBank', 'purpose', 'refDebit', 'refCredit', 'uplSm', 'prihod', 'place', 'taxKey'] as const;

export function LivePpPreview({ initial, sig }: { initial: PaymentOrder; /** the firm's signature / stamp (shown as on „🖊 Со потпис и печат“) */ sig?: { sign?: string | null; stamp?: string | null } | null }) {
  const [n, setN] = useState<PaymentOrder>(initial);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const form = box.current?.closest('form') ?? document.querySelector<HTMLFormElement>('form:has(input[name="kind"])');
    if (!form) return;
    const read = () => {
      const g = (k: string) => { const el = form.elements.namedItem(k) as HTMLInputElement | null; return el && 'value' in el ? el.value : undefined; };
      const next: PaymentOrder = { ...initial };
      for (const k of KEYS) { const v = g(k); if (v !== undefined) (next as unknown as Record<string, unknown>)[k] = v; }
      const a = g('amount');
      if (a !== undefined) { const x = Number(String(a).replace(/\s/g, '').replace(',', '.')); next.amount = a.trim() === '' || !isFinite(x) ? null : x; }
      const ib = form.elements.namedItem('iban') as HTMLInputElement | null;
      if (ib && ib.type === 'checkbox') next.iban = ib.checked;
      setN(next);
    };
    // after the field's own handlers (the IBAN switch rewrites the accounts in its change handler)
    const later = () => setTimeout(read, 0);
    form.addEventListener('input', later);
    form.addEventListener('change', later);
    read();
    return () => { form.removeEventListener('input', later); form.removeEventListener('change', later); };
  }, [initial]);
  return <div ref={box}><PpSlip n={n} sig={sig} /></div>;
}
