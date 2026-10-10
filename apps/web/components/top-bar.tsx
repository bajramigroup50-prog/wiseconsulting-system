'use client';
/**
 * Firm bar under the menu — legacy `.topbar` / `renderTop` (3685) with its runtime patches: „⏏ ИЗЛЕЗ ОД ФИРМАТА“
 * (12906), the law robot badge (`lawBadge` 14321 → robot 14392), the client-messages envelope (`msgTop` 14015), the
 * big notifications button (`alBell` 8607), the database pill (`#conn`) and the `teren` restrictions (CSS 166).
 */
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ROLES, type Role } from '@wise/core';
import { alBellState } from '@wise/core/firms/picker';
import { hrefFor, navFlat, type NavGroup } from '@/lib/nav';
import { logout } from '@/app/login/actions';
import { selectFirm, setYear } from '@/app/(app)/actions';
import { Robot, RobotCss } from '@/app/(app)/zakoni/robot';
import { AinbEnvelope } from './ainb';
import { FirmWindow } from './firm-window';

export interface TopFirm { id: string; name: string; edb: string | null; vatRegistered: boolean; lockDate: string | null }
export interface TopBarStatus { bell: { bad: number; warn: number; firstFirm: string | null } | null; ainb: number; law: number | null }

const dmy = (d: string) => d.split('-').reverse().join('.');

export function TopBar({ groups, user, year, minYear, firm, status, canFirms }: {
  groups: readonly NavGroup[]; user: { name: string; role: Role }; year: number; minYear?: number | null; firm: TopFirm | null;
  status: TopBarStatus; canFirms: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const [win, setWin] = useState(false);
  const [, start] = useTransition();
  const y = new Date().getFullYear();
  const y0 = Math.min(2012, y - 10, minYear ?? y);
  const years = Array.from({ length: y + 2 - y0 }, (_, i) => y + 1 - i);
  const view = path === '/' ? 'home' : path.split('/')[1];
  const teren = user.role === 'teren';
  const office = !teren && user.role !== 'klient';
  const B = status.bell ? alBellState(status.bell.bad, status.bell.warn) : null;
  const bell = () => {
    const fid = status.bell?.firstFirm;
    if (!firm && fid) start(async () => { await selectFirm(fid); router.push('/izvestuvanja'); });
    else router.push('/izvestuvanja');
  };

  return (
    <div className="topbar">
      <select className="menu-mob" id="navMob" aria-label="Мени" value={view} onChange={(e) => (e.target.value === 'izlezF' ? window.location.assign('/izlezF') : router.push(hrefFor(e.target.value)))}>
        {groups.map(([g, items]) => (
          <optgroup label={g} key={g}>
            {navFlat(items).map(([id, t], i) => <option key={i} value={id}>{t}</option>)}
          </optgroup>
        ))}
      </select>
      {!teren && <>
        <span className="meta">Фирма</span>
        <b id="firmName" className="firmname">{firm?.name ?? ''}</b>
        {firm
          ? <a className="btn" href="/izlezF" title="Излез од фирмата – враќање на изборот на фирма"
            style={{ marginLeft: 6, fontSize: 15, fontWeight: 700, padding: '7px 16px', border: '2px solid var(--accent)', color: 'var(--accent)' }}>⏏ ИЗЛЕЗ ОД ФИРМАТА</a>
          : <button className="btn sm" title="Промени фирма (посебен прозорец)" onClick={() => setWin(true)}>⇄ Промени фирма</button>}
        <span className="meta" id="firmMeta">
          {firm && `ЕДБ ${firm.edb || '—'} · ${firm.vatRegistered ? 'ДДВ обврзник' : 'Не е ДДВ обврзник'}${firm.lockDate ? ' · заклучено до ' + dmy(firm.lockDate) : ''}`}
        </span>
      </>}
      <span className="sp" />
      {office && status.law != null && <>
        <RobotCss />
        <button id="lawTop" type="button" title="Роботот за законски промени" onClick={() => router.push('/zakoni')}>
          <Robot size={46} alert={status.law > 0} id="rbt" />
          <span id="lawTopN" style={{ position: 'absolute', top: -2, right: -2, background: '#b42318', color: '#fff', borderRadius: 9, fontSize: 10, padding: '0 5px', fontWeight: 700, display: status.law ? '' : 'none' }}>{status.law || ''}</span>
        </button>
      </>}
      {office && <AinbEnvelope n={status.ainb} />}
      {office && B && (
        <button type="button" id="alTop" className={`al-top ${B.cls}`} title={B.title} onClick={bell}>
          {B.n ? <><span className="al-ic">⚠</span><span className="al-t">{B.label}</span><span className="al-n">{B.n}</span></> : <><span className="al-ic">✓</span><span className="al-t">{B.label}</span></>}
        </button>
      )}
      {!teren && <>
        <label htmlFor="yearSel" className="meta">Година</label>
        <select id="yearSel" style={{ width: 'auto' }} value={year}
          onChange={(e) => start(() => setYear(Number(e.target.value)))}>
          {years.map((v) => <option key={v}>{v}</option>)}
        </select>
      </>}
      <span className="pill good" id="conn">Базата е поврзана</span>
      <span id="userBox">
        <button className="btn sm ghost" title={ROLES[user.role].n} onClick={() => router.push('/korisnici')}>👤 {user.name}</button>
        <form action={logout} style={{ display: 'inline' }}><button className="btn sm">Одјава</button></form>
      </span>
      {win && <FirmWindow currentId={firm?.id ?? null} canFirms={canFirms} current={firm} onClose={() => setWin(false)} />}
    </div>
  );
}
