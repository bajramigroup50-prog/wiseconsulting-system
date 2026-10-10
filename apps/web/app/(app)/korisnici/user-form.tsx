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
  const [show, setShow] = useState(false);
  const shown = q ? allFirms.filter((f) => f.name.toLowerCase().includes(q.toLowerCase())) : allFirms;
  return (
    <form className="card" action={action} autoComplete="off">
      {d && <input type="hidden" name="id" value={d.id} />}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 2, paddingBottom: 6 }}>
        <h2 style={{ margin: 0 }}>{d ? 'Измена: ' + d.name : 'Нов корисник'}</h2>
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn" href="/korisnici">Откажи</Link>
          <button className="btn pri" disabled={pending}>{pending ? 'Се зачувува…' : '✓ Зачувај'}</button>
        </div>
      </div>
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
        {/* Browsers autofill a saved (admin) password into any password field; these stay read-only until clicked. */}
        <label className="f">{d ? 'Нова лозинка (празно = без промена)' : 'Привремена лозинка'}
          <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
            <input name="pwNew" type={show ? 'text' : 'password'} autoComplete="new-password" readOnly onFocus={(e) => { e.currentTarget.readOnly = false; }} defaultValue="" data-lpignore="true" />
            <button type="button" className="btn sm" title="Прикажи / скриј" onClick={() => setShow(!show)}>👁</button>
          </span>
        </label>
        <label className="f">Потврди лозинка<input name="pwNew2" type={show ? 'text' : 'password'} autoComplete="new-password" readOnly onFocus={(e) => { e.currentTarget.readOnly = false; }} defaultValue="" data-lpignore="true" /></label>
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
        <div className="ufirms" style={{ maxHeight: 300, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8, padding: 8 }}>
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
