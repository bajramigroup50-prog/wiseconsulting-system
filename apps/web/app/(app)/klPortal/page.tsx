/**
 * Legacy `VIEWS.klPortal` 9074 — client portal of the firm: „📥 Пристигнато“, the warning callout, the firm's
 * activity profiles (auto from the NKD code or set by hand), which sections the client sees (Стандардно / ★
 * препорачано / module off), „Само основно“ / „+ Вклучи ги препорачаните ★“, the store-door notice (`klNoteForm`
 * → `klNotePdf`) and the client users of the firm.
 */
import Link from 'next/link';
import { and, eq, sql } from 'drizzle-orm';
import { KL_BASEC, KL_PROF, KL_SEC, firmProfiles, klModuleOff, klRecommended, klSections, profilesAuto, type KlConfig } from '@wise/core/office';
import { KL_INSP, klInspDefault } from '@wise/core/firms/klnote';
import { nkdOf } from '@wise/core/industry/modules';
import { appSettings, clientEntries, inboxItems, users, userFirms } from '@wise/db';
import { db } from '@/lib/db';
import { officePage } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { UploadField } from '@/components/upload-field';
import { addRecommended, onlyBase, removeNoticeImage, saveNote, saveProfiles, saveSections, setNoticeImage, NOTICE_KEY } from './actions';

