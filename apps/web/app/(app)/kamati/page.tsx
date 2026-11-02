/**
 * Legacy `VIEWS.kamati` 5875 — Камати › Казнена камата (каматен лист): late invoices, interest to a date, „Фактурирај камата“.
 * Like legacy `sInv()` every overdue invoice counts, whatever its year (only due < „Пресметај до“). Like the Helix
 * „каматна листа“ the interest follows the dated payments (paid late / in parts) and the office rate table by period.
 */
import { and, desc, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { daysLate } from '@wise/core/finance';
import { invoices, journalLines, journals, partners } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { isDate, today } from '@/lib/finance';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { ExportBar, type Cell } from '@/components/parity-fin/export-bar';
import { ActionForm } from '@/components/action-form';
import { kamDelAction, kamNoteAction, kamRatesAction } from './actions';
import { kamInvoice, kamRates } from './kam';

export default async function KamatiPage({ searchParams }: { searchParams: Promise<{ rate?: string; d?: string }> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('kamati');
  if (!firm) return <NoFirm t="Казнена камата" />;
  const rate = Number(String(sp.rate ?? '').replace(',', '.')) || 0;
  const asOf = isDate(sp.d) ? sp.d : today();
  const I = await db().select({ id: invoices.id, number: invoices.number, due: invoices.due, partnerId: invoices.partnerId, pname: partners.name })
    .from(invoices).leftJoin(partners, eq(partners.id, invoices.partnerId))
    .where(and(eq(invoices.firmId, firm.id), eq(invoices.kind, 'invoice'), eq(invoices.status, 'posted'), isNotNull(invoices.due), lt(invoices.due, asOf)))
    .orderBy(invoices.due);
  const rates = await kamRates();
  const K = await db().transaction((tx) => kamInvoice(tx, firm.id, I.map((i) => ({ id: i.id, due: i.due! })), asOf, rate, rates));
  const rows = I.map((i) => {
    const x = K.get(i.id);
    return { i, o: x?.open ?? 0, late: x?.paidLate ?? 0, days: daysLate(i.due, asOf), k: x?.k ?? 0, segs: x?.segs ?? [] };
  }).filter((x) => x.k > 0.009 || (x.o > 0.009 && x.days > 0));
  const done = await db().select({ id: journals.id, date: journals.date, description: journals.description, number: journals.number, amt: sql<string>`sum(${journalLines.debit})` })
    .from(journals).innerJoin(journalLines, eq(journalLines.journalId, journals.id))
    .where(and(eq(journals.firmId, firm.id), eq(journals.kind, 'kamata'), sql`${journals.date} between ${year + '-01-01'} and ${year + '-12-31'}`))
    .groupBy(journals.id).orderBy(desc(journals.date));
  const write = canDo(u, 'kamNote', firm.id);
  const xrows: Cell[][] = [['Фактура', 'Купувач', 'Рок', 'Денови доцнење', 'Долг', 'Платено со задоцнување', 'Камата'],
    ...rows.map((x) => [x.i.number, x.i.pname ?? '', dmy(x.i.due), x.days, x.o, x.late, x.k] as Cell[]),
    ['Вкупно', '', '', '', Math.round(rows.reduce((a, x) => a + x.o, 0) * 100) / 100, Math.round(rows.reduce((a, x) => a + x.late, 0) * 100) / 100, Math.round(rows.reduce((a, x) => a + x.k, 0) * 100) / 100]];
  const canRates = !['klient', 'teren', 'view'].includes(u.role);
  return (
    <>
      <Hd t="Казнена камата" sub="каматен лист" excel={false} />
      <form className="card">
        <div className="form">
          <label className="f">Годишна стапка на казнена камата %<input name="rate" type="number" step="any" defaultValue={rate || ''} placeholder={rates.length ? 'празно = по табелата' : 'референтна стапка на НБРСМ + 8'} /></label>
          <label className="f">Пресметај до<input name="d" type="date" defaultValue={asOf} /></label>
        </div>
        <div className="row"><button className="btn">Пресметај</button></div>
        <p className="note">Според Законот за облигационите односи, казнената камата = референтната стапка на НБРСМ + 8 процентни поени, утврдена за секое полугодие.
          {rates.length ? ' Со празна стапка се пресметува по табелата подолу (секој период со својата стапка).' : ' Внесете ја стапката или пополнете ја табелата подолу.'} Каматата се пресметува од рокот до секоја уплата на преостанатиот долг – и за фактури платени со задоцнување.</p>
      </form>
      <details className="card">
        <summary><b>Стапки по периоди</b> ({rates.length})</summary>
        <ActionForm action={kamRatesAction}>
          <table style={{ maxWidth: 380 }}><thead><tr><th>Од датум</th><th className="n">Стапка %</th></tr></thead>
            <tbody>{[...rates, ...Array.from({ length: 4 }, () => ({ from: '', rate: 0 }))].map((r, i) => (
              <tr key={i}><td><input name="from" type="date" defaultValue={r.from} disabled={!canRates} /></td><td><input name="rate" type="number" step="any" defaultValue={r.rate || ''} disabled={!canRates} style={{ width: 90 }} /></td></tr>))}</tbody></table>
          {canRates && <button className="btn pri">Зачувај стапки</button>}
          <p className="note">Внесете ја стапката (референтна стапка на НБРСМ + 8) за секое полугодие, на пр. 01.01 и 01.07. Важи за сите фирми. За да избришете ред, испразнете го.</p>
        </ActionForm>
      </details>
      {rows.length ? (<>
        <div className="row"><ExportBar pdf={false} name={`kamati_${asOf}`} title={`Каматен лист до ${dmy(asOf)}${rate ? ` · ${rate}%` : rates.length ? ' · по табела на стапки' : ''}`} rows={xrows} /></div>
        <div className="tw" id="finArea"><table>
          <thead><tr><th>Фактура</th><th>Купувач</th><th>Рок</th><th className="n">Денови доцнење</th><th className="n">Долг</th><th className="n">Платено со задоцнување</th><th className="n">Камата</th><th className="noprint" /></tr></thead>
          <tbody>{rows.map((x) => (
            <tr key={x.i.id}><td>{x.i.number}</td><td>{x.i.pname}</td><td>{dmy(x.i.due)}</td><td className="n">{x.days}</td><td className="n">{fmt(x.o)}</td><td className="n">{x.late ? fmt(x.late) : ''}</td>
              <td className="n" title={x.segs.map((g) => `${dmy(g.from)}–${dmy(g.to)}: ${g.days} д. × ${fmt(g.base)} × ${g.rate}% = ${fmt(g.k)}`).join('\n')}>{fmt(x.k)}</td>
              <td className="noprint">{write && x.k > 0 && (rate > 0 || rates.length > 0) && <RowAction className="btn sm" label="Фактурирај камата" action={kamNoteAction.bind(null, x.i.id, rate, asOf)} />}</td></tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={4}>Вкупно</td><td className="n">{fmt(rows.reduce((a, x) => a + x.o, 0))}</td><td className="n">{fmt(rows.reduce((a, x) => a + x.late, 0))}</td><td className="n">{fmt(rows.reduce((a, x) => a + x.k, 0))}</td><td className="noprint" /></tr></tfoot>
        </table></div>
      </>) : <div className="card empty">Нема фактури со задоцнето плаќање.</div>}
      {done.length > 0 && (
        <div className="card"><h2>Фактурирани камати {year}</h2>
          <div className="tw"><table><tbody>{done.map((j) => <tr key={j.id}><td>{dmy(j.date)}</td><td>{j.number}</td><td>{j.description}</td><td className="n">{fmt(Number(j.amt))}</td>
            <td>{canDo(u, 'nalDel', firm.id) && <RowAction label="🗑" title="Избриши" confirm="Да се избрише книжењето на каматата?" action={kamDelAction.bind(null, j.id)} />}</td></tr>)}</tbody></table></div>
        </div>
      )}
    </>
  );
}
