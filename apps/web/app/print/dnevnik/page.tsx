/**
 * Print view of the journal of the year (legacy `ACT.ledPdf` 7269, also the „Дневник на книжења“ report 8149):
 * Датум · Извор · Документ · Конто + назив · Партнер · Должи · Побарува, landscape, totals, signatures.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { NAL_DEF } from '@wise/core';
import { effectiveChart, journalLines, journals, partners } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { FirmHead, Sig } from '../firm-head';
import { printGuard } from '../guard';

export const metadata = { title: 'Дневник на книжења' };

export default async function PrintDnevnik() {
  const { firm, year } = await printGuard('nalozi');
  const [L, chart] = await Promise.all([
    db().select({ date: journals.date, number: journals.number, kind: journals.kind, description: journals.description, account: journalLines.account, debit: journalLines.debit, credit: journalLines.credit, doc: journalLines.doc, p: partners.name })
      .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId)).leftJoin(partners, eq(partners.id, journalLines.partnerId))
      .where(and(eq(journals.firmId, firm.id), sql`${journals.date} between ${`${year}-01-01`} and ${`${year}-12-31`}`))
      .orderBy(asc(journals.date), asc(journals.createdAt), asc(journalLines.lineNo)),
    effectiveChart(db(), firm.id),
  ]);
  const names = new Map(chart.map((a) => [a.code, a.name]));
  return (
    <div className="pdfdoc land">
      <style dangerouslySetInnerHTML={{ __html: '@page{size:A4 landscape}' }} />
      <FirmHead firm={firm} title="ДНЕВНИК НА КНИЖЕЊА" sub={'Година ' + year} />
      <table>
        <thead><tr><th>Датум</th><th>Налог</th><th>Извор</th><th>Документ</th><th>Конто</th><th>Партнер</th><th className="n">Должи</th><th className="n">Побарува</th></tr></thead>
        <tbody>{L.map((l, i) => (
          <tr key={i}><td>{dmy(l.date)}</td><td>{l.number}</td><td>{(NAL_DEF as Record<string, readonly [string, string]>)[l.kind]?.[1] ?? (l.kind === 'bank' ? 'ИЗВОД' : l.kind === 'manual' ? 'РАЧЕН НАЛОГ' : l.kind)}</td><td>{l.description}{l.doc ? ' · ' + l.doc : ''}</td><td>{l.account} {names.get(l.account) ?? ''}</td><td>{l.p ?? ''}</td>
            <td className="n">{Number(l.debit) ? fmt(l.debit) : ''}</td><td className="n">{Number(l.credit) ? fmt(l.credit) : ''}</td></tr>
        ))}</tbody>
        <tfoot><tr><td colSpan={6}>Вкупно</td><td className="n">{fmt(L.reduce((s, l) => s + Number(l.debit), 0))}</td><td className="n">{fmt(L.reduce((s, l) => s + Number(l.credit), 0))}</td></tr></tfoot>
      </table>
      <Sig />
    </div>
  );
}
