import 'server-only';
/** Legacy `paList` 13834: partners with a balance on 120 / 162 / 220 / 262 at `to`, with their confirmation rows. */
import { and, desc, eq, ilike, inArray } from 'drizzle-orm';
import { balanceConfirmation } from '@wise/core/finance';
import { mailLog } from '@wise/db';
import { db } from '@/lib/db';
import { finLines, partnerMap } from '@/lib/finance';

export async function confirmationList(firmId: string, year: number, to: string) {
  const [lines, P] = await Promise.all([finLines(firmId, `${year}-01-01`, to, { accountRe: '^(12|16|22|26)' }), partnerMap(firmId)]);
  const ids = [...new Set(lines.filter((l) => l.partnerId).map((l) => l.partnerId!))];
  const out = ids.map((pid) => {
    const p = P.get(pid);
    const R = balanceConfirmation(lines, pid, to);
    return { pid, p, name: p?.name ?? '(без име)', code: p?.code ?? '', email: String(p?.email ?? '').split(/[,;\s]+/).filter(Boolean)[0] ?? '', R, nz: R.filter((r) => Math.abs(r.v) > 0.004) };
  }).filter((x) => x.p && x.nz.length).sort((a, b) => a.name.localeCompare(b.name, 'mk'));
  // last confirmation sent per partner (legacy: maillog docs with „Потврда“ in the subject)
  const M = out.length ? await db().select({ entityId: mailLog.entityId, at: mailLog.createdAt }).from(mailLog)
    .where(and(eq(mailLog.firmId, firmId), eq(mailLog.entityType, 'potvrda'), inArray(mailLog.entityId, out.map((x) => x.pid)), ilike(mailLog.subject, '%Потврда%')))
    .orderBy(desc(mailLog.createdAt)) : [];
  const last = new Map<string, Date>();
  for (const m of M) if (m.entityId && !last.has(m.entityId)) last.set(m.entityId, m.at);
  return { list: out, last, lines };
}
