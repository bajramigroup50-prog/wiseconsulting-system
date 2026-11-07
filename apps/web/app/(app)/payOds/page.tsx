/**
 * Плата › „🗓 Отсуства“: породилно, боледување (до 30 дена на работодавачот, од 31-виот ден ФЗО – автоматски),
 * годишен одмор, платено / неплатено отсуство — per employee with from–to dates, the decision number and the decision
 * attached. The monthly payroll takes the hours by itself (new month, or „⟳ Примени во платата“ on a draft month);
 * the year table shows the days per employee and kind. Overlapping absences of an employee are refused.
 */
import Link from 'next/link';
import { and, eq, inArray } from 'drizzle-orm';
import { ABSENCE_KINDS, absenceDays, workHoursBetween } from '@wise/core';
import { absenceFiles, firmPsif, listAbsences } from '@wise/db';
import { ActionForm } from '@/components/action-form';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { UploadField } from '@/components/upload-field';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { firmEmployees, payPage } from '@/lib/payroll/server';
import { deleteAbsenceAction, reapplyAction, saveAbsenceAction } from './actions';

const workDays = (from: string, to: string): number => {
  let d = 0;
  for (let y = +from.slice(0, 4), m = +from.slice(5, 7); `${y}-${String(m).padStart(2, '0')}` <= to.slice(0, 7); m === 12 ? (y++, m = 1) : m++) {
    d += workHoursBetween(`${y}-${String(m).padStart(2, '0')}`, from, to).work / 8;
  }
  return d;
};

