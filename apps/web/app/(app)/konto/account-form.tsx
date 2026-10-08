'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import type { ActionState } from '@/lib/books';
import { saveAccount } from './actions';

/** Legacy `VIEWS.konto` 6826 draft card: Број / Назив. */
export function AccountForm({ code, name }: { code: string | null; name: string }) {
  const [st, action, pending] = useActionState<ActionState, FormData>(saveAccount, {});
  return (
    <form className="card" action={action}>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      {code && <input type="hidden" name="edit" value="1" />}
      <div className="form">
        <label className="f">Број<input name="code" defaultValue={code ?? ''} readOnly={!!code} inputMode="numeric" required /></label>
        <label className="f wide">Назив<input name="name" defaultValue={name} required autoFocus /></label>
      </div>
      <div className="row">
        <Link className="btn" href="/konto">Откажи</Link>
        <button className="btn pri" disabled={pending}>Зачувај</button>
      </div>
    </form>
  );
}
