'use client';
/**
 * Legacy `cvSave` form wrapper: asks „VIN обично има 17 знаци (внесени N). Сепак да се зачува?“ before posting a VIN
 * of another length (the duplicate plate / VIN check is on the server, `@wise/core` `vehicleProblems`).
 */
import { useActionState } from 'react';
import { vinWarning } from '@wise/core/industry';
import type { FormState } from './bank-form';

export function VehicleForm({ action, children, className }: { action: (p: FormState, f: FormData) => Promise<FormState>; children: React.ReactNode; className?: string }) {
  const [st, run, pending] = useActionState<FormState, FormData>(action, {});
  return (
    <form className={className} action={run} aria-busy={pending} onSubmit={(e) => {
      const vin = String(new FormData(e.currentTarget).get('vin') ?? '').trim();
      const w = vinWarning(vin);
      if (w && !window.confirm(w + ' Сепак да се зачува?')) e.preventDefault();
    }}>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      {st.ok && <div className="callout good" role="status">{st.ok}</div>}
      <fieldset disabled={pending} style={{ display: 'contents' }}>{children}</fieldset>
    </form>
  );
}
