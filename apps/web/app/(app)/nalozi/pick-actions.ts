'use server';
/**
 * „Налог“ field of the document dialogs (калкулација, услужна калкулација…): the firm's nalozi of the year to pick from,
 * like the old program. One row per nalog number (a nalog may hold several documents).
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { journals } from '@wise/db';
import { actionError, firmAction } from '@/lib/books';
import { db } from '@/lib/db';

export interface NalogPick { number: string; date: string; description: string; docs: number }

export async function nalogOptionsAction(year: number): Promise<{ list?: NalogPick[]; error?: string }> {
  try {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return { error: 'Невалидна година.' };
    const { firm } = await firmAction('write');
    const R = await db().select({
      number: journals.number,
      date: sql<string>`min(${journals.date})::text`,
      description: sql<string>`coalesce(max(${journals.description}), '')`,
      docs: sql<number>`count(*)::int`,
    }).from(journals)
      .where(and(eq(journals.firmId, firm.id), sql`${journals.date} between ${year + '-01-01'} and ${year + '-12-31'}`, sql`${journals.kind} not in ('open', 'close')`))
      .groupBy(journals.number)
      .orderBy(desc(sql`min(${journals.date})`), desc(journals.number))
      .limit(500);
    return { list: R };
  } catch (e) { return actionError(e); }
}
