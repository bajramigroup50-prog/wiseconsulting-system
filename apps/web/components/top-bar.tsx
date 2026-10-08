'use client';
/** Firm bar under the menu — legacy `.topbar` / `renderTop`. */
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ROLES, type Role } from '@wise/core';
import { hrefFor, navFlat, type NavGroup } from '@/lib/nav';
import { logout } from '@/app/login/actions';
import { setYear } from '@/app/(app)/actions';
import { FirmWindow } from './firm-window';

export interface TopFirm { id: string; name: string; edb: string | null; vatRegistered: boolean; lockDate: string | null }

const dmy = (d: string) => d.split('-').reverse().join('.');

export function TopBar({ groups, user, year, firm }: {
  groups: readonly NavGroup[]; user: { name: string; role: Role }; year: number; firm: TopFirm | null;
}) {
  const router = useRouter();
  const path = usePathname();
  const [win, setWin] = useState(false);
  const [, start] = useTransition();
  const y = new Date().getFullYear();
  const years = Array.from({ length: y + 2 - Math.min(2012, y - 10) }, (_, i) => y + 1 - i);
  const view = path === '/' ? 'home' : path.split('/')[1];

  return (
    <div className="topbar">
      <select className="menu-mob" id="navMob" aria-label="Мени" value={view} onChange={(e) => (e.target.value === 'izlezF' ? window.location.assign('/izlezF') : router.push(hrefFor(e.target.value)))}>
        {groups.map(([g, items]) => (
          <optgroup label={g} key={g}>
            {navFlat(items).map(([id, t], i) => <option key={i} value={id}>{t}</option>)}
          </optgroup>
        ))}
      </select>
      <span className="meta">Фирма</span>
      <b id="firmName" className="firmname">{firm?.name ?? ''}</b>
      <button className="btn sm" title="Промени фирма (посебен прозорец)" onClick={() => setWin(true)}>⇄ Промени фирма</button>
      <span className="meta" id="firmMeta">
        {firm && `ЕДБ ${firm.edb || '—'} · ${firm.vatRegistered ? 'ДДВ обврзник' : 'Не е ДДВ обврзник'}${firm.lockDate ? ' · заклучено до ' + dmy(firm.lockDate) : ''}`}
      </span>
      <span className="sp" />
      <label htmlFor="yearSel" className="meta">Година</label>
      <select id="yearSel" style={{ width: 'auto' }} value={year}
        onChange={(e) => start(() => setYear(Number(e.target.value)))}>
        {years.map((v) => <option key={v}>{v}</option>)}
      </select>
      <span id="userBox">
        <button className="btn sm ghost" title={ROLES[user.role].n} onClick={() => router.push('/korisnici')}>👤 {user.name}</button>
        <form action={logout} style={{ display: 'inline' }}><button className="btn sm">Одјава</button></form>
      </span>
      {win && <FirmWindow currentId={firm?.id ?? null} onClose={() => setWin(false)} />}
    </div>
  );
}
