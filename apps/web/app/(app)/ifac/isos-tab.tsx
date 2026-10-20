/**
 * 🤝 IFAC – 🏛 ИСОС: the obligations of the office towards ИСОС from the Закон за вршење на сметководствени работи –
 * 🛡 the professional liability insurance (чл. 32 ст. 2 т. 6), 📋 the list of the employees and the proof of the
 * insurance by 31 January (чл. 32 ст. 9), 📝 the yearly quality-control questionnaire by 31 March (чл. 46 ст. 3) and 🔎
 * the control on the spot (чл. 46 ст. 1) with what it checks linked to the ISQM 1 / ISO evidence. The deadlines go to
 * the office firm in „📅 Рокови“, the findings to the autopilot.
 */
import Link from 'next/link';
import {
  INS_REMIND_DAYS, insMin, insNormalize, insStatus, ISOS_CTL_SCOPE, ISOS_CTL_YEARS, ISOS_FORMS, ISOS_KINDS, isosCtlNext, isosCtlNormalize, isosListDue, isosListNormalize,
  isosQDue, isosQNormalize, isosQSent,
} from '@wise/core/office/ifac-isos';
import { IFAC_FILE_ENTITY } from '@wise/core/office/ifac-sqm';
import { isosRows } from '@wise/db';
import { db } from '@/lib/db';
import { filesOf } from '@/lib/office';
import { ActionForm, Submit } from '@/components/action-form';
import { FileChips } from '@/components/file-chips';
import { dmy } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { UploadField } from '@/components/upload-field';
import { insDelete, insSave, isosCtlSave, isosListSave, isosQSave } from './actions';
import { isosListRows } from './lib';
import { Meta } from './tabs';

type Staff = { id: string; name: string; role: string }[];
const eur = (n: number) => `€${(Number(n) || 0).toLocaleString('de-DE')}`;

