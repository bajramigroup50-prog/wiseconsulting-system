/** Legacy `VIEWS.plati` (month list, `payMonths` 6168) + pay-notes card (`pnCard` 15240), Плата › Пресметка на плата. */
import Link from 'next/link';
import { and, asc, eq, like, sql } from 'drizzle-orm';
import { payNotesOpen } from '@wise/core';
import { journals, mpinAcks, payrollEmp, payrollNotes, payrollRuns } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { firmEmployees, payPage } from '@/lib/payroll/server';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { recalcAllAction } from './actions';
import { NewMonth } from './new-month';
import { NotesCard } from './notes-card';
import { PayXlsxBox } from './xlsx-box';
import { deleteMpinMonth } from '../mpinIn/actions';

export default async function PlatiPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? '').trim();
  const { u, firm, year } = await payPage('plati');
  if (!firm) return <NoFirm t="Пресметка на плата" />;
  const [runs, notes, emps] = await Promise.all([
    db().select({ r: payrollRuns, number: journals.number }).from(payrollRuns).leftJoin(journals, eq(journals.id, payrollRuns.journalId))
      .where(and(eq(payrollRuns.firmId, firm.id), like(payrollRuns.month, `${year}-%`))).orderBy(asc(payrollRuns.month)),
    db().select().from(payrollNotes).where(eq(payrollNotes.firmId, firm.id)).orderBy(asc(payrollNotes.month), asc(payrollNotes.createdAt)),
    firmEmployees(firm.id),
  ]);
  // МПИН вратени од УЈП (legacy v451 `VIEWS.plati` wrapper 14098)
  const acks = await db().select().from(mpinAcks).where(and(eq(mpinAcks.firmId, firm.id), like(mpinAcks.month, `${year}-%`), eq(mpinAcks.replaced, false))).orderBy(asc(mpinAcks.month));
  const ackOf = (mo: string) => acks.find((a) => a.month === mo);
  const ex = acks.filter((a) => !runs.some(({ r }) => r.month === a.month));
  const write = canDo(u, 'write', firm.id);
  const last = runs.at(-1)?.r.month;
  const next = last ? (last.slice(5) === '12' ? `${+last.slice(0, 4) + 1}-01` : `${last.slice(0, 4)}-${String(+last.slice(5) + 1).padStart(2, '0')}`) : `${year}-${new Date().toISOString().slice(5, 7)}`;
  const today = new Date().toISOString().slice(0, 7);
  const admin = u.role === 'admin' && canDo(u, 'del', firm.id);
  const mpinDel = (mo: string) => admin && (
    <> <RowAction className="btn sm ghost" action={deleteMpinMonth.bind(null, firm.id, mo)} label="🗑" title="Избриши МПИН (за корекција)"
      confirm={`Да се избрише МПИН за ${mo.slice(5)}/${mo.slice(0, 4)} – ${firm.name}?

Се брише: PDF во досие, ознаката „МПИН прифатен“ и НАЛОГОТ од МПИН (книжењето), ако постои.
Потоа може да прикачите друг (коригиран) МПИН.`} /></>
  );
  // Legacy `payFind` 7115: an employee across the year's months (name or number).
  const found = q ? await db().select({ month: payrollRuns.month, empId: payrollEmp.employeeId, name: payrollEmp.name, no: payrollEmp.no, gross: payrollEmp.gross, net: payrollEmp.net })
    .from(payrollEmp).innerJoin(payrollRuns, eq(payrollRuns.id, payrollEmp.runId))
    .where(and(eq(payrollRuns.firmId, firm.id), like(payrollRuns.month, `${year}-%`), sql`lower(coalesce(${payrollEmp.name},'') || ' ' || coalesce(${payrollEmp.no},'')) like ${'%' + q.toLowerCase() + '%'}`))
    .orderBy(asc(payrollRuns.month), asc(payrollEmp.pos)).limit(500) : [];
  return (
    <>
      <Hd t="Пресметка на плата" sub="избор на месец">
        <Link className="btn" href="/vraboteni">Матични податоци за вработени</Link>
        <Link className="btn" href="/plati/parametri">Параметри по периоди</Link>
        <Link className="btn" href="/payGod">Годишен извештај</Link>
        <Link className="btn" href="/cb_paysif" title="Дефинирани ставки на платата – Измени шифри">Дефинирани ставки</Link>
        <Link className="btn ghost" href="/cb_paysif">Измени шифри</Link>
      </Hd>
      {write && <PayXlsxBox next={next < today ? today : next} />}
      <form className="row" style={{ gap: 8, margin: '8px 0' }}>
        <input name="q" defaultValue={q} placeholder="Пребарај вработен (име или шифра)" style={{ flex: 1, minWidth: 200 }} />
        <button className="btn">Пребарувај</button>
        {q && <Link className="btn ghost" href="/plati">✕</Link>}
      </form>
      {q && (
        <div className="card">
          <div className="hd"><h2>Резултати за „{q}“ ({found.length})</h2></div>
          {found.length ? (
            <table className="dense"><thead><tr><th>Месец</th><th>Вработен</th><th className="n">Бруто</th><th className="n">Нето</th><th></th></tr></thead>
              <tbody>{found.map((f, i) => (
                <tr key={i}><td>{f.month.slice(5)}/{f.month.slice(0, 4)}</td><td>{f.no ? f.no + ' ' : ''}{f.name}</td><td className="n">{fmt(f.gross)}</td><td className="n">{fmt(f.net)}</td>
                  <td><Link className="btn sm" href={`/plati/${f.month}${f.empId ? '?e=' + f.empId : ''}`}>Отвори</Link></td></tr>
              ))}</tbody></table>
          ) : <p className="note">Нема резултати.</p>}
        </div>
      )}
      <NotesCard notes={notes.map((n) => ({ ...n, doneAt: n.doneAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() }))}
        month={next < today ? today : next} open={payNotesOpen(notes, next).length} employees={emps.filter((e) => e.active).map((e) => ({ id: e.id, name: e.name, position: e.position }))}
        canWrite={write} canDel={canDo(u, 'del', firm.id)} />
      <div className="pay-win">
        <div className="tw" style={{ minWidth: 0 }}><table className="dense">
          <thead><tr><th>Година</th><th>Месец</th><th>Статус</th><th>Закл.</th><th className="n">Вработени</th><th className="n">Бруто</th><th className="n">Износ за исплата</th><th>Налог</th><th>МПИН од УЈП</th><th></th></tr></thead>
          <tbody>
            {runs.map(({ r, number }) => (
              <tr key={r.id}>
                <td>{r.month.slice(0, 4)}</td>
                <td><Link href={`/plati/${r.month}`}><b>{r.month.slice(5, 7)}</b></Link></td>
                <td>{r.status === 'posted' ? <span className="pill good">прокнижено</span> : <span className="pill warn">нацрт</span>}</td>
                <td>{r.locked ? <span className="pill bad">Да</span> : 'Не'}</td>
                <td className="n">{r.totals.emps ?? 0}</td><td className="n">{fmt(r.totals.gross)}</td><td className="n">{fmt(r.totals.net)}</td>
                <td>{number ?? ''}</td>
                <td>{(() => { const a = ackOf(r.month); return a ? <><span className="pill good" title={`${a.status ?? ''}${a.date ? ' · ' + dmy(a.date) : ''}`}>✓ {a.no || 'прифатен'}</span>{a.fileId && <> <a className="btn sm ghost" href={`/api/files/${a.fileId}`} target="_blank" rel="noopener">PDF</a></>}{mpinDel(r.month)}</> : <span className="note">—</span>; })()}</td>
                <td><Link className="btn sm ghost" href={`/plati/${r.month}/pecati?d=rec`} target="_blank" title="Преглед (F10) – рекапитулар">Преглед</Link></td>
              </tr>
            ))}
            {!runs.length && <tr><td colSpan={10} className="note">Нема пресметани месеци за {year}. Креирајте нов месец.</td></tr>}
          </tbody>
        </table></div>
        <div className="pay-btns">
          {write && <NewMonth next={next} />}
          <Link className="btn" href="/payPredlog">Внеси предлог податоци</Link>
          <Link className="btn" href="/payM4">М4 Образец</Link>
          {write && runs.some(({ r }) => r.status === 'posted' && !r.locked) && (
            <RowAction className="btn" action={recalcAllAction.bind(null, year)} label="Пресметка за сите"
              confirm={`Да се пресметаат и прокнижат повторно сите отклучени прокнижени месеци од ${year}?`} />
          )}
        </div>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><b>📥 МПИН вратени од УЈП</b><Link className="btn pri" href="/mpinIn">Внеси прифатени МПИН (сите фирми)</Link></div>
        {ex.length ? (
          <>
            <p className="note">Месеци со МПИН без пресметка во програмот (прокнижени од МПИН):</p>
            <table className="dense"><thead><tr><th>Месец</th><th>Бр. за поднесување</th><th className="n">Бруто</th><th className="n">Придонеси + данок</th><th>Рок</th><th></th></tr></thead>
              <tbody>{ex.map((a) => (
                <tr key={a.id}><td>{a.month.slice(5)}/{a.month.slice(0, 4)}</td><td>{a.no ?? ''}</td><td className="n">{fmt(a.gross)}</td><td className="n">{fmt(a.total)}</td><td>{a.due ? dmy(a.due) : ''}</td>
                  <td>{a.fileId && <a className="btn sm ghost" href={`/api/files/${a.fileId}`} target="_blank" rel="noopener">PDF</a>}{mpinDel(a.month)}</td></tr>
              ))}</tbody></table>
          </>
        ) : <p className="note" style={{ marginBottom: 0 }}>Откако ќе се вратат прифатените МПИН од УЈП, прикачете ги сите одеднаш – секој се распоредува кај својата фирма.</p>}
      </div>
      <p className="note">Отворете го месецот за „Содржина на пресметка“. Заклучен месец не може да се менува ниту брише. Ставките по вработен (редовно, боледување, одмори, прекувремено, корекции, синдикат) се внесуваат во „Преглед“ на вработениот. Вработени во фирмата: {emps.filter((e) => e.active).length}.</p>
    </>
  );
}
