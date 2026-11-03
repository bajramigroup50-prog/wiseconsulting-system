/** December payroll liabilities missing from the opening balance of `year` (see `missingPayLiabilities`). */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { missingPayLiabilities, PAY_LIAB_KONTA, type PayLiabGap } from '@wise/core/opening-paylib';
import { journalLines, journals, type Tx } from '@wise/db';

export async function payLiabGaps(tx: Tx, firmId: string, year: number): Promise<PayLiabGap[]> {
  const L = await tx.select({ account: journalLines.account, date: journals.date, kind: journals.kind, debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
    .where(and(eq(journalLines.firmId, firmId), inArray(journalLines.account, [...PAY_LIAB_KONTA]), sql`${journals.date} between ${year + '-01-01'} and ${year + '-03-31'}`));
  return missingPayLiabilities(L.map((l) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) })));
}
