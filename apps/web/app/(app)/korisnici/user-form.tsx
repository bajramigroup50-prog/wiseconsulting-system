'use client';
/** Legacy `userForm`. */
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { ROLES, ROLE_IDS, type Role } from '@wise/core';
import { saveUser, type FormState } from './actions';

interface EditUser { id: string; name: string; username: string; email: string | null; role: Role; active: boolean; allFirms: boolean; firms: string[] }

export function UserForm({ user: d, allFirms, isSelf }: { user: EditUser | null; allFirms: { id: string; name: string }[]; isSelf: boolean }) {
  const [st, action, pending] = useActionState<FormState, FormData>(saveUser, {});
  const [role, setRole] = useState<Role>(d?.role ?? 'acc');
  const [all, setAll] = useState(d?.allFirms ?? false);
  const [q, setQ] = useState('');
  const shown = q ? allFirms.filter((f) => f.name.toLowerCase().includes(q.toLowerCase())) : allFirms;
  return (
    <form className="card" action={action}>
      {d && <input type="hidden" name="id" value={d.id} />}
      <h2>{d ? 'Измена: ' + d.name : 'Нов корисник'}</h2>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      <div className="form">
        <label className="f">Име и презиме<input name="name" defaultValue={d?.name ?? ''} required /></label>
        <label className="f">Корисничко име<input name="username" defaultValue={d?.username ?? ''} autoCapitalize="none" required /></label>
        <label className="f">Е-пошта<input name="email" type="email" defaultValue={d?.email ?? ''} /></label>
        <label className="f">Улога
          <select name="role" value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={isSelf}>
            {ROLE_IDS.map((k) => <option key={k} value={k}>{ROLES[k].n}</option>)}
          </select>
          {isSelf && <input type="hidden" name="role" value={role} />}
        </label>
        <label className="f">{d ? 'Нова лозинка (празно = без промена)' : 'Привремена лозинка'}<input name="password" type="password" autoComplete="new-password" /></label>
        <label className="f" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" name="active" defaultChecked={d?.active ?? true} style={{ width: 'auto' }} disabled={isSelf} /> Активен
          {isSelf && <input type="hidden" name="active" value="on" />}
        </label>
      </div>
      <p className="note">{ROLES[role].d}</p>
      <h3 style={{ margin: '12px 0 6px' }}>Фирми до кои има пристап</h3>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
        <input type="checkbox" name="allFirms" checked={all} onChange={(e) => setAll(e.target.checked)} style={{ width: 'auto' }} /> Сите фирми (и идните)
      </label>
      <div hidden={all}>
        <input placeholder="🔍 Филтрирај фирми…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320, marginTop: 6 }} />
        <div className="ufirms">
          {allFirms.map((f) => (
            <label key={f.id} hidden={!shown.includes(f)}>
              <input type="checkbox" name="firms" value={f.id} defaultChecked={d?.firms.includes(f.id)} style={{ width: 'auto' }} /> {f.name}
            </label>
          ))}
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10, gap: 8 }}>
        <Link className="btn" href="/korisnici">Откажи</Link>
        <button className="btn pri" disabled={pending}>Зачувај</button>
      </div>
    </form>
  );
}
