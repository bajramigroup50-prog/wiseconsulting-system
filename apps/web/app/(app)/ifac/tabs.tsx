/**
 * 🤝 IFAC – the office-wide tabs: 🏛 the ISQM 1 system (nine components, each with owner, sign-off, evidence and
 * version), 👥 the employees (competence per role, licence, CPD hours – IES 7), 🧭 the IESBA declaration with the
 * clients worked on, 🎯 the readiness for the ИСОС quality-control review.
 */
import Link from 'next/link';
import { ethicsText } from '@wise/core/office/ifac';
import {
  CPD_MIN_3Y, CPD_MIN_YEAR, formMeta, IFAC_FILE_ENTITY, roleCompetence, SQM_COMPONENTS, sqmComp, sqmStatus, staffNormalize, staffStatus, type SqmData,
} from '@wise/core/office/ifac-sqm';
import { ROLES, type Role } from '@wise/core';
import { ifacGet, ifacReadinessFor, ifacYear, sqmYear } from '@wise/db';
import { db } from '@/lib/db';
import { allowedFirms, filesOf } from '@/lib/office';
import type { SessionUser } from '@/lib/auth';
import { ActionForm, Submit } from '@/components/action-form';
import { FileChips } from '@/components/file-chips';
import { dmy } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { UploadField } from '@/components/upload-field';
import { ethicsSign, sqmSave, sqmStarter, staffSave } from './actions';

type Staff = { id: string; name: string; role: string }[];

/** „в. 3 · Ана · 20.10.2026 11:40“ – who, when and the version of a saved form. */
export function Meta({ d, staff }: { d: Record<string, unknown> | null | undefined; staff: Staff }) {
  const m = formMeta(d);
  if (!m.v) return <span className="mini">не е зачувано</span>;
  const loc = m.at ? new Date(m.at).toLocaleString('sv-SE', { timeZone: 'Europe/Skopje' }) : '';
  return <span className="mini">верзија {m.v} · {staff.find((x) => x.id === m.by)?.name ?? '—'} · {loc ? `${dmy(loc.slice(0, 10))} ${loc.slice(11, 16)}` : ''}</span>;
}

