'use client';
import { useActionState } from 'react';
import { changeMyPassword, type FormState } from './actions';

export function MyPassword() {
  const [st, action, pending] = useActionState<FormState, FormData>(changeMyPassword, {});
  return (
    <form action={action}>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      {st.ok && <div className="callout good" role="status">{st.ok}</div>}
      <div className="form">
        <label className="f">Сегашна лозинка<input name="old" type="password" autoComplete="current-password" required /></label>
        <label className="f">Нова лозинка<input name="new" type="password" autoComplete="new-password" required /></label>
        <label className="f">Повтори<input name="new2" type="password" autoComplete="new-password" required /></label>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="btn" disabled={pending}>Промени лозинка</button>
      </div>
    </form>
  );
}
