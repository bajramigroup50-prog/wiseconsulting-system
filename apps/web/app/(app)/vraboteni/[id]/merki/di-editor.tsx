'use client';
/** Disciplinary / termination document editor with preview (legacy `diRender` 15660, `diSave`, `diApply`). */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { HR_DI_GR, HR_DI_KIND, HR_DI_VIOL, hrDiEnds, hrDiLastDay, hrDiWarnings, type HrDiDoc, type HrDiKind } from '@wise/core/payroll';
import { diHtml, type DocEmployee, type DocFirm } from '@/lib/payroll/docs';
import { applyTerminationAction, saveDiAction } from '../../../dogovori/actions';

export function DiEditor({ employee, firm, nextNo, today, warnRefs, canWrite }: {
  employee: DocEmployee & { id: string; ctNo: string | null }; firm: DocFirm; nextNo: string; today: string; warnRefs: string[]; canWrite: boolean;
}) {
  const router = useRouter();
  const [x, setX] = useState<HrDiDoc>({ kind: 'warn', date: today, no: '', days: 15, notice: 1, viol: [], mtype: 'opomena', pct: 10, months: 1 });
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  const upd = (patch: Partial<HrDiDoc>) => {
    const y = { ...x, ...patch };
    if (patch.kind === 'istek') y.last = employee.end || y.last;
    if (patch.kind === 'otkaz' && !y.ground) y.ground = 'licna';
    if (['date', 'notice', 'ground', 'recv', 'kind'].some((k) => k in patch) && (y.kind === 'otkaz' || y.kind === 'quit')) y.last = hrDiLastDay(y);
    setX(y);
  };
  const F = (k: keyof HrDiDoc, l: string, type = 'text') => (
    <label className="f">{l}<input type={type} value={String(x[k] ?? '')} onChange={(ev) => upd({ [k]: type === 'number' ? (ev.target.value === '' ? undefined : +ev.target.value) : ev.target.value } as Partial<HrDiDoc>)} /></label>
  );
  const W = hrDiWarnings(x);
  const preview = diHtml(firm, employee, { ...x, no: x.no || nextNo }, '—');
  return (
    <div className="card">
      {msg.error && <div className="callout bad">{msg.error}</div>}
      {msg.ok && <div className="callout good">{msg.ok}</div>}
      <div className="ctgrid" style={{ display: 'grid', gridTemplateColumns: 'minmax(320px,1fr) minmax(0,1.3fr)', gap: 14, alignItems: 'start' }}>
        <div>
          <div className="form">
            <label className="f wide">Документ<select value={x.kind} onChange={(ev) => upd({ kind: ev.target.value as HrDiKind })}>{HR_DI_KIND.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
            <label className="f">Број (празно = {nextNo})<input value={x.no ?? ''} onChange={(ev) => upd({ no: ev.target.value })} /></label>
            {F('date', 'Датум', 'date')}
            {x.kind === 'warn' && F('days', 'Рок за отстранување (дена)', 'number')}
            {x.kind === 'mera' && <>
              <label className="f">Мерка<select value={x.mtype} onChange={(ev) => upd({ mtype: ev.target.value as HrDiDoc['mtype'] })}><option value="opomena">Опомена</option><option value="kazna">Парична казна</option></select></label>
              {x.mtype === 'kazna' && <>{F('pct', '% од нето плата (до 15)', 'number')}{F('months', 'Месеци (1–6)', 'number')}{F('from', 'Од плата за месец', 'month')}</>}
              {F('heard', 'Изјаснување на работникот (датум)', 'date')}
            </>}
            {x.kind === 'otkaz' && <>
              <label className="f wide">Причина<select value={x.ground} onChange={(ev) => upd({ ground: ev.target.value })}>{HR_DI_GR.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
              {x.ground !== 'vina_bez' && F('notice', 'Отказен рок (месеци)', 'number')}
              {F('last', 'Последен работен ден', 'date')}
              {(x.ground === 'licna' || x.ground === 'vina') && <label className="f wide">Претходно писмено предупредување (бр./датум)<input list="di_wl" value={x.wref ?? ''} onChange={(ev) => upd({ wref: ev.target.value })} /><datalist id="di_wl">{warnRefs.map((w) => <option key={w} value={w} />)}</datalist></label>}
            </>}
            {x.kind === 'spog' && <>{F('last', 'Престанок на ден', 'date')}{F('sev', 'Еднократен износ (опц.)', 'number')}</>}
            {x.kind === 'quit' && <>{F('recv', 'Отказот примен на', 'date')}{F('notice', 'Отказен рок (месеци)', 'number')}{F('last', 'Последен работен ден', 'date')}</>}
            {x.kind === 'istek' && F('last', 'Договорот важи до', 'date')}
          </div>
          {['warn', 'mera', 'otkaz'].includes(x.kind) && <>
            <div style={{ marginTop: 6 }}><b>Повреди</b> (член 81){HR_DI_VIOL.map((v) => (
              <label className="chk" key={v} style={{ display: 'block', margin: '2px 0' }}><input type="checkbox" checked={(x.viol ?? []).includes(v)}
                onChange={(ev) => { const L = new Set(x.viol ?? []); if (ev.target.checked) L.add(v); else L.delete(v); upd({ viol: [...L] }); }} /> {v}</label>
            ))}</div>
            <label className="f wide" style={{ marginTop: 6 }}>{x.kind === 'warn' ? 'Што не е исполнето (факти)' : 'Образложение (факти: што, кога, како)'}<textarea rows={4} value={x.facts ?? ''} onChange={(ev) => upd({ facts: ev.target.value })} style={{ width: '100%', font: 'inherit' }} /></label>
          </>}
          {W.length > 0 && <div className="callout warn" style={{ marginTop: 8 }}>{W.map((w) => <div key={w}>{w}</div>)}</div>}
          {canWrite && <div className="row" style={{ marginTop: 8, gap: 8 }}>
            <button className="btn pri" disabled={pending} onClick={() => start(async () => { const r = await saveDiAction(employee.id, x); setMsg(r); if (!r.error) { setX({ ...x, no: '' }); router.refresh(); } })}>Зачувај во досие</button>
            {hrDiEnds(x.kind) && <button className="btn danger" disabled={pending} onClick={() => {
              if (!x.last) { setMsg({ error: 'Внесете последен работен ден.' }); return; }
              if (!window.confirm(`Работниот однос на ${employee.name} престанува на ${x.last.split('-').reverse().join('.')}.\nВо програмата се внесува датум на престанок (за платите и МПИН). Ништо не се брише.`)) return;
              start(async () => { const r = await applyTerminationAction(employee.id, x); setMsg(r); if (!r.error) router.refresh(); });
            }}>⏹ Примени престанок (крај {x.last ? x.last.split('-').reverse().join('.') : '—'})</button>}
          </div>}
          <p className="note">Образец според Законот за работните односи. Пред врачување проверете со колективниот договор / правник. Документот се врачува лично или препорачано, со потпис за прием. По зачувувањето се печати од „Историја“ (со деловоден број и контролен код).</p>
        </div>
        <div className="pdfwrap" style={{ maxHeight: '72vh', overflow: 'auto', background: '#fff', border: '1px solid var(--line)', borderRadius: 8 }}>
          <div className="pdfdoc" style={{ padding: '6mm', width: 'auto' }} dangerouslySetInnerHTML={{ __html: preview }} />
        </div>
      </div>
    </div>
  );
}
