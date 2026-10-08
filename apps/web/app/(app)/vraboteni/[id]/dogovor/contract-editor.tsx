'use client';
/** Contract editor with live preview (legacy `ctRender`), warnings (`ctWarnings`), extension / transformation (`extWarn`, `extSave`). */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  g4n, hrAddMonthsEnd, HR_CT_TYPES, HR_DURS, hrCtWarnings, hrExtWarnings, hrFixedTerm, type HrContract, type HrExtension, type PayParams,
} from '@wise/core/payroll';
import { fmt } from '@/lib/fmt';
import { contractHtml, extHtml, type DocEmployee, type DocFirm } from '@/lib/payroll/docs';
import { extendContractAction, saveContractAction } from '../../../dogovori/actions';

export function ContractEditor({ employee, firm, c0, saved, params, taken, canWrite, fixedEnd }: {
  employee: DocEmployee & { id: string }; firm: DocFirm; c0: HrContract; saved: boolean; params: PayParams; taken: string[]; canWrite: boolean; fixedEnd: string | null;
}) {
  const router = useRouter();
  const [c, setC] = useState<HrContract>(c0);
  const [dirty, setDirty] = useState(!saved);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  const [x, setX] = useState<HrExtension>({ kind: 'ext', doc: 'annex', date: new Date().toISOString().slice(0, 10), end: '', reason: '' });
  const set = <K extends keyof HrContract>(k: K, v: HrContract[K]) => { setC({ ...c, [k]: v }); setDirty(true); };
  const W = hrCtWarnings(c, params, taken);
  const F = (k: keyof HrContract, l: string, type = 'text', extra: Record<string, unknown> = {}) => (
    <label className="f">{l}<input type={type} step={type === 'number' ? 'any' : undefined} value={String(c[k] ?? '')} disabled={!canWrite} {...extra}
      onChange={(ev) => set(k, (type === 'number' ? (ev.target.value === '' ? '' : +ev.target.value) : ev.target.value) as never)} /></label>
  );
  const fixed = hrFixedTerm(c.type);
  const XW = hrExtWarnings(c, x);
  return (
    <>
      {msg.error && <div className="callout bad">{msg.error}</div>}
      {msg.ok && <div className="callout good">{msg.ok}</div>}
      <div className="ctgrid" style={{ display: 'grid', gridTemplateColumns: 'minmax(320px,1fr) minmax(0,1.3fr)', gap: 14, alignItems: 'start' }}>
        <div className="card">
          <div className="form">
            <label className="f wide">Вид на договор<select value={c.type} disabled={!canWrite} onChange={(ev) => set('type', ev.target.value as HrContract['type'])}>{HR_CT_TYPES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
            {F('no', 'Деловоден број (празно = следен)')}
            {F('signDate', 'Датум на склучување', 'date')}
            {F('place', 'Место')}
            {F('start', 'Почеток на работа', 'date')}
            {fixed && <label className="f">Траење<select value="" disabled={!canWrite} onChange={(ev) => ev.target.value && set('end', hrAddMonthsEnd(c.start, ev.target.value))}><option value="">рачно (датум)</option>{HR_DURS.map((n) => <option key={n} value={n}>{n} {n === 1 ? 'месец' : 'месеци'}</option>)}</select></label>}
            {fixed && F('end', 'Важи до', 'date')}
            {fixed && F('reason', 'Причина за определено време')}
            {F('position', 'Работно место')}
            <label className="f wide">Опис на работите<textarea rows={3} value={c.duties} disabled={!canWrite} onChange={(ev) => set('duties', ev.target.value)} style={{ width: '100%', font: 'inherit' }} /></label>
            {F('workPlace', 'Место на работа')}
            {F('hours', 'Часови неделно', 'number')}
            {F('probation', 'Пробна работа (месеци)', 'number')}
            {F('net', 'Нето плата', 'number')}
            {F('gross', 'Бруто плата', 'number')}
            {F('leave', 'Годишен одмор (дена)', 'number')}
            {F('notice', 'Отказен рок (месеци)', 'number')}
            {F('rep', 'Застапник на работодавачот')}
            {F('repRole', 'Функција')}
          </div>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <button className="btn sm" type="button" disabled={!canWrite || !c.net} onClick={() => set('gross', g4n(+c.net * (+c.hours < 40 ? +c.hours / 40 : 1), params, +params.exempt))}>Бруто од нето ({fmt(g4n(+c.net || 0, params, +params.exempt))})</button>
          </div>
          {W.length > 0 && <div className="callout warn" style={{ marginTop: 8 }}>{W.map((w) => <div key={w}>{w}</div>)}</div>}
          {canWrite && <div className="row" style={{ marginTop: 8 }}>
            <button className="btn pri" disabled={pending} onClick={() => start(async () => {
              const r = await saveContractAction(employee.id, c);
              setMsg(r);
              if (!r.error) { setDirty(false); if (r.no) setC({ ...c, no: r.no }); router.refresh(); }
            })}>Зачувај и заведи во евиденција</button>
          </div>}
          <p className="note">Со зачувувањето договорот добива деловоден број и контролен код, условите (работно место, плата, одмор, траење) се пренесуваат во матичните податоци на вработениот, а документот се чува во досието.</p>
        </div>
        <div className="pdfwrap" style={{ maxHeight: '80vh', overflow: 'auto', background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: '6mm' }}>
          <div className="pdfdoc" style={{ width: 'auto' }} dangerouslySetInnerHTML={{ __html: contractHtml(firm, employee, c, { draft: dirty }) }} />
        </div>
      </div>

      {saved && fixedEnd && (
        <div className="card" id="prodolzi">
          <h2>Продолжување / трансформација на договорот (сега важи до {fixedEnd.split('-').reverse().join('.')})</h2>
          <div className="form">
            <label className="f">Што<select value={x.kind} onChange={(ev) => setX({ ...x, kind: ev.target.value as HrExtension['kind'] })}><option value="ext">Продолжи на определено</option><option value="transform">Трансформирај во неопределено</option></select></label>
            <label className="f">Документ<select value={x.doc} onChange={(ev) => setX({ ...x, doc: ev.target.value as HrExtension['doc'] })}><option value="annex">Анекс кон договорот</option><option value="odluka">Одлука</option></select></label>
            <label className="f">Број (празно = следен)<input value={x.no ?? ''} onChange={(ev) => setX({ ...x, no: ev.target.value })} /></label>
            <label className="f">Датум<input type="date" value={x.date} onChange={(ev) => setX({ ...x, date: ev.target.value })} /></label>
            {x.kind === 'ext' && <>
              <label className="f">Траење<select value="" onChange={(ev) => ev.target.value && setX({ ...x, end: hrAddMonthsEnd(addDay(fixedEnd), ev.target.value) })}><option value="">рачно (датум)</option>{HR_DURS.map((n) => <option key={n} value={n}>{n} {n === 1 ? 'месец' : 'месеци'}</option>)}</select></label>
              <label className="f">Нов датум „до“<input type="date" value={x.end ?? ''} onChange={(ev) => setX({ ...x, end: ev.target.value })} /></label>
              <label className="f wide">Причина<input value={x.reason ?? ''} onChange={(ev) => setX({ ...x, reason: ev.target.value })} /></label>
            </>}
          </div>
          {XW.length > 0 && <div className="callout warn">{XW.map((w) => <div key={w}>{w}</div>)}</div>}
          {canWrite && <div className="row"><button className="btn pri" disabled={pending} onClick={() => start(async () => { const r = await extendContractAction(employee.id, x); setMsg(r); if (!r.error) router.refresh(); })}>Зачувај и заведи</button></div>}
          <details style={{ marginTop: 8 }}><summary className="mini">Преглед</summary>
            <div className="pdfdoc" style={{ width: 'auto', background: '#fff', padding: '6mm' }} dangerouslySetInnerHTML={{ __html: extHtml(firm, employee, c, x) }} />
          </details>
        </div>
      )}
    </>
  );
}

const addDay = (d: string) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
