'use client';
/** A form bound to a server action with a result line (error / ok), optional confirmation and submit label. */
import { useActionState } from 'react';

export interface FormResult { error?: string; ok?: string }

export function ActionForm({ action, children, submit, confirm: ask, className = 'card', style, submitClass = 'btn pri' }: {
  action: (prev: FormResult, form: FormData) => Promise<FormResult>;
  children: React.ReactNode;
  submit?: string;
  confirm?: string;
  className?: string;
  style?: React.CSSProperties;
  submitClass?: string;
}) {
  const [st, act, pending] = useActionState<FormResult, FormData>(action, {});
  return (
    <form action={act} className={className} style={style} onSubmit={ask ? (e) => { if (!window.confirm(ask)) e.preventDefault(); } : undefined}>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      {st.ok && <div className="callout good" role="status">{st.ok}</div>}
      {children}
      {submit && <div className="row" style={{ marginTop: 8 }}><button className={submitClass} disabled={pending}>{pending ? '…' : submit}</button></div>}
    </form>
  );
}