export default async function KlPortalPage() {
  const { firm } = await officePage('klPortal', { perm: 'office' });
  if (!firm) return <NoFirm t="Портал за клиенти" />;
  const kl = (firm.settings as { kl?: KlConfig }).kl ?? {};
  const P = firmProfiles(kl, firm.activity);
  const act = new Set(klSections(kl, firm.mods).map((s) => s[0]));
  const N = kl.note ?? {};
  const sel = N.insp ?? klInspDefault(kl.prof ?? []);
  const [clients, [nIn], [img]] = await Promise.all([
    db().select({ name: users.name, username: users.username, active: users.active, last: users.lastLoginAt })
      .from(users).innerJoin(userFirms, eq(userFirms.userId, users.id)).where(and(eq(userFirms.firmId, firm.id), eq(users.role, 'klient'))),
    db().select({ n: sql<number>`(select count(*)::int from ${inboxItems} where ${inboxItems.firmId} = ${firm.id} and not ${inboxItems.done} and not ${inboxItems.fromOffice}) + (select count(*)::int from ${clientEntries} where ${clientEntries.firmId} = ${firm.id} and ${clientEntries.status} = 'pending')` }).from(sql`(select 1) x`),
    db().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, NOTICE_KEY)).limit(1),
  ]);
  const imgId = (img?.value as { fileId?: string } | undefined)?.fileId;

  return (
    <>
      <Hd t="Портал за клиенти" sub={firm.name}>
        <Link className="btn" href="/klInbox">📥 Пристигнато{nIn?.n ? ` (${nIn.n})` : ''}</Link>
        <Link className="btn pri" href="/klHome" title="Почетната страница како што ја гледа клиентот">👁 Види како клиент</Link>
      </Hd>
      <div className="callout warn">Клиентите се најавуваат со улога <b>„Клиент“</b> (Систем → Корисници) и гледаат само своја фирма. Серверот ги одбива страниците и акциите што не се вклучени за клиентот.</div>
      <ActionForm action={saveProfiles} reset={false}>
        <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Дејност на фирмата</h2>
        <div className="row" style={{ gap: '6px 18px', flexWrap: 'wrap' }}>
          {KL_PROF.map(([k, n]) => <label key={k} className="chk" style={{ margin: 0 }}><input type="checkbox" name="prof" value={k} defaultChecked={P.includes(k)} /> {n}</label>)}
        </div>
        <p className="mini" style={{ margin: '8px 0 0' }}>{profilesAuto(kl) ? `✓ Автоматски од шифрата на дејност ${nkdOf(firm.activity)?.c ?? '—'}.` : 'Поставено рачно.'} Секој дел може рачно да се вклучи или исклучи подолу. Модулите (хотел, сервис, градежништво…) се во <Link href="/moduli">🧩 Модули по дејност</Link>.</p>
        <div className="row" style={{ marginTop: 8 }}><button className="btn sm pri">Зачувај дејност</button></div>
      </ActionForm>
      <ActionForm action={saveSections} reset={false}>
        <div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>Што гледа клиентот</h2>
          <div className="row" style={{ gap: 6 }}>
            <RowAction action={onlyBase} label="Само основно" className="btn sm" />
            <RowAction action={addRecommended} label="+ Вклучи ги препорачаните ★" className="btn sm" />
          </div>
        </div>
        <p className="note" style={{ margin: '4px 0 8px' }}>Основно секој клиент гледа: документи на фирмата, испраќање документи, КДФИ и МЕТГ. Сè друго (фактури, налози, состојба, лагер, модули…) го гледа <b>само ако вие го вклучите</b>.</p>
        <div className="tw"><table className="dense">
          <thead><tr><th>Дел</th><th>Опис</th><th>Стандардно</th><th>Препорака за дејноста</th><th>Клиентот гледа</th></tr></thead>
          <tbody>{KL_SEC.map((s) => {
            const off = klModuleOff(s, firm.mods);
            return (
              <tr key={s[0]} style={off ? { opacity: 0.45 } : undefined}>
                <td>{s[2]} <b>{s[1]}</b></td><td><span className="mini">{s[5]}</span></td>
                <td>{KL_BASEC.includes(s[0]) ? <b>основно</b> : <span className="mini">по ваша одлука</span>}</td>
                <td>{klRecommended(s, P) && !KL_BASEC.includes(s[0]) ? '★ препорачано' : ''}</td>
                <td>{off ? 'модулот е исклучен' : <input type="checkbox" name="on" value={s[0]} defaultChecked={act.has(s[0])} />}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
        <div className="row" style={{ marginTop: 8 }}><button className="btn pri">Зачувај</button></div>
      </ActionForm>
      <ActionForm action={saveNote} reset={false}>
        <div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>🖨 Известување за продавницата (на врата)</h2></div>
        <p className="note" style={{ margin: '0 0 8px' }}>„Побарајте фискална сметка“ со бројот 198 на УЈП е задолжителниот дел. Инспекторатите за пријава се избираат според дејноста (ДПИ секогаш, за угостителство и храна и АХВ и санитарниот). Проверете ги броевите пред печатење.</p>
        <div className="form">
          <label className="f">Продажен објект (адреса)<input name="obj" defaultValue={N.obj || firm.address || ''} /></label>
          <label className="f">Работно време<input name="hrs" defaultValue={N.hrs ?? ''} placeholder="пон–саб 08:00–20:00" /></label>
          <label className="f">УЈП – пријава неправилности<input name="ujp2" defaultValue={N.ujp2 || '198'} /></label>
          <label className="f">УЈП – бесплатен телефон (празно = не се печати)<input name="ujp" defaultValue={N.ujp ?? ''} placeholder="0800 33 000" /></label>
        </div>
        <div style={{ margin: '10px 0 4px' }}><b style={{ fontSize: 13 }}>Инспекторати на известувањето</b></div>
        <div className="row" style={{ gap: '4px 18px', flexWrap: 'wrap' }}>
          {KL_INSP.map((x) => <label key={x[0]} className="chk" style={{ margin: 0 }}><input type="checkbox" name="insp" value={x[0]} defaultChecked={sel.includes(x[0])} /> {x[1]}{x[3] ? ' · ' + x[3] : ''}</label>)}
        </div>
        <label className="chk" style={{ margin: '10px 0' }}><input type="checkbox" name="sq" defaultChecked={!!N.sq} /> Двојазично (македонски / албански)</label>
        <div className="row" style={{ gap: 8 }}><span style={{ flex: 1 }} /><button className="btn">Зачувај</button><a className="btn pri" href="/print/klNote" target="_blank">🖨 Печати (PDF A4)</a></div>
      </ActionForm>
      <ActionForm action={setNoticeImage}>
        <div style={{ margin: '0 0 4px' }}><b style={{ fontSize: 13 }}>Налепница „Побарај фискална сметка“</b></div>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {imgId ? <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files/${imgId}`} alt="" style={{ height: 70, border: '1px solid var(--line)', borderRadius: 6 }} />
            <span className="mini">се користи оригиналната слика</span>
            <RowAction action={removeNoticeImage} label="✕ Отстрани (врати го дизајнот)" className="btn sm" />
          </> : <span className="mini">Се печати верна изработка на налепницата на УЈП. Ако ја имате оригиналната датотека (слика), прикачете ја и ќе се печати таа.</span>}
          <UploadField firmId={null} accept="image/*" label="🖼 Прикачи оригинал (PNG/JPG)" />
          <button className="btn sm">Зачувај слика</button>
        </div>
      </ActionForm>
      <div className="card">
        <div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>Корисници – клиенти на оваа фирма ({clients.length})</h2><Link className="btn sm pri" href="/klProfili">+ Нов корисник за клиентот</Link></div>
        {clients.length ? <div className="tw"><table className="dense"><thead><tr><th>Име</th><th>Корисник</th><th>Статус</th><th>Последна најава</th></tr></thead><tbody>
          {clients.map((c) => <tr key={c.username}><td>{c.name}</td><td>{c.username}</td><td>{c.active ? 'активен' : 'неактивен'}</td><td>{c.last ? c.last.toISOString().slice(0, 10).split('-').reverse().join('.') : '—'}</td></tr>)}
        </tbody></table></div>
          : <p className="note" style={{ margin: 0 }}>Нема. Додадете со „+ Нов корисник за клиентот“ или Фирми → 🔑 Профили на клиенти.</p>}
      </div>
    </>
  );
}