const Who = ({ name, v, staff }: { name: string; v: string | null | undefined; staff: Staff }) => (
  <select name={name} defaultValue={v ?? ''}><option value="">—</option>{staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
);
const ok = (b: boolean, t = '✓', f = '!') => <span className={`pill ${b ? 'good' : 'warn'}`}>{b ? t : f}</span>;

/* ---------------- 🏛 ISQM 1 system ---------------- */

export async function TabSqm({ year, comp, staff, canEdit }: { year: number; comp?: string; staff: Staff; canEdit: boolean }) {
  const S = await db().transaction((tx) => sqmYear(tx, year));
  const F = await filesOf(IFAC_FILE_ENTITY, [...S.values()].map((r) => r.id));
  const c = sqmComp(comp ?? '');
  const row = c ? S.get(c.k) : undefined;
  const d = (row?.data ?? null) as SqmData | null;
  const st = (k: string) => { const r = S.get(k); return sqmStatus(sqmComp(k)!, (r?.data ?? null) as SqmData | null, r ? F.get(r.id)?.length ?? 0 : 0); };
  return (
    <>
      <div className="card">
        <div className="hd"><h2 style={{ margin: 0 }}>🏛 Систем за управување со квалитет – {year}</h2>
          <div className="row" style={{ gap: 6 }}>
            {canEdit && S.size < SQM_COMPONENTS.length && <RowAction action={sqmStarter.bind(null, year)} label="📘 Пополни почетен текст" className="btn sm pri" showOk confirm={`Да се пополнат компонентите што ги нема за ${year} (од ${year - 1} или почетен текст)? Потоа ги прегледувате и потпишувате.`} />}
            <a className="btn sm" href={`/print/ifac?y=${year}`} target="_blank" rel="noreferrer">🖨 Прирачник и подготвеност</a>
          </div></div>
        <p className="note" style={{ marginTop: 4 }}>ISQM 1 бара систем со осум компоненти и годишна оценка. За секоја компонента: опис (политики и постапки), одговорно лице, потпис (кој / кога), доказ и верзија. Канцеларијата не е сертифицирана – целта е да биде подготвена за проверка од ИСОС.</p>
        <div className="tw"><table className="dense">
          <thead><tr><th>Компонента</th><th>Член</th><th>Документирано</th><th>Одговорен</th><th>Потпишано</th><th>Доказ</th><th>Верзија</th></tr></thead>
          <tbody>{SQM_COMPONENTS.map((x) => {
            const s = st(x.k), r = S.get(x.k), dd = (r?.data ?? null) as SqmData | null;
            return (
              <tr key={x.k} style={c?.k === x.k ? { background: 'var(--accent-soft)' } : undefined}>
                <td><Link href={`/ifac?t=sqm&c=${x.k}`}>{x.ic} {x.n}</Link></td><td className="mini">{x.clause}</td>
                <td>{ok(s.documented)}</td><td>{dd?.owner ? staff.find((u) => u.id === dd.owner)?.name ?? '—' : ok(false)}</td>
                <td>{s.signed ? <span className="pill good">{dmy(String(dd?.signedOn))}</span> : ok(false)}</td>
                <td>{x.evidence ? ok(s.evidence, `📎 ${F.get(r?.id ?? '')?.length ?? 0}`) : <span className="mini">—</span>}</td>
                <td><Meta d={r?.data} staff={staff} /></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </div>
      {c && (
        <ActionForm key={JSON.stringify(d)} action={sqmSave} reset={false}>
          <input type="hidden" name="year" value={year} /><input type="hidden" name="comp" value={c.k} />
          <div className="hd"><h2 style={{ margin: 0 }}>{c.ic} {c.n} <span className="mini">· {c.clause}</span></h2><Meta d={d} staff={staff} /></div>
          <p className="note" style={{ marginTop: 4 }}>{c.hint}</p>
          {c.fields.map((x) => {
            const v = String(d?.[x.k] ?? '');
            return (
              <label key={x.k} className="f wide" style={{ marginBottom: 6 }}>{x.n}{x.req ? ' *' : ''}
                {x.t === 'area' ? <textarea name={'d_' + x.k} defaultValue={v} rows={5} placeholder={x.ph} />
                  : x.t === 'sel' ? <select name={'d_' + x.k} defaultValue={v}>{(x.o ?? []).map((o) => <option key={o} value={o}>{o || '—'}</option>)}</select>
                    : <input name={'d_' + x.k} type={x.t === 'date' ? 'date' : 'text'} defaultValue={v} placeholder={x.ph} />}
              </label>
            );
          })}
          <div className="form">
            <label className="f">Одговорно лице<Who name="owner" v={d?.owner} staff={staff} /></label>
            <label className="f">Одобрил / потпишал<Who name="signedBy" v={d?.signedBy} staff={staff} /></label>
            <label className="f">Датум на потпис<input type="date" name="signedOn" defaultValue={d?.signedOn ?? ''} /></label>
          </div>
          <div style={{ margin: '6px 0' }}><b>Доказ</b>{c.evidence ? ' *' : ''} <FileChips files={row ? F.get(row.id) : undefined} /></div>
          <UploadField firmId={null} accept=".pdf,image/*,.doc,.docx,.xlsx" label="📎 Прикачи доказ (записник, извештај, листа)" />
          {canEdit ? <div className="row" style={{ marginTop: 8 }}><Submit>Зачувај (нова верзија)</Submit></div> : <p className="note">Само управителот / главниот сметководител ги менува.</p>}
        </ActionForm>
      )}
    </>
  );
}

/* ---------------- 👥 employees ---------------- */

export async function TabStaff({ year, uid, staff, canEdit }: { year: number; uid?: string; staff: Staff; canEdit: boolean }) {
  const [R, Rp] = await Promise.all([db().transaction((tx) => ifacYear(tx, year)), db().transaction(async (tx) => [...await ifacYear(tx, year - 1), ...await ifacYear(tx, year - 2)])]);
  const rowOf = (L: typeof R, k: string, s: string) => L.find((r) => r.kind === k && r.subject === s);
  const F = await filesOf(IFAC_FILE_ENTITY, R.filter((r) => r.kind === 'staff' || r.kind === 'ethics').map((r) => r.id));
  const prevH = (id: string, y: number) => { const r = Rp.find((x) => x.kind === 'staff' && x.subject === id && x.year === y); return r ? staffNormalize(r.data).cpd.reduce((s, e) => s + e.hours, 0) : 0; };
  const sel = staff.find((x) => x.id === uid);
  const row = sel ? rowOf(R, 'staff', sel.id) : undefined;
  const d = row ? staffNormalize(row.data) : null;
  const req = sel ? roleCompetence(sel.role) : [];
  const rows = d ? [...d.cpd, ...Array(3).fill(null)] : Array(4).fill(null);
  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>👥 Вработени – {year}</h2>
        <p className="note" style={{ marginTop: 4 }}>ISQM 1 §32 (ресурси): компетентност по улога, проценета од друго лице; овластените сметководители – најмалку {CPD_MIN_YEAR} часа професионален развој годишно и {CPD_MIN_3Y} во три години (IES 7 / ИСОС), со доказ. Анексот кон договорите за вработување (доверливост, безбедност, ЗЗЛП) е во ISO.</p>
        <div className="tw"><table className="dense">
          <thead><tr><th>Вработен</th><th>Улога</th><th>Изјава IESBA</th><th>Компетентност</th><th>Овластен</th><th className="n">CPD {year}</th><th className="n">3 год.</th><th>Доказ</th><th /></tr></thead>
          <tbody>{staff.map((x) => {
            const r = rowOf(R, 'staff', x.id), e = rowOf(R, 'ethics', x.id), dd = r ? staffNormalize(r.data) : null;
            const s = staffStatus(x.role, dd, x.id, { y1: prevH(x.id, year - 1), y2: prevH(x.id, year - 2) });
            return (
              <tr key={x.id} style={sel?.id === x.id ? { background: 'var(--accent-soft)' } : undefined}>
                <td>{x.name}</td><td className="mini">{ROLES[x.role as Role]?.n ?? x.role}</td>
                <td>{e ? <span className="pill good">{dmy(String(e.data.at ?? ''))}</span> : ok(false, '', 'не')}</td>
                <td>{s.assessed ? <span className={`pill ${s.met === s.req.length ? 'good' : 'warn'}`}>{s.met}/{s.req.length} · {dmy(dd?.assessedOn)}</span> : ok(false, '', 'не е проценета')}</td>
                <td>{dd?.licensed ? `✓ ${dd.licence}` : '—'}</td>
                <td className="n">{dd?.licensed ? <span className={`pill ${s.cpdOk ? 'good' : 'warn'}`}>{s.hours}</span> : s.hours || ''}</td>
                <td className="n">{dd?.licensed ? <span className={`pill ${s.three3Ok ? 'good' : 'warn'}`}>{s.three}</span> : ''}</td>
                <td><FileChips files={r ? F.get(r.id) : undefined} /></td>
                <td><Link className="btn sm" href={`/ifac?t=staff&u=${x.id}`}>✎</Link></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </div>
      {sel && (
        <ActionForm key={JSON.stringify(row?.data ?? null)} action={staffSave} reset={false}>
          <input type="hidden" name="year" value={year} /><input type="hidden" name="subject" value={sel.id} />
          <div className="hd"><h2 style={{ margin: 0 }}>{sel.name} – {ROLES[sel.role as Role]?.n ?? sel.role}, {year}</h2><Meta d={row?.data} staff={staff} /></div>
          <h3 style={{ margin: '6px 0 2px' }}>Барања за компетентност на улогата</h3>
          {req.map((t, i) => <label key={i} className="chk" style={{ display: 'block' }}><input type="checkbox" name={`met_${i}`} defaultChecked={!!d?.met[String(i)]} /> {t}</label>)}
          <div className="form" style={{ marginTop: 6 }}>
            <label className="chk"><input type="checkbox" name="licensed" defaultChecked={!!d?.licensed} /> Овластен сметководител / член на ИСОС</label>
            <label className="f">Број на лиценца / членство<input name="licence" defaultValue={d?.licence ?? ''} /></label>
            <label className="f">Проценил (друго лице)<Who name="assessedBy" v={d?.assessedBy} staff={staff.filter((x) => x.id !== sel.id)} /></label>
            <label className="f" title="За сопственикот на канцеларија со едно лице">или надворешен проценувач<input name="assessedExt" defaultValue={d?.assessedExt ?? ''} placeholder="име, функција" /></label>
            <label className="f">Датум на проценка<input type="date" name="assessedOn" defaultValue={d?.assessedOn ?? ''} /></label>
            <label className="f wide">Белешка (потреби од обука, план)<input name="note" defaultValue={d?.note ?? ''} /></label>
          </div>
          <h3 style={{ margin: '8px 0 2px' }}>Професионален развој (CPD) {year}</h3>
          <div className="tw"><table className="dense"><thead><tr><th>Датум</th><th>Тема</th><th>Организатор</th><th className="n">Часови</th><th>Вид</th></tr></thead>
            <tbody>{rows.map((e, i) => (
              <tr key={i}>
                <td><input type="date" name="c_date" defaultValue={e?.date ?? ''} /></td><td><input name="c_topic" defaultValue={e?.topic ?? ''} style={{ width: '100%' }} /></td>
                <td><input name="c_provider" defaultValue={e?.provider ?? ''} /></td><td className="n"><input name="c_hours" type="number" step="0.5" defaultValue={e?.hours ?? ''} style={{ width: 70 }} /></td>
                <td><select name="c_kind" defaultValue={e && !e.structured ? 'u' : 's'}><option value="s">структурирано</option><option value="u">неструктурирано</option></select></td>
              </tr>
            ))}</tbody></table></div>
          <div style={{ margin: '6px 0' }}><b>Докази</b> (сертификати, листи на присуство) <FileChips files={row ? F.get(row.id) : undefined} /></div>
          <UploadField firmId={null} accept=".pdf,image/*" label="📎 Прикачи сертификат" />
          {canEdit ? <div className="row" style={{ marginTop: 8 }}><Submit>Зачувај (нова верзија)</Submit></div> : <p className="note">Проценката ја внесува управителот / главниот сметководител.</p>}
        </ActionForm>
      )}
    </>
  );
}

/* ---------------- 🧭 the declaration ---------------- */

export async function TabEthics({ u, year, office, staff }: { u: SessionUser; year: number; office: string; staff: Staff }) {
  const [mine, R, Fm] = await Promise.all([db().transaction((tx) => ifacGet(tx, 'ethics', year, u.id)), db().transaction((tx) => ifacYear(tx, year)), allowedFirms(u, { year })]);
  const E = R.filter((r) => r.kind === 'ethics');
  const F = await filesOf(IFAC_FILE_ENTITY, E.map((r) => r.id));
  const clients = mine ? ((mine.data.clients as string[]) ?? []) : [];
  const isStaff = staff.some((x) => x.id === u.id);
  return (
    <div className="cols">
      <div className="card">
        <div className="hd"><h2 style={{ margin: 0 }}>🧭 Изјава за етика, независност и доверливост {year} – {u.name}</h2>
          <a className="btn sm" href={`/print/ifacEt?y=${year}`} target="_blank" rel="noreferrer">🖨 За потпис</a></div>
        {ethicsText(office, u.name, year, { clients, conflicts: mine ? String(mine.data.conflicts ?? '') : '' }).map((t, i) => <p key={i} style={{ margin: '0 0 6px', textAlign: 'justify' }}>{t}</p>)}
        {mine ? <div className="callout good">✅ Потпишано на {dmy(String(mine.data.at ?? ''))} · <Meta d={mine.data} staff={staff} /> <FileChips files={F.get(mine.id)} /></div>
          : isStaff ? (
            <ActionForm action={ethicsSign} className="card" style={{ background: 'var(--accent-soft)' }}>
              <input type="hidden" name="year" value={year} />
              <b>Клиенти на кои работам во {year}</b>
              <div className="row" style={{ gap: '2px 14px', flexWrap: 'wrap', maxHeight: 220, overflow: 'auto', margin: '4px 0' }}>
                {Fm.map((f) => <label key={f.id} className="chk"><input type="checkbox" name="clients" value={f.id} /> {f.name}</label>)}
              </div>
              <label className="f wide">Врски / судир на интереси што ги пријавувам (празно = нема)<textarea name="conflicts" rows={2} /></label>
              <UploadField firmId={null} accept=".pdf,image/*" label="📎 Потпишан примерок на хартија (по желба)" />
              <label className="chk" style={{ marginTop: 6 }}><input type="checkbox" name="ok" /> Ја прочитав изјавата и се согласувам</label>
              <div className="row" style={{ marginTop: 6 }}><Submit>✍ Потпишувам</Submit></div>
            </ActionForm>
          ) : <p className="note">Изјавата ја потпишуваат вработените во канцеларијата.</p>}
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Вработени – {year} <span className="mini">{E.length} / {staff.length}</span></h2>
        <div className="tw"><table className="dense"><thead><tr><th>Вработен</th><th>Потпишано</th><th className="n">Клиенти</th><th>Судир</th><th>Прилог</th></tr></thead>
          <tbody>{staff.map((x) => { const e = E.find((r) => r.subject === x.id); return (
            <tr key={x.id}><td>{x.name}</td><td>{e ? <span className="pill good">{dmy(String(e.data.at ?? ''))}</span> : <span className="pill warn">не</span>}</td>
              <td className="n">{e ? ((e.data.clients as string[]) ?? []).length : ''}</td><td>{e?.data.conflicts ? <span className="pill warn" title={String(e.data.conflicts)}>пријавено</span> : ''}</td><td><FileChips files={e ? F.get(e.id) : undefined} /></td></tr>
          ); })}</tbody></table></div>
        <p className="note">Секое потпишување се запишува во <Link href="/iso?k=training">ISO › Обуки и компетентност</Link>; записот се затвора кога ќе потпишат сите.</p>
      </div>
    </div>
  );
}

/* ---------------- 🎯 readiness ---------------- */

export async function TabReady({ u, year, today, demo, officeFirmId }: { u: SessionUser; year: number; today: string; demo: boolean; officeFirmId: string | null }) {
  const F = (await allowedFirms(u, { year })).filter((f) => f.id !== officeFirmId);
  const V = await db().transaction((tx) => ifacReadinessFor(tx, year, { firms: F.map((f) => ({ id: f.id, name: f.name })), today, demo }));
  return (
    <div className="card">
      <div className="hd"><h2 style={{ margin: 0 }}>🎯 Подготвеност за проверка на квалитет (ИСОС) – {year}</h2>
        <div className="row" style={{ gap: 6, alignItems: 'center' }}><span className={`pill ${V.pct === 100 ? 'good' : V.pct >= 70 ? 'info' : 'warn'}`} style={{ fontSize: 14 }}>{V.pct}% · {V.done}/{V.total}</span>
          <a className="btn sm" href={`/print/ifac?y=${year}`} target="_blank" rel="noreferrer">🖨 Извештај</a></div></div>
      <p className="note" style={{ marginTop: 4 }}>Што бара проверувачот според ISQM 1, ISRS 4410 и Кодексот на IESBA – секоја ставка со врска до местото каде се дополнува.</p>
      {V.sections.map((s) => (
        <div key={s.k} style={{ marginTop: 10 }}>
          <h3 style={{ margin: '0 0 4px' }}>{s.n} <span className="mini">· {s.clause} · {s.items.filter((i) => i.ok).length}/{s.items.length}</span></h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {s.items.map((i, n) => <li key={n} style={{ margin: '3px 0' }}>{ok(i.ok)} {i.href ? <Link href={i.href}>{i.n}</Link> : i.n}{i.info ? <span className="mini"> · {i.info}</span> : null}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}
