import 'server-only';
/**
 * 📈 Loader of „Споредба со дејноста“ (Анализи): the open firm and the other active office firms of the same
 * `firms.activity` (same side: real ↔ demo), each as one account → (debit − credit) map of the year to date — a
 * single SQL aggregation `group by firm, account` over `journal_lines` ⋈ `journals` (closing journal left out).
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { anDays } from '@wise/core/analysis';
import { isDemoFirm } from '@wise/core/demo';
import { activityKey, benchCompare, benchMetrics, type BenchMetrics, type BenchRow } from '@wise/core/fin-bench';
import { demoFirmSql, firms, journalLines, journals, realFirmSql, type Firm } from '@wise/db';
import { db } from './db';

export interface BenchData { activity: string; peers: number; own: BenchMetrics; rows: BenchRow[] | null; from: string; to: string }

export async function loadBench(firm: Firm, year: number, today: string): Promise<BenchData> {
  const act = activityKey(firm.activity);
  const from = `${year}-01-01`, to = today.startsWith(String(year)) ? today : `${year}-12-31`;
  const days = anDays({ from, to }, today);
  const empty = { gm: null, nm: null, dso: null, cur: null, score: null };
  if (!act) return { activity: '', peers: 0, own: empty, rows: null, from, to };
  const side = isDemoFirm(firm) ? demoFirmSql : realFirmSql;
  const F = await db().select({ id: firms.id, activity: firms.activity }).from(firms)
    .where(and(side, eq(firms.active, true), ne(firms.id, firm.id), sql`${firms.activity} is not null`));
  const ids = [firm.id, ...F.filter((f) => activityKey(f.activity) === act).map((f) => f.id)];
  const B = new Map<string, Record<string, number>>();
  {
    const rows = await db().select({ f: journalLines.firmId, a: journalLines.account, v: sql<string>`sum(${journalLines.debit} - ${journalLines.credit})` })
      .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
      .where(and(inArray(journalLines.firmId, ids), sql`${journals.date} between ${from} and ${to}`, ne(journals.kind, 'close')))
      .groupBy(journalLines.firmId, journalLines.account);
    for (const r of rows) { const m = B.get(r.f) ?? {}; m[r.a] = (m[r.a] ?? 0) + Number(r.v); B.set(r.f, m); }
  }
  const own = benchMetrics(B.get(firm.id) ?? {}, days);
  // peers with books this year (a firm without postings would only pull the medians to zero)
  const peers = ids.slice(1).filter((id) => B.has(id)).map((id) => benchMetrics(B.get(id)!, days));
  return { activity: firm.activity ?? '', peers: peers.length, own, rows: benchCompare(own, peers), from, to };
}