export async function TabIsos({ year, today, staff, canEdit, demo, hasOffice, edit }: { year: number; today: string; staff: Staff; canEdit: boolean; demo: boolean; hasOffice: boolean; edit?: string }) {
  const [R, rows] = await Promise.all([db().transaction((tx) => isosRows(tx)), isosListRows(year, demo)]);
  const F = await filesOf(IFAC_FILE_ENTITY, R.map((r) => r.id));
  const I = R.filter((r) => r.kind === ISOS_KINDS.ins).map((r) => ({ r, p: insNormalize(r.data) })).sort((a, b) => b.p.validFrom.localeCompare(a.p.validFrom));
  const st = insStatus(I.map((x) => x.p), today);
  const pe = I.find((x) => x.r.id === edit);
  const p0 = pe?.p ?? (st.cur ? { ...st.cur, validFrom: '', validTo: '', policyNo: '', note: '' } : null);
  const one = (k: string, y: number) => R.find((r) => r.kind === k && r.year === y);
  const L = one(ISOS_KINDS.list, year), ld = L ? isosListNormalize(L.data) : null;
  const qYears = [year - 1, year];
  const C = R.filter((r) => r.kind === ISOS_KINDS.ctl).map((r) => ({ r, c: isosCtlNormalize(r.data) })).sort((a, b) => String(b.c.date).localeCompare(String(a.c.date)));
  const last = C[0]?.c ?? null;
  const pill = st.state === 'ok' && st.amountOk ? 'good' : st.state === 'soon' ? 'warn' : 'bad';
  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>🏛 Обврски кон ИСОС – {year}</h2>
        <p className="note" style={{ marginTop: 4 }}>Закон за вршење на сметководствени работи (Сл. весник 173/22, 47/25): осигурување од професионална одговорност (чл. 32), список на вработени и доказ за осигурување до 31 јануари (чл. 32 ст. 9), годишен прашалник за контрола на квалитет до 31 март (чл. 46 ст. 3) и контрола на терен најмалку еднаш во {ISOS_CTL_YEARS} години (чл. 46 ст. 1). Роковите се во <Link href="/rokovi">📅 Рокови</Link> (фирмата на канцеларијата) и во <Link href="/izvestuvanja?cat=ИСОС">🤖 Автопилот</Link>.</p>
        {!hasOffice && <div className="callout warn">Роковите кон ИСОС се водат на фирмата на канцеларијата – одредете ја во <Link href="/kdogovori">Договор за сметководствени услуги</Link>.</div>}
      </div>

      <div className="card">
        <div className="hd"><h2 style={{ margin: 0 }}>🛡 Осигурување од професионална одговорност <span className={`pill ${pill}`}>{st.state === 'none' ? 'нема' : st.state === 'expired' ? 'истечено' : st.amountOk ? (st.state === 'soon' ? 'истекува' : 'важечко') : 'под минимумот'}</span></h2></div>
        <p className="note" style={{ marginTop: 4 }}>ЗВСР чл. 32 ст. 2 т. 6: годишна полиса најмалку {ISOS_FORMS.map((f) => `${eur(f[2])} (${f[1].toLowerCase()})`).join(', ')} по штетен настан. Потсетник {INS_REMIND_DAYS} дена пред истекот. {st.text}.</p>
        <div className="tw"><table className="dense">
          <thead><tr><th>Осигурител</th><th>Полиса</th><th className="n">Сума по настан</th><th>Важи од</th><th>до</th><th>Скен</th><th>Верзија</th><th /></tr></thead>
          <tbody>{I.map(({ r, p }) => (
            <tr key={r.id} style={st.cur === p || pe?.r.id === r.id ? { background: 'var(--accent-soft)' } : undefined}>
              <td>{p.insurer}</td><td>{p.policyNo}</td>
              <td className="n"><span className={`pill ${p.amountEur >= insMin(p.form) ? 'good' : 'bad'}`}>{eur(p.amountEur)}</span></td>
              <td>{dmy(p.validFrom)}</td><td>{dmy(p.validTo)}</td><td><FileChips files={F.get(r.id)} /></td><td><Meta d={r.data} staff={staff} /></td>
              <td style={{ whiteSpace: 'nowrap' }}>{canEdit && <><Link className="btn sm" href={`/ifac?t=isos&p=${r.id}`}>✎</Link> <RowAction action={insDelete.bind(null, r.id)} label="🗑" title="Избриши" confirm={`Да се избрише полисата ${p.policyNo}?`} /></>}</td>
            </tr>
          ))}{!I.length && <tr><td colSpan={8} className="mini">Нема внесена полиса.</td></tr>}</tbody>
        </table></div>
        {canEdit && (
          <ActionForm key={pe?.r.id ?? 'new' + JSON.stringify(st.cur)} action={insSave} reset={!pe} className="card" style={{ background: 'var(--accent-soft)' }}>
            {pe && <input type="hidden" name="id" value={pe.r.id} />}
            <b>{pe ? `Измена на полисата ${pe.p.policyNo}` : 'Нова полиса (обнова)'}</b>{pe && <> · <Link href="/ifac?t=isos">нова</Link></>}
            <div className="form">
              <label className="f">Вид на субјектот<select name="form" defaultValue={p0?.form ?? 'co'}>{ISOS_FORMS.map((f) => <option key={f[0]} value={f[0]}>{f[1]} – мин. {eur(f[2])}</option>)}</select></label>
              <label className="f">Осигурителна компанија *<input name="insurer" defaultValue={p0?.insurer ?? ''} /></label>
              <label className="f">Број на полиса *<input name="policyNo" defaultValue={p0?.policyNo ?? ''} /></label>
              <label className="f">Сума по штетен настан (€) *<input name="amountEur" type="number" min={0} step={1} defaultValue={p0?.amountEur || ''} /></label>
              <label className="f">Важи од *<input type="date" name="validFrom" defaultValue={p0?.validFrom ?? ''} /></label>
              <label className="f">Важи до *<input type="date" name="validTo" defaultValue={p0?.validTo ?? ''} /></label>
              <label className="f wide">Белешка<input name="note" defaultValue={p0?.note ?? ''} /></label>
            </div>
            <UploadField firmId={null} accept=".pdf,image/*" label="📎 Скен од полисата" />
            <div className="row" style={{ marginTop: 6 }}><Submit>Зачувај полиса</Submit></div>
          </ActionForm>
        )}
      </div>

      <div className="card">
        <div className="hd"><h2 style={{ margin: 0 }}>📋 Список на вработени и доказ за осигурување до {dmy(isosListDue(year))} {ld?.submittedOn ? <span className="pill good">доставено {dmy(ld.submittedOn)}</span> : <span className={`pill ${today > isosListDue(year) ? 'bad' : 'warn'}`}>не е доставено</span>}</h2>
          <a className="btn sm" href={`/print/ifacIsos?y=${year}`} target="_blank" rel="noreferrer">🖨 Список за ИСОС</a></div>
        <p className="note" style={{ marginTop: 4 }}>ЗВСР чл. 32 ст. 9: секоја година до 31 јануари до ИСОС – вработените со звањата и регистарските броеви во ИСОС и доказ за осигурувањето. Звањето и бројот се од <Link href="/ifac?t=staff">👥 Вработени</Link> (регистар на ИСОС, регистарски број).</p>
        <div className="tw"><table className="dense"><thead><tr><th>Р.б.</th><th>Име и презиме</th><th>Звање</th><th>Број во регистарот на ИСОС</th></tr></thead>
          <tbody>{(ld?.staff ?? rows).map((r, i) => <tr key={i}><td>{i + 1}</td><td>{r.name}</td><td>{r.title}</td><td>{r.reg || <span className="pill warn">нема</span>}</td></tr>)}</tbody></table></div>
        {ld?.staff && <p className="mini">Прикажан е списокот како што е доставен на {dmy(ld.submittedOn)}.</p>}
        {canEdit && (
          <ActionForm key={JSON.stringify(L?.data ?? null)} action={isosListSave} reset={false}>
            <input type="hidden" name="year" value={year} />
            <div className="form">
              <label className="f">Доставено на<input type="date" name="submittedOn" defaultValue={ld?.submittedOn ?? ''} /></label>
              <label className="f">Начин (е-пошта, портал, лично)<input name="how" defaultValue={ld?.how ?? ''} /></label>
              <label className="f wide">Белешка<input name="note" defaultValue={ld?.note ?? ''} /></label>
            </div>
            <div style={{ margin: '6px 0' }}><b>Доказ</b> (испратен список, потврда) <FileChips files={L ? F.get(L.id) : undefined} /></div>
            <UploadField firmId={null} accept=".pdf,image/*,.eml,.msg" label="📎 Прикачи доказ" />
            <div className="row" style={{ marginTop: 6 }}><Submit>Зачувај</Submit>{L && <Meta d={L.data} staff={staff} />}</div>
          </ActionForm>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>📝 Годишен прашалник за контрола на квалитет</h2>
        <p className="note" style={{ marginTop: 4 }}>ЗВСР чл. 46 ст. 3: ИСОС го доставува прашалникот до 20 декември, а се враќа до 31 март за претходната година.</p>
        {qYears.map((y) => {
          const r = one(ISOS_KINDS.q, y), q = r ? isosQNormalize(r.data) : null;
          return (
            <ActionForm key={y + JSON.stringify(r?.data ?? null)} action={isosQSave} reset={false} className="card">
              <input type="hidden" name="year" value={y} />
              <b>За {y}</b> · ИСОС праќа до {dmy(isosQSent(y))}, рок {dmy(isosQDue(y))} {q?.submittedOn ? <span className="pill good">доставено {dmy(q.submittedOn)}</span> : <span className={`pill ${today > isosQDue(y) ? 'bad' : today >= isosQSent(y) ? 'warn' : 'info'}`}>{today > isosQDue(y) ? 'задоцнето' : 'не е доставено'}</span>}
              <div className="form">
                <label className="f">Примен на<input type="date" name="receivedOn" defaultValue={q?.receivedOn ?? ''} disabled={!canEdit} /></label>
                <label className="f">Доставен на<input type="date" name="submittedOn" defaultValue={q?.submittedOn ?? ''} disabled={!canEdit} /></label>
                <label className="f wide">Белешка<input name="note" defaultValue={q?.note ?? ''} disabled={!canEdit} /></label>
              </div>
              <div style={{ margin: '6px 0' }}><b>Скен</b> (пополнет прашалник, потврда) <FileChips files={r ? F.get(r.id) : undefined} /></div>
              {canEdit && <><UploadField firmId={null} accept=".pdf,image/*,.doc,.docx,.xlsx" label="📎 Прикачи скен" /><div className="row" style={{ marginTop: 6 }}><Submit>Зачувај</Submit>{r && <Meta d={r.data} staff={staff} />}</div></>}
            </ActionForm>
          );
        })}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>🔎 Контрола на квалитет на терен {last?.date ? <span className="mini">· последна {dmy(last.date)}, следна најдоцна {dmy(isosCtlNext(last.date))}</span> : <span className="mini">· нема евидентирана</span>}</h2>
        <p className="note" style={{ marginTop: 4 }}>ЗВСР чл. 46 ст. 1: ИСОС врши контрола на квалитет на терен најмалку еднаш во {ISOS_CTL_YEARS} години. Се проверува:</p>
        <div className="tw"><table className="dense"><thead><tr><th>Што се проверува</th><th>Доказ во WISE</th></tr></thead>
          <tbody>{ISOS_CTL_SCOPE.map((x) => <tr key={x.k}><td>{x.n}</td><td><Link href={x.href}>{x.ev}</Link></td></tr>)}</tbody></table></div>
        <p className="note">Целосната подготвеност е во <Link href="/ifac?t=ready">🎯 Подготвеност</Link>; системот и процедурите во <Link href="/ifac?t=sqm">🏛 Систем (ISQM 1)</Link> и <Link href="/iso">🏅 ISO</Link>.</p>
        {C.length > 0 && <div className="tw"><table className="dense"><thead><tr><th>Датум</th><th>Контролор</th><th>Наоди</th><th>Мерки</th><th>Записник</th></tr></thead>
          <tbody>{C.map(({ r, c }) => <tr key={r.id}><td>{dmy(c.date)}</td><td>{c.by}</td><td style={{ whiteSpace: 'pre-wrap' }}>{c.findings || '—'}</td><td style={{ whiteSpace: 'pre-wrap' }}>{c.measures || (c.findings ? <span className="pill warn">нема мерки</span> : '—')}</td><td><FileChips files={F.get(r.id)} /></td></tr>)}</tbody></table></div>}
        {canEdit && (
          <ActionForm action={isosCtlSave} reset className="card" style={{ background: 'var(--accent-soft)' }}>
            <b>Евидентирај контрола</b> <span className="mini">(иста година – се заменува)</span>
            <div className="form">
              <label className="f">Датум *<input type="date" name="date" /></label>
              <label className="f">Контролор (ИСОС)<input name="by" /></label>
              <label className="f wide">Наоди<textarea name="findings" rows={2} /></label>
              <label className="f wide">Мерки, рок и одговорен<textarea name="measures" rows={2} /></label>
            </div>
            <UploadField firmId={null} accept=".pdf,image/*" label="📎 Записник од контролата" />
            <div className="row" style={{ marginTop: 6 }}><Submit>Зачувај</Submit></div>
          </ActionForm>
        )}
      </div>
    </>
  );
}