export default async function PayOdsPage({ searchParams }: { searchParams: Promise<{ e?: string; edit?: string }> }) {
  const sp = await searchParams;
  const { firm, year } = await payPage('payOds');
  if (!firm) return <NoFirm t="Отсуства" />;
  const [E, A, psif] = await Promise.all([firmEmployees(firm.id), listAbsences(db(), firm.id, { from: `${year}-01-01`, to: `${year}-12-31`, ...(sp.e ? { employeeId: sp.e } : {}) }), firmPsif(db(), firm.id)]);
  const F = await absenceFiles(db(), A.map((a) => a.id));
  const name = (id: string) => E.find((e) => e.id === id)?.name ?? '—';
  const kind = (c: string) => ABSENCE_KINDS.find((k) => k[0] === c)?.[1] ?? psif.find((p) => p.code === c)?.name ?? c;
  const payer = (c: string) => psif.find((p) => p.code === c)?.payer ?? '';
  const ed = A.find((a) => a.id === sp.edit);
  // the year per employee and kind (calendar / working days)
  const sum = new Map<string, Map<string, { cal: number; work: number }>>();
  for (const a of A) {
    const f = a.from < `${year}-01-01` ? `${year}-01-01` : a.from, t = a.to > `${year}-12-31` ? `${year}-12-31` : a.to;
    const m = sum.get(a.employeeId) ?? sum.set(a.employeeId, new Map()).get(a.employeeId)!;
    const x = m.get(a.code) ?? { cal: 0, work: 0 };
    x.cal += absenceDays({ from: f, to: t }); x.work += workDays(f, t);
    m.set(a.code, x);
  }
  const now = new Date().toISOString().slice(0, 7);
  return (
    <>
      <Hd t="🗓 Отсуства" sub={`${firm.name} · ${year} – породилно, боледување, одмор`}>
        <a className="btn pri" href={`/payOds/izvestaj?y=${year}&k=301`} target="_blank" rel="noopener">🖨 Породилни – од / до</a>
        <a className="btn" href={`/payOds/izvestaj?y=${year}`} target="_blank" rel="noopener">🖨 Сите отсуства</a>
        <Link className="btn" href="/plati">← Пресметка на плата</Link>
      </Hd>
      <ActionForm action={saveAbsenceAction} className="card" reset={!ed}>
        <h2 style={{ fontSize: 15 }}>{ed ? `✎ ${name(ed.employeeId)}` : '+ Ново отсуство'}</h2>
        {ed && <input type="hidden" name="id" value={ed.id} />}
        <div className="form">
          <label className="f">Вработен<select name="emp" required defaultValue={ed?.employeeId ?? sp.e ?? ''}><option value="">—</option>{E.filter((e) => e.active !== false || e.id === ed?.employeeId).map((e) => <option key={e.id} value={e.id}>{e.no} {e.name}</option>)}</select></label>
          <label className="f">Вид<select name="code" required defaultValue={ed?.code ?? ''}><option value="">— изберете —</option>{ABSENCE_KINDS.map(([c, t]) => <option key={c} value={c}>{t}</option>)}</select></label>
          <label className="f">Од<input name="from" type="date" required defaultValue={ed?.from ?? ''} /></label>
          <label className="f">До<input name="to" type="date" required defaultValue={ed?.to ?? ''} /></label>
          <label className="f">Број на решение / дознака<input name="docNo" defaultValue={ed?.docNo ?? ''} /></label>
          <label className="f wide">Забелешка<input name="note" defaultValue={ed?.note ?? ''} /></label>
          <UploadField firmId={firm.id} capture accept="image/*,application/pdf" label="📎 Прикачи решение / дознака (PDF / слика)" />
        </div>
        <div className="row" style={{ gap: 8 }}><button className="btn pri">{ed ? 'Зачувај' : '+ Додај'}</button>{ed && <Link className="btn" href="/payOds">Откажи</Link>}</div>
        <p className="note">Платата ги зема <b>работните денови</b> на отсуството во месецот (сабота, недела и празници не се отсуство) со процентот и исплатувачот од шифрата. Боледување на товар на работодавачот <b>од 31-виот ден</b> автоматски станува „над 30 дена (ФЗО)“. Породилното и боледувањето на ФЗО се гледаат во „Боледувања и ФЗО“ (барање за рефундација).</p>
      </ActionForm>

      <ActionForm action={reapplyAction} className="card" reset={false}>
        <div className="row" style={{ gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
          <label className="f">Месец<input name="month" type="month" defaultValue={now} /></label>
          <button className="btn">⟳ Примени отсуства и задршки во платата</button>
          <span className="mini">за веќе направена, непрокнижена плата (рачно внесените ставки остануваат)</span>
        </div>
      </ActionForm>

      <div className="card">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <Link className={'btn sm' + (!sp.e ? ' pri' : '')} href="/payOds">Сите</Link>
          {E.filter((e) => sum.has(e.id)).map((e) => <Link key={e.id} className={'btn sm' + (sp.e === e.id ? ' pri' : '')} href={`/payOds?e=${e.id}`}>{e.name}</Link>)}
        </div>
        {A.length ? (
          <div className="tw"><table>
            <thead><tr><th>Вработен</th><th>Вид</th><th>Од</th><th>До</th><th className="n">Календарски</th><th className="n">Работни</th><th>Плаќа</th><th>Решение</th><th /></tr></thead>
            <tbody>{A.map((a) => (
              <tr key={a.id}>
                <td>{name(a.employeeId)}</td><td>{kind(a.code)}{a.note ? <div className="mini">{a.note}</div> : null}</td>
                <td>{dmy(a.from)}</td><td>{dmy(a.to)}</td><td className="n">{absenceDays(a)}</td><td className="n">{workDays(a.from, a.to)}</td>
                <td className="mini">{payer(a.code)}{/^20[1-7]$/.test(a.code) && absenceDays(a) > 30 ? ' → ФЗО од 31-виот ден' : ''}</td>
                <td>{a.docNo ?? ''} {(F.get(a.id) ?? []).map((f, i) => <a key={f} className="btn sm" href={`/api/files/${f}`} target="_blank" rel="noopener">👁{(F.get(a.id)?.length ?? 0) > 1 ? i + 1 : ''}</a>)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <Link className="btn sm" href={`/payOds?edit=${a.id}`} title="Промени / прикачи">✎</Link>
                  <RowAction label="🗑" title="Избриши" confirm="Да се избрише отсуството?" action={deleteAbsenceAction.bind(null, a.id)} />
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="note">Нема внесени отсуства за {year}.</p>}
      </div>

      {sum.size > 0 && (
        <div className="card">
          <h2 style={{ fontSize: 15 }}>📊 {year} по вработен (работни денови)</h2>
          <table className="dense"><thead><tr><th>Вработен</th>{[...new Set(A.map((a) => a.code))].map((c) => <th key={c} className="n">{kind(c)}</th>)}</tr></thead>
            <tbody>{[...sum].map(([id, m]) => <tr key={id}><td>{name(id)}</td>{[...new Set(A.map((a) => a.code))].map((c) => <td key={c} className="n">{m.get(c)?.work ?? ''}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
