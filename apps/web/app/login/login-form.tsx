'use client';
import { useActionState } from 'react';
import { login } from './actions';

export function LoginForm() {
  const [err, action, pending] = useActionState(login, '');
  return (
    <form className="card login" action={action} autoComplete="on">
      <label className="f">Корисничко име
        <input name="username" required autoComplete="username" autoCapitalize="none" autoFocus />
      </label>
      <label className="f">Лозинка
        <input name="password" type="password" required autoComplete="current-password" />
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
        <input type="checkbox" name="remember" style={{ width: 'auto' }} /> Запамети ме на овој уред (30 дена)
      </label>
      <div className="note" style={{ color: 'var(--bad)', minHeight: 18 }} role="alert">{err}</div>
      <button className="btn pri" type="submit" disabled={pending} style={{ width: '100%', justifyContent: 'center' }}>
        Најави се
      </button>
    </form>
  );
}
