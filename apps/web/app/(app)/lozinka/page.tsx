/**
 * Мојот профил / лозинка — legacy `VIEWS.korisnici` „Мојот профил“ card (5485), which is what a client opens from
 * „🔑 Мојот профил / лозинка“ (`klNav`): name · username · role and the password change (current / new / repeat).
 * Server addition (FIX: no clear-text initial passwords): after a reset the user must change the password here.
 */
import { ROLES } from '@wise/core';
import { requireUser } from '@/lib/auth';
import { Hd } from '@/components/hd';
import { MyPassword } from './my-password';
import { RowAction } from '@/components/row-action';
import { db } from '@/lib/db';
import { MENU_STYLE_LBL, menuStyleOf, type MenuStyle } from '@/lib/menu-style';
import { setMyMenuStyle } from './actions';

export default async function LozinkaPage() {
  const me = await requireUser();
  // P40 „Мени: класично / ново“ — each office user chooses their own (klient / teren menus are fixed)
  const office = me.role !== 'klient' && me.role !== 'teren';
  const style = office ? await menuStyleOf(db(), me.id).catch(() => 'new' as const) : null;
  return (
    <>
      <Hd t="Мојот профил" sub={me.username} exp={false} />
      {me.mustChangePassword && <div className="callout warn">Ова е привремена лозинка од канцеларијата – внесете ја и одберете своја нова лозинка.</div>}
      <div className="card">
        <h2>Мојот профил</h2>
        <p className="note">{me.name} · <b>{me.username}</b> · {ROLES[me.role].n}</p>
        <MyPassword />
      </div>
      {style && (
        <div className="card" id="meni">
          <h2>☰ Мени</h2>
          <p className="note">„Ново“: секој екран се појавува еднаш, законите и роковите се по еден екран со јазичиња, ретките работи за фирмите се под „⋯“. „Класично“: менито како во старата програма. Пристапот до екраните е ист во двете. Секој екран го наоѓате и со <kbd>Ctrl</kbd>+<kbd>K</kbd> (старо или ново име).</p>
          <div className="row" style={{ gap: 8 }} role="group" aria-label="Мени">
            {(['new', 'classic'] as MenuStyle[]).map((s) => (
              <RowAction key={s} action={setMyMenuStyle.bind(null, s)} label={`${style === s ? '✓ ' : ''}Мени: ${MENU_STYLE_LBL[s]}`} className={`btn ${style === s ? 'pri' : ''}`} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
