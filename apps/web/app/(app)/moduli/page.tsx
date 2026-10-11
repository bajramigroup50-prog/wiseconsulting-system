/**
 * Legacy `VIEWS.moduli` 10231 + patch 10531 — Модули по дејност: entity type (годишна сметка и даночни обрасци), the
 * firm's activity profiles (automatic from the NKD code or set by hand, „↺ Врати автоматски од шифрата“), every module
 * with its activities, automatic yes/no, the setting (автоматски / секогаш вклучен / исклучен) and the state, and the
 * overview of all firms (NKD, activity, manual mark, enabled modules).
 */
import Link from 'next/link';
import { asc } from 'drizzle-orm';
import { firmAllowed, YE_ENTITY_NAMES, yeEntityOf, yeLegalFormName } from '@wise/core';
import { firmProfiles, INDUSTRY_MODULES, moduleOnFor, nkdOf, nkdProfiles, profileName, PROFILES, profilesAuto } from '@wise/core/industry';
import { firmModuleState, firms } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { FirmGo } from '@/components/firm-go';
import { autoProfilesAction, saveEntityAction, saveModuleSetupAction } from './actions';

export default async function ModuliPage() {
  const { u, firm } = await booksPage('moduli');
  if (!firm) return <NoFirm t="Модули по дејност" />;
  const write = canDo(u, 'settings', firm.id) || canDo(u, 'write', firm.id);
  const n = nkdOf(firm.activity);
  const auto = nkdProfiles(firm.activity);
  const st = firmModuleState(firm);
  const P = st.profiles;
  const ent = yeEntityOf({ ent: (firm.settings as Record<string, unknown> | null)?.ent, legalForm: firm.legalForm, name: firm.name });
  const all = (await db().select({ id: firms.id, name: firms.name, mods: firms.mods, activity: firms.activity, ownerId: firms.ownerId, settings: firms.settings }).from(firms).orderBy(asc(firms.name)))
    .filter((f) => firmAllowed(u.principal, f.id, f.ownerId)).slice(0, 500);
  const kl = (f: { settings: unknown }) => ((f.settings ?? {}) as { kl?: { prof?: string[] | null; profSet?: boolean } }).kl;
  return (
    <>
      <Hd t="Модули по дејност" sub={firm.name}><Link className="btn" href="/klPortal">👥 Портал за клиенти</Link></Hd>
      <BankForm action={saveEntityAction} className="card">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Вид на субјект (одредува годишна сметка и даночни обрасци)</h2>
        <div className="row" style={{ gap: '6px 18px', flexWrap: 'wrap' }}>{(Object.entries(YE_ENTITY_NAMES) as [string, string][]).map(([k, nm]) => (
          <label key={k} className="chk" style={{ margin: 0 }}><input type="radio" name="ent" value={k} defaultChecked={ent === k} disabled={!write} style={{ width: 'auto' }} /> {nm}</label>))}</div>
        <p className="mini" style={{ margin: '6px 0 0' }}>{firm.legalForm ? <>Од правната форма на фирмата: <b>{yeLegalFormName(firm.legalForm)}</b> (се менува и во податоците на фирмата).</> : <>Автоматски препознаено од називот: <b>{YE_ENTITY_NAMES[ent]}</b>.</>} Според видот се прикажуваат: друштво → Биланс на успех/состојба, ДБ, ДБ-ВП; ТП / самостојна дејност → Образец Б и ДЛД-ДБ; НПО → Биланс на приходи и расходи, Биланс на состојба за НПО, ДБ-НП/ВП.</p>
        {write && <div className="row"><span style={{ flex: 1 }} /><button className="btn sm">Зачувај вид на субјект</button></div>}
      </BankForm>
      <BankForm action={saveModuleSetupAction}>
        <div className="card">
          <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Дејност</h2>
          <p style={{ margin: '0 0 8px' }}>Шифра на дејност (НКД): <b>{n ? n.c : '—'}</b> {firm.activity && !/^\s*\d/.test(firm.activity) ? firm.activity : ''} {n ? <>→ автоматски: <b>{auto.map(profileName).join(', ') || 'нема посебни модули'}</b></> : <span className="pill warn">внесете шифра на дејност кај фирмата</span>}</p>
          <div className="row" style={{ gap: '6px 18px', flexWrap: 'wrap' }}>{PROFILES.map(([k, nm]) => (
            <label key={k} className="chk" style={{ margin: 0 }}><input type="checkbox" name="prof" value={k} defaultChecked={P.includes(k)} disabled={!write} style={{ width: 'auto' }} /> {nm}</label>))}</div>
          <p className="mini" style={{ margin: '8px 0 0' }}>{st.auto ? <>✓ Дејноста се зема <b>автоматски од шифрата</b>.</> : <>Дејноста е <b>поставена рачно</b>. {write && <RowAction className="btn sm" action={autoProfilesAction} label="↺ Врати автоматски од шифрата" />}</>} Фирма може да има повеќе дејности (на пр. хотел + ресторан).</p>
        </div>
        <div className="card">
          <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Модули на фирмата</h2>
          <div className="tw"><table className="dense"><thead><tr><th>Модул</th><th>За дејност</th><th>Автоматски</th><th>Поставка</th><th>Состојба</th></tr></thead>
            <tbody>{INDUSTRY_MODULES.map((m) => {
              const a = m.p.some((p) => P.includes(p));
              const on = moduleOnFor(m.k, P, st.ov);
              const v = st.ov[m.k] == null ? '' : st.ov[m.k] ? '1' : '0';
              return (
                <tr key={m.k}><td>{m.n}</td><td className="mini">{m.p.map(profileName).join(', ')}</td><td>{a ? 'да' : 'не'}</td>
                  <td><select name={`mod.${m.k}`} defaultValue={v} disabled={!write} style={{ width: 'auto' }}><option value="">автоматски</option><option value="1">секогаш вклучен</option><option value="0">исклучен</option></select></td>
                  <td><span className={`pill ${on ? 'good' : ''}`}>{on ? 'вклучен' : 'исклучен'}</span></td></tr>);
            })}</tbody></table></div>
          <p className="note">Основните делови (фактури, влез/излез, залиха, благајна, банка, плати, ДДВ, налози, завршна сметка) ги имаат сите фирми. Модулите погоре се гледаат во менито <b>само кај фирмите што ги имаат вклучени</b> – кај клиентот; канцеларијата ги гледа сите модули во „Дејности“. Производството (нормативи, работни налози, MRP, реална цена, лотови) канцеларијата секогаш го гледа.</p>
          {write && <div className="row"><span style={{ flex: 1 }} /><button className="btn pri">Зачувај</button></div>}
        </div>
      </BankForm>
      <div className="card">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Преглед – сите фирми</h2>
        <div className="tw"><table className="dense"><thead><tr><th>Фирма</th><th>НКД</th><th>Дејност</th><th>Вклучени модули</th><th /></tr></thead>
          <tbody>{all.map((f) => (
            <tr key={f.id}><td>{f.name}</td><td>{nkdOf(f.activity)?.c ?? '—'}</td>
              <td className="mini">{firmProfiles(f.activity, kl(f)).map(profileName).join(', ') || '—'}{!profilesAuto(kl(f)) && <> <span className="pill">рачно</span></>}</td>
              <td className="mini">{INDUSTRY_MODULES.filter((m) => f.mods.includes(m.k)).map((m) => m.n.split(' ')[0]).join(' ') || 'само основни'}</td>
              <td>{f.id === firm.id ? <span className="pill info">тековна</span> : <FirmGo className="btn sm" fid={f.id} to="/moduli" current={firm.id}>Отвори</FirmGo>}</td></tr>
          ))}</tbody></table></div>
      </div>
    </>
  );
}
