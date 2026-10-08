'use client';
/** Small client helpers for the stock pages: print the `.printarea` (legacy print CSS `body.printing`), form wrapper. */
import { useActionState } from 'react';
import type { ActionState } from '@/lib/books';

/** Print only the `.printarea` part of the page with the browser's print-to-PDF (legacy `pdfOut` → print view). */
export function PrintButton({ label = 'PDF / Печати', className = 'btn pri' }: { label?: string; className?: string }) {
  return (
    <button type="button" className={className} onClick={() => {
      document.body.classList.add('printing');
      const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
      window.addEventListener('afterprint', done);
      window.print();
      setTimeout(done, 1500);
    }}>{label}</button>
  );
}

/** A form bound to a server action with an error / ok callout. */
export function ActionForm({ action, children, className = 'card', okText }: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  okText?: string;
}) {
  const [st, run, pending] = useActionState<ActionState, FormData>(action, {});
  return (
    <form className={className} action={run}>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      {st.ok && !st.error && okText && <div className="callout good">{okText}</div>}
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0 }}>{children}</fieldset>
    </form>
  );
}
