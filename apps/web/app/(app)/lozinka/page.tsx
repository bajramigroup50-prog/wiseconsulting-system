/**
 * Мојот профил / лозинка — legacy `VIEWS.korisnici` „Мојот профил“ card (5485), which is what a client opens from
 * „🔑 Мојот профил / лозинка“ (`klNav`): name · username · role and the password change (current / new / repeat).
 * Server addition (FIX: no clear-text initial passwords): after a reset the user must change the password here.
 */
import { ROLES } from '@wise/core';
import { requireUser } from '@/lib/auth';
import { Hd } from '@/components/hd';
import { MyPassword } from '../korisnici/my-password';

export default async function LozinkaPage() {
  const me = await requireUser();
  return (
    <>
      <Hd t="Мојот профил" sub={me.username} exp={false} />
      {me.mustChangePassword && <div className="callout warn">Ова е привремена лозинка од канцеларијата – внесете ја и одберете своја нова лозинка.</div>}
      <div className="card">
        <h2>Мојот профил</h2>
        <p className="note">{me.name} · <b>{me.username}</b> · {ROLES[me.role].n}</p>
        <MyPassword />
      </div>
    </>
  );
}
