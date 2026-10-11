/** 🚩 Пријави и УФР — internal reports (decision), the reports to УФР (content, deadline, submission) and their register. */
import { AML_KIND_LBL, AML_UFR_FIELDS, AML_UFR_KINDS, amlCanPurge, amlDueState, amlIsUfrKind, amlKindOf, amlRetainUntil, amlRetentionBase, type AmlKind } from '@wise/core/office';
import { ActionForm } from '@/components/action-form';
import { Pill } from '@/components/file-chips';
import { dmy } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { amlRepSt } from './office-actions';
import { amlPurge, amlUfrNew, amlUfrSave, amlUfrSubmit } from './ufr-actions';
import { DecideForm } from './decide-form';
import { ReportForm, UFR_APP, type AmlFirm, type AmlRep } from './report-form';

type UfrData = { kind?: AmlKind; due?: string; from?: string; submitted?: string; ufrNo?: string; channel?: string; subBy?: string; late?: boolean; form?: Record<string, string>; src?: string; decision?: { at: string; byName: string; result: string; reason: string } };

export function TipOff() {
  return <div className="callout bad"><b>Забрана за откривање (чл. 72):</b> клиентот или трети лица не смеат да се известат дека се анализира сомневање, дека е поднесена внатрешна пријава или извештај до УФР. Сите вработени потпишуваат изјава за доверливост.</div>;
}

