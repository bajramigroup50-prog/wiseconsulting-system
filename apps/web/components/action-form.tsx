'use client';
/** A `<form>` bound to a server action `(prev, FormData) => ActionState`, showing its error / ok message. */
import { useActionState, useEffect, useRef } from 'react';
import type { RowResult } from './row-action';

export function ActionForm({ action, children, className = 'card', reset = true, style }: {
  action: (prev: RowResult, form: FormData) => Promise<RowResult>;
  children: React.ReactNode;
  className?: string;
  /** Clear the inputs after a successful submit. */
  reset?: boolean;
  style?: React.CSSProperties;
}) {
  const [st, run, pending] = useActionState<RowResult, FormData>(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (st.ok && reset) ref.current?.reset(); }, [st, reset]);
  return (
    <form ref={ref} className={className} action={run} style={style} aria-busy={pending}>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      {st.ok && <div className="callout good" role="status">{st.ok}</div>}
      {children}
    </form>
  );
}

/** Submit button that disables itself while the form's action runs. */
export function Submit({ children, className = 'btn pri', name, value }: { children: React.ReactNode; className?: string; name?: string; value?: string }) {
  return <button className={className} name={name} value={value}>{children}</button>;
}
