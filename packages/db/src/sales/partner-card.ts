/**
 * Data of the buyer's financial card attached to an e-mailed invoice (`partnerCardHtml` in `@wise/core/sales`): the
 * year's lines on the customer accounts (12x) for the partner up to a date, without the year-end closing.
 */
import { and, asc, eq, like, ne, sql } from 'drizzle-orm';
import type { PartnerCardRow } from '@wise/core/sales';
import type { Tx } from '../audit';
import { journalLines, journals } from '../schema/index';

const U = (x: unknown) => String(x ?? '').trim();

/** Card rows of `partnerId` from 1 January of `to`'s year up to `to` (opening balance included). */
export async function partnerCardRows(tx: Pick<Tx, 'select'>, firmId: string, partnerId: string, to: string): Promise<{ from: string; to: string; rows: PartnerCardRow[] }> {
  const from = `${to.slice(0, 4)}-01-01`;
  const R = await tx.select({
    date: journals.date, kind: journals.kind, description: journals.description, sourceType: journals.sourceType, number: journals.number,
    doc: journalLines.doc, note: journalLines.note, debit: journalLines.debit, credit: journalLines.credit,
  }).from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
    .where(and(eq(journalLines.firmId, firmId), eq(journalLines.partnerId, partnerId), like(journalLines.account, '12%'), ne(journals.kind, 'close'),
      sql`${journals.date} between ${from} and ${to}`))
    .orderBy(asc(journals.date), asc(journals.createdAt), asc(journalLines.lineNo));
  const rows = R.map((r): PartnerCardRow => {
    const d = U(r.doc), desc = U(r.description);
    const text = r.kind === 'open' || /^почет/i.test(desc) ? 'Почетно салдо'
      : r.sourceType === 'invoice' ? (/^Одобрение/i.test(desc) ? 'Одобрение бр. ' : 'Фактура бр. ') + d
      : r.sourceType === 'bank_statement' || r.kind === 'bank' ? 'Плаќање – извод' + (d ? ` (ф-ра ${d})` : '')
      : desc || U(r.note) || 'Налог ' + U(r.number);
    return { date: String(r.date), text, debit: Number(r.debit) || 0, credit: Number(r.credit) || 0 };
  });
  return { from, to, rows };
}