export function TabReports({ clients, reports, today, admin, openId }: { clients: AmlFirm[]; reports: AmlRep[]; today: string; admin: boolean; openId: string | null }) {
  const ints = reports.filter((r) => amlKindOf(r.data) === 'int');
  const ufr = reports.filter((r) => amlIsUfrKind(amlKindOf(r.data)));
  const sel = openId ? ufr.find((r) => r.id === openId) : undefined;
  const sd = (sel?.data ?? {}) as UfrData;
  return (
    <>
      <TipOff />
      {sel && (
        <div className="card" id="ufrEdit">
          <div className="hd"><h2>{AML_KIND_LBL[amlKindOf(sel.data)]} – {sel.firmName}</h2>
            <div className="row"><a className="btn sm" href={`/amlDoc?d=ufr&id=${sel.id}`} target="_blank" rel="noopener">🖨 Печати / PDF</a><a className="btn sm" href="/aml?tab=rep">Затвори</a></div></div>
          <p className="mini" style={{ margin: 0 }}>Обврската настанала: {dmy(sd.from)} · рок: <b>{dmy(sd.due)}</b>{amlKindOf(sel.data) === 'str' ? ' (веднаш; целосниот извештај најдоцна 24 часа од сознавањето)' : ''} · Доставување преку <a href={UFR_APP} target="_blank" rel="noopener">електронскиот систем на УФР</a> (при технички пречки – писмено, чл. 67).</p>
          {sd.submitted ? <div className="callout good">🔒 Доставено на {dmy(sd.submitted)}, бр. {sd.ufrNo} ({sd.channel}) – {sd.subBy}{sd.late ? ' – ⚠ по рокот' : ''}. Извештајот е заклучен.</div> : (
            <>
              <ActionForm action={amlUfrSave} reset={false} className="">
                <input type="hidden" name="id" value={sel.id} />
                <div className="form">
                  {AML_UFR_FIELDS.map(([k, l, multi]) => multi
                    ? <label key={k} className="f wide">{l}<textarea name={`f_${k}`} rows={3} defaultValue={sd.form?.[k] ?? ''} style={{ width: '100%', font: 'inherit' }} /></label>
                    : <label key={k} className="f wide">{l}<input name={`f_${k}`} defaultValue={sd.form?.[k] ?? ''} /></label>)}
                </div>
                <button className="btn pri" style={{ marginTop: 6 }}>Зачувај содржина</button>
              </ActionForm>
              <ActionForm action={amlUfrSubmit} reset={false} className="" style={{ marginTop: 10 }}>
                <input type="hidden" name="id" value={sel.id} />
                <h3 style={{ fontSize: 14, margin: '0 0 4px' }}>Евидентирај доставување до УФР</h3>
                <div className="form">
                  <label className="f">Датум<input type="date" name="date" defaultValue={today} /></label>
                  <label className="f">Број / потврда од УФР<input name="ufrNo" /></label>
                  <label className="f">Начин<select name="channel"><option>електронски</option><option>писмено (технички пречки)</option><option>телефонски + писмено во 24 часа</option></select></label>
                </div>
                <button className="btn pri" style={{ marginTop: 6 }}>✓ Доставено – заклучи</button>
              </ActionForm>
            </>
          )}
        </div>
      )}

      <div className="card tw">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Извештаи до УФР ({ufr.length})</h2>
        {ufr.length ? <table className="dense">
          <thead><tr><th>Вид</th><th>Клиент</th><th>Обврска од</th><th>Рок</th><th>Доставено</th><th>Бр. УФР</th><th>Опис</th><th></th></tr></thead>
          <tbody>{ufr.map((r) => {
            const d = r.data as UfrData, s = amlDueState(d.due, today, !!d.submitted);
            const base = amlRetentionBase(r.data);
            return (
              <tr key={r.id}>
                <td className="mini">{AML_KIND_LBL[amlKindOf(r.data)]}</td><td>{r.firmName}</td><td>{dmy(d.from)}</td>
                <td><Pill c={s === 'done' ? 'good' : s === 'late' ? 'bad' : s === 'ok' ? 'info' : 'warn'}>{dmy(d.due)}{s === 'late' ? ' – доцни' : ''}</Pill></td>
                <td>{d.submitted ? `${dmy(d.submitted)}${d.late ? ' ⚠' : ''}` : '—'}</td><td>{d.ufrNo ?? ''}</td><td className="mini">{r.text}</td>
                <td className="noprint" style={{ whiteSpace: 'nowrap' }}>
                  <a className="btn sm" href={`/aml?tab=rep&id=${r.id}#ufrEdit`}>{d.submitted ? 'Отвори' : 'Пополни / достави'}</a>
                  <a className="btn sm" href={`/amlDoc?d=ufr&id=${r.id}`} target="_blank" rel="noopener">🖨</a>
                  {admin && amlCanPurge(base, today) && <RowAction action={amlPurge.bind(null, r.id, 'report')} label="Избриши (истечен рок)" confirm={`Рокот за чување истекол (${dmy(amlRetainUntil(base))}). Да се избрише?`} className="btn sm" />}
                </td>
              </tr>
            );
          })}</tbody>
        </table> : <div className="empty">Нема извештаи до УФР.</div>}
      </div>

      <ActionForm action={amlUfrNew}>
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Нов извештај до УФР (без претходен сигнал)</h2>
        <div className="form">
          <label className="f">Вид<select name="kind" defaultValue="str">{AML_UFR_KINDS.map((k) => <option key={k} value={k}>{AML_KIND_LBL[k]}</option>)}</select></label>
          <label className="f">Клиент<select name="firmId"><option value="">—</option>{clients.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
          <label className="f">Обврската настанала на (сознание / трансакција)<input type="date" name="from" defaultValue={today} /></label>
          <label className="f wide">Краток опис<textarea name="text" rows={2} style={{ width: '100%', font: 'inherit' }} /></label>
        </div>
        <button className="btn pri" style={{ marginTop: 6 }}>+ Креирај</button>
      </ActionForm>

      <ReportForm firms={clients} />
      <div className="card tw">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Внатрешни пријави ({ints.length})</h2>
        {ints.length ? <table className="dense">
          <thead><tr><th>Датум</th><th>Клиент</th><th>Опис</th><th>Пријавил</th><th>Статус</th><th>Одлука</th></tr></thead>
          <tbody>{ints.map((x) => {
            const d = x.data as UfrData;
            const open = x.status === 'нова' || x.status === 'анализа';
            return (
              <tr key={x.id}><td>{dmy(x.createdAt)}</td><td>{x.firmName}</td><td>{x.text}</td><td>{x.createdByName}</td>
                <td>{x.status}{d.due && open ? <div className="mini">рок за одлука {dmy(d.due)}</div> : null}{x.note && <div className="mini">{x.note}</div>}</td>
                <td className="noprint">{open ? <>
                  {x.status === 'нова' && <RowAction action={amlRepSt.bind(null, x.id, 'анализа')} label="Во анализа" className="btn sm" />}
                  <DecideForm id={x.id} />
                </> : <span className="mini">{d.decision ? `${d.decision.result === 'none' ? 'без сомневање' : 'извештај до УФР'} – ${d.decision.reason} (${dmy(d.decision.at)}, ${d.decision.byName})` : ''}</span>}</td></tr>
            );
          })}</tbody>
        </table> : <div className="empty">Нема внатрешни пријави.</div>}
      </div>
    </>
  );
}
