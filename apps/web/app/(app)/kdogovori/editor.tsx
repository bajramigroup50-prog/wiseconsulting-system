'use client';
/**
 * Legacy `VIEWS.kdogovori` editor branch (10355 `if(E)` + 13577 recurring note + 13608 number preview + 15514 DPA
 * annex checkbox): every field re-renders the contract preview (`kdHtml`, the same function the print view and the
 * archived PDF use).
 */
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KD_SVC, kdAmt, kdHtml, kdVat, type KdContract, type KdFirm, type KdOffice } from '@wise/core/firms/kdog';
import { saveContract } from './actions';

const fmt = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function KdEditor({ initial, firm, firmId, O, off, peekNo, offName }: {
  initial: KdContract; firm: KdFirm; firmId: string; O: KdOffice; off: KdFirm | null; peekNo: string; offName: string | null;
}) {
  const [E, setE] = useState<KdContract>(initial);
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const [busy, start] = useTransition();
  const router = useRouter();
  const set = <K extends keyof KdContract>(k: K, v: KdContract[K]) => setE((x) => ({ ...x, [k]: v }));
  const rate = kdVat(O);
  const a = kdAmt(E.feeMode, E.fee, rate);
  const html = useMemo(() => kdHtml(E, { firm, firmId, O, off, peekNo, img: (id) => `/api/files/${id}`, draftMark: true }), [E, firm, firmId, O, off, peekNo]);
  const inp = (k: keyof KdContract, label: string, o: { type?: string; step?: string; min?: number; max?: number; title?: string; wide?: boolean } = {}) => (
    <label className={o.wide ? 'f wide' : 'f'} title={o.title}>{label}
      <input type={o.type ?? 'text'} step={o.step} min={o.min} max={o.max} value={String(E[k] ?? '')}
        onChange={(e) => set(k, (o.type === 'number' ? (e.target.value === '' ? '' : e.target.value) : e.target.value) as never)} />
    </label>
  );
  return (
    <>
      <div className="card">
        <div className="form">
          {inp('date', 'Датум на договорот', { type: 'date' })}
          {inp('place', 'Место')}
          {inp('start', 'Соработката трае од', { type: 'date', title: 'Внесете го вистинскиот датум од кога работите со фирмата – може да е и пред неколку години' })}
          <label className="f">Траење<select value={E.dur} onChange={(e) => set('dur', e.target.value as 'indef' | 'def')}><option value="indef">неопределено</option><option value="def">определено</option></select></label>
          {inp('end', 'До', { type: 'date' })}
          {inp('rep', 'Застапник на клиентот')}
          {inp('repRole', 'Функција')}
          <label className="f">Цената ја внесувам<select value={E.feeMode} onChange={(e) => set('feeMode', e.target.value as 'gross' | 'net')}><option value="gross">со ДДВ (бруто)</option><option value="net">без ДДВ (нето)</option></select></label>
          {inp('fee', `Месечен надоместок ${E.feeMode === 'net' ? 'без' : 'со'} ДДВ`, { type: 'number', step: 'any' })}
          <div className="mini" style={{ alignSelf: 'end', paddingBottom: 8 }}>{Number(E.fee) && rate ? <>= {fmt(a.net)} без ДДВ + {fmt(Math.round((a.gross - a.net) * 100) / 100)} ДДВ = <b>{fmt(a.gross)}</b> со ДДВ</> : null}</div>
          {inp('empFree', 'Вклучени вработени', { type: 'number' })}
          {inp('feeEmp', 'Дополнително по вработен', { type: 'number', step: 'any' })}
          {inp('feeYear', 'Годишна сметка (еднократно)', { type: 'number', step: 'any' })}
          {inp('feeHour', 'Дополнителни услуги (ден/час)', { type: 'number', step: 'any' })}
          {inp('docDay', 'Документи до (ден во месецот)', { type: 'number', min: 1, max: 28 })}
          {inp('payDay', 'Плаќање до (ден)', { type: 'number', min: 1, max: 28 })}
          {inp('notice', 'Отказен рок (дена)', { type: 'number' })}
          {inp('note', 'Дополнителни услуги / забелешка', { wide: true })}
        </div>
        <p className="note" id="kd_recn">🔁 По зачувувањето, месечниот надоместок автоматски станува месечна фактура (последен работен ден во месецот) {offName ? <>во фирмата <b>{offName}</b></> : 'во фирмата на канцеларијата (одредете ја подолу во листата на договори)'}.</p>
        <h3 className="fh" style={{ marginTop: 10 }}>Услуги</h3>
        {KD_SVC.map(([k, n]) => (
          <label key={k} className="chk" style={{ display: 'block', margin: '3px 0' }}>
            <input type="checkbox" checked={E.svc.includes(k)} onChange={(e) => set('svc', e.target.checked ? [...E.svc, k] : E.svc.filter((x) => x !== k))} /> {n}
          </label>
        ))}
      </div>
      <div className="card"><label className="chk"><input type="checkbox" id="kd_dpa" checked={!E.noDpa} onChange={(e) => set('noDpa', !e.target.checked)} /> <b>Анекс 1 – Обработка на лични податоци (ЗЗЛП)</b> – составен дел од договорот, се потпишува заедно со него (наместо посебен договор)</label></div>
      <div className="card">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Преглед</h2>
        <div id="kd_prev" style={{ maxHeight: 460, overflow: 'auto', border: '1px solid var(--line)', padding: 16, background: '#fff', color: '#111' }} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      {msg.error && <div className="callout bad">{msg.error}</div>}
      {msg.ok && <div className="callout good">{msg.ok}</div>}
      <div className="row" style={{ gap: 8 }}>
        <span style={{ flex: 1 }} />
        <a className="btn" href="/kdogovori">Откажи</a>
        <button type="button" className="btn pri" disabled={busy} onClick={() => {
          if (!Number(E.fee) && !window.confirm('Месечниот надоместок е празен – во договорот ќе остане празна линија (________ денари) за рачно пополнување. Да се зачува така?')) return;
          start(async () => {
            const r = await saveContract(JSON.stringify(E));
            setMsg(r);
            if (!r.error) router.push('/kdogovori');
          });
        }}>{busy ? 'Се зачувува…' : 'Зачувај'}</button>
      </div>
    </>
  );
}
