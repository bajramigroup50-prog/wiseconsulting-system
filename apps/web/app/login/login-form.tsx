'use client';
import { useActionState, useState } from 'react';
import { login } from './actions';

const MFA_ASK = '§2FA§';

export function LoginForm() {
  const [res, action, pending] = useActionState(login, '');
  // controlled: the password stays filled for the 2nd step (the code)
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const mfa = res.startsWith(MFA_ASK);
  const msg = mfa ? res.slice(MFA_ASK.length) : res;
  return (
    <form className="card login" action={action} autoComplete="on">
      <div style={mfa ? { display: 'none' } : undefined}>
        <label className="f">Корисничко име
          <input name="username" required autoComplete="username" autoCapitalize="none" autoFocus value={user} onChange={(e) => setUser(e.target.value)} />
        </label>
        <label className="f">Лозинка
          <input name="password" type="password" required autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
        </label>
      </div>
      {mfa && (
        <label className="f">🔐 Код од телефонот (6 цифри)
          <input name="code" required autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={9} placeholder="123456"
            style={{ fontSize: 22, letterSpacing: '.3em', textAlign: 'center' }} />
          <span className="mini">Изгубен телефон? Внесете еден од резервните кодови (на пр. ABCD-EFGH).</span>
        </label>
      )}
      {!mfa && (
        <p className="note" style={{ margin: 0, fontSize: 12 }}>
          Од безбедносни причини најавата завршува кога ќе се затвори програмата / прелистувачот, по 60 минути без активност
          и најдоцна по 8 часа.
        </p>
      )}
      <div className="note" style={{ color: mfa && !/Погрешен/.test(msg) ? 'var(--ink)' : 'var(--bad)', minHeight: 18 }} role="alert">{msg}</div>
      <button className="btn pri" type="submit" disabled={pending} style={{ width: '100%', justifyContent: 'center' }}>
        {mfa ? 'Потврди' : 'Најави се'}
      </button>
      {mfa && <button type="button" className="btn ghost" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} onClick={() => window.location.reload()}>← Назад</button>}
    </form>
  );
}
