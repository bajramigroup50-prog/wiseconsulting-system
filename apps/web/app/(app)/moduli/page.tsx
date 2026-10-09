/**
 * Legacy `VIEWS.moduli` 10231 → 10531 — Модули по дејност: which industry modules the firm uses. A switched-off module
 * disappears from the menu and its routes are blocked for every role (FIX LEGACY-MAP 10.4 item 9).
 */
import { INDUSTRY_MODULES, nkdOf, nkdProfiles, profileName, suggestedModules } from '@wise/core/industry';
import { firms } from '@wise/db';
import { asc } from 'drizzle-orm';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { firmAllowed } from '@wise/core';
import { saveModulesAction, suggestModulesAction } from './actions';

export default async function ModuliPage() {
  const { u, firm } = await booksPage('moduli');
  if (!firm) return <NoFirm t="Модули по дејност" />;
  const write = canDo(u, 'settings', firm.id) || canDo(u, 'write', firm.id);
  const n = nkdOf(firm.activity);
  const auto = nkdProfiles(firm.activity);
  const sugg = suggestedModules(auto);
  const all = (await db().select({ id: firms.id, name: firms.name, mods: firms.mods, activity: firms.activity, ownerId: firms.ownerId }).from(firms).orderBy(asc(firms.name)))
    .filter((f) => firmAllowed(u.principal, f.id, f.ownerId)).slice(0, 500);
  return (
    <>
      <Hd t="Модули по дејност" sub={firm.name} />
      <div className="card">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Дејност</h2>
        <p style={{ margin: '0 0 8px' }}>Шифра на дејност (НКД): <b>{n ? n.c : '—'}</b> {n ? <>→ предлог: <b>{auto.map(profileName).join(', ') || 'нема посебни модули'}</b></> : <span className="pill warn">внесете шифра на дејност кај фирмата</span>}</p>
        {write && sugg.length > 0 && <RowAction className="btn" action={suggestModulesAction} label="↺ Вклучи ги модулите според дејноста" />}
      </div>
      <BankForm action={saveModulesAction} className="card">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Модули на фирмата</h2>
        <div className="tw"><table className="dense"><thead><tr><th>Вклучен</th><th>Модул</th><th>За дејност</th><th>Предлог</th></tr></thead>
          <tbody>{INDUSTRY_MODULES.map((m) => (
            <tr key={m.k}>
              <td><input type="checkbox" name="mod" value={m.k} defaultChecked={firm.mods.includes(m.k)} disabled={!write} style={{ width: 'auto' }} /></td>
              <td>{m.n}</td><td className="mini">{m.p.map(profileName).join(', ')}</td><td>{sugg.includes(m.k) ? 'да' : ''}</td>
            </tr>
          ))}</tbody></table></div>
        <p className="note">Основните делови (фактури, влез/излез, залиха, благајна, банка, плати, ДДВ, налози, завршна сметка) ги имаат сите фирми. Модулите погоре се гледаат во менито <b>само кај фирмите што ги имаат вклучени</b> – и кај канцеларијата и кај клиентот. Производството (MRP, лотови) канцеларијата секогаш го гледа.</p>
        {write && <div className="row"><span style={{ flex: 1 }} /><button className="btn pri">Зачувај</button></div>}
      </BankForm>
      <div className="card">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Преглед – сите фирми</h2>
        <div className="tw"><table className="dense"><thead><tr><th>Фирма</th><th>НКД</th><th>Вклучени модули</th></tr></thead>
          <tbody>{all.map((f) => (
            <tr key={f.id}><td>{f.name}{f.id === firm.id && <span className="pill info" style={{ marginLeft: 6 }}>тековна</span>}</td><td>{nkdOf(f.activity)?.c ?? '—'}</td>
              <td className="mini">{INDUSTRY_MODULES.filter((m) => f.mods.includes(m.k)).map((m) => m.n.split(' ')[0]).join(' ') || 'само основни'}</td></tr>
          ))}</tbody></table></div>
      </div>
    </>
  );
}
