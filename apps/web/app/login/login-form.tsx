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
      <p className="note" style={{ margin: 0, fontSize: 12 }}>
        Од безбедносни причини најавата завршува кога ќе се затвори програмата / прелистувачот, по 60 минути без активност
        и најдоцна по 8 часа.
      </p>
      <div className="note" style={{ color: 'var(--bad)', minHeight: 18 }} role="alert">{err}</div>
      <button className="btn pri" type="submit" disabled={pending} style={{ width: '100%', justifyContent: 'center' }}>
        Најави се
      </button>
    </form>
  );
}
