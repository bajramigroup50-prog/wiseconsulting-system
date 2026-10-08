'use client';
/**
 * A `<form>` bound to a server action `(prev, formData) => ActionState`, showing its error / ok message.
 * Children are the (server-rendered) inputs; `confirm` asks before submitting (deletes, flips…).
 */
import { useActionState } from 'react';

export interface FormState { error?: string; ok?: string }

export function BankForm({ action, children, className, style, confirm: ask, id }: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  confirm?: string;
  id?: string;
}) {
  const [st, run, pending] = useActionState<FormState, FormData>(action, {});
  return (
    <form id={id} className={className} style={style} action={run} aria-busy={pending}
      onSubmit={(e) => { if (ask && !window.confirm(ask)) e.preventDefault(); }}>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      {st.ok && <div className="callout good" role="status">{st.ok}</div>}
      <fieldset disabled={pending} style={{ display: 'contents' }}>{children}</fieldset>
    </form>
  );
}
