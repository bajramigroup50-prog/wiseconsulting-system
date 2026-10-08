/** Legacy `VIEWS.plati` (month list, `payMonths` 6168) + pay-notes card (`pnCard` 15240), Плата › Пресметка на плата. */
import Link from 'next/link';
import { and, asc, eq, like } from 'drizzle-orm';
import { payNotesOpen } from '@wise/core';
import { journals, payrollNotes, payrollRuns } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { firmEmployees, payPage } from '@/lib/payroll/server';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { recalcAllAction } from './actions';
import { NewMonth } from './new-month';
import { NotesCard } from './notes-card';

export default async function PlatiPage() {
  const { u, firm, year } = await payPage('plati');
  if (!firm) return <NoFirm t="Пресметка на плата" />;
  const [runs, notes, emps] = await Promise.all([
    db().select({ r: payrollRuns, number: journals.number }).from(payrollRuns).leftJoin(journals, eq(journals.id, payrollRuns.journalId))
      .where(and(eq(payrollRuns.firmId, firm.id), like(payrollRuns.month, `${year}-%`))).orderBy(asc(payrollRuns.month)),
    db().select().from(payrollNotes).where(eq(payrollNotes.firmId, firm.id)).orderBy(asc(payrollNotes.month), asc(payrollNotes.createdAt)),
    firmEmployees(firm.id),
  ]);
  const write = canDo(u, 'write', firm.id);
  const last = runs.at(-1)?.r.month;
  const next = last ? (last.slice(5) === '12' ? `${+last.slice(0, 4) + 1}-01` : `${last.slice(0, 4)}-${String(+last.slice(5) + 1).padStart(2, '0')}`) : `${year}-${new Date().toISOString().slice(5, 7)}`;
  const today = new Date().toISOString().slice(0, 7);
  return (
    <>
      <Hd t="Пресметка на плата" sub="избор на месец">
        <Link className="btn" href="/vraboteni">Матични податоци за вработени</Link>
        <Link className="btn" href="/plati/parametri">Параметри по периоди</Link>
        <Link className="btn" href="/payGod">Годишен извештај</Link>
      </Hd>
      <NotesCard notes={notes.map((n) => ({ ...n, doneAt: n.doneAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() }))}
        month={next < today ? today : next} open={payNotesOpen(notes, next).length} employees={emps.filter((e) => e.active).map((e) => ({ id: e.id, name: e.name, position: e.position }))}
        canWrite={write} canDel={canDo(u, 'del', firm.id)} />
      <div className="pay-win">
        <div className="tw" style={{ minWidth: 0 }}><table className="dense">
          <thead><tr><th>Година</th><th>Месец</th><th>Статус</th><th>Закл.</th><th className="n">Вработени</th><th className="n">Бруто</th><th className="n">Износ за исплата</th><th>Налог</th></tr></thead>
          <tbody>
            {runs.map(({ r, number }) => (
              <tr key={r.id}>
                <td>{r.month.slice(0, 4)}</td>
                <td><Link href={`/plati/${r.month}`}><b>{r.month.slice(5, 7)}</b></Link></td>
                <td>{r.status === 'posted' ? <span className="pill good">прокнижено</span> : <span className="pill warn">нацрт</span>}</td>
                <td>{r.locked ? <span className="pill bad">Да</span> : 'Не'}</td>
                <td className="n">{r.totals.emps ?? 0}</td><td className="n">{fmt(r.totals.gross)}</td><td className="n">{fmt(r.totals.net)}</td>
                <td>{number ?? ''}</td>
              </tr>
            ))}
            {!runs.length && <tr><td colSpan={8} className="note">Нема пресметани месеци за {year}. Креирајте нов месец.</td></tr>}
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
      <p className="note">Отворете го месецот за „Содржина на пресметка“. Заклучен месец не може да се менува ниту брише. Ставките по вработен (редовно, боледување, одмори, прекувремено, корекции, синдикат) се внесуваат во „Преглед“ на вработениот. Вработени во фирмата: {emps.filter((e) => e.active).length}.</p>
    </>
  );
}
