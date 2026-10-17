/**
 * Journal of the year line by line (legacy `ledCsv` 7259): Датум, Извор, Документ, Конто, Назив, Партнер, Должи,
 * Побарува (+ Налог and its name — the user's „✎ Назив“ or the automatic title). `?f=csv` → CSV, otherwise .xlsx.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { groupNalozi, NAL_DEF } from '@wise/core';
import { bankAccounts, effectiveChart, firmNalogSettings, journalLines, journals, partners } from '@wise/db';
import { db } from '@/lib/db';
import { nalogTitler } from '@/lib/nalog-title';
import { routeFirm, sheetResponse } from '@/lib/parity-fin';

const LBL: Record<string, string> = { ...Object.fromEntries(Object.entries(NAL_DEF).map(([k, v]) => [k, v[1]])), bank: 'ИЗВОД', manual: 'РАЧЕН НАЛОГ' };

export async function GET(req: Request) {
  const c = await routeFirm('nalozi');
  if (!c) return new Response('Forbidden', { status: 403 });
  const { firm, year } = c;
  const inYear = and(eq(journals.firmId, firm.id), sql`${journals.date} between ${`${year}-01-01`} and ${`${year}-12-31`}`);
  const [L, chart, J, banks] = await Promise.all([
    db().select({ date: journals.date, number: journals.number, kind: journals.kind, description: journals.description, account: journalLines.account, debit: journalLines.debit, credit: journalLines.credit, doc: journalLines.doc, p: partners.name })
      .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId)).leftJoin(partners, eq(partners.id, journalLines.partnerId))
      .where(inYear)
      .orderBy(asc(journals.date), asc(journals.createdAt), asc(journalLines.lineNo)),
    effectiveChart(db(), firm.id),
    db().select({ number: journals.number, date: journals.date, description: journals.description, sourceId: journals.sourceId, meta: journals.meta })
      .from(journals).where(inYear).orderBy(asc(journals.date), asc(journals.createdAt)),
    db().select({ id: bankAccounts.id, name: bankAccounts.name }).from(bankAccounts).where(eq(bankAccounts.firmId, firm.id)),
  ]);
  const nm = new Map(chart.map((a) => [a.code, a.name]));
  const T = nalogTitler({ settings: firm.settings, year, nal: firmNalogSettings(firm), banks });
  const title = new Map(groupNalozi(J).map((g) => [g.no, T.title(g)]));
  const rows = [['Датум', 'Налог', 'Назив на налог', 'Извор', 'Документ', 'Конто', 'Назив', 'Партнер', 'Должи', 'Побарува'],
    ...L.map((l) => [l.date, l.number, title.get(l.number) ?? '', LBL[l.kind] ?? l.kind, (l.description ?? '') + (l.doc ? ' · ' + l.doc : ''), l.account, nm.get(l.account) ?? '', l.p ?? '', Number(l.debit), Number(l.credit)])];
  return sheetResponse(`Dnevnik_${year}`, rows, { csv: new URL(req.url).searchParams.get('f') === 'csv', sheet: 'Дневник' });
}
