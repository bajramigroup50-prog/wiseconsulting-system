/**
 * P38 — the monthly client reports on a schedule: on the configured day (default the 5th) the report of the month
 * that just ended is prepared for every client (`saveClientReport`, the numbers from the books — the same as
 * „⚙ Подготви за сите клиенти“), as a DRAFT. A report the office already published / sent is never touched. The 💲 AI
 * summary only when the owner switched it on (and the monthly AI limit allows it); publishing to the portal is the
 * owner's „Објави ги сите подготвени“ unless auto-publish is on (off by default).
 */
import { and, eq, inArray } from 'drizzle-orm';
import { klLang, lastFinishedMonth, periodLabel, todaySkopje, type KlConfig } from '@wise/core/office';
import { isAutoDay } from '@wise/core/office/automations';
import { audit, type Tx } from '../audit';
import { aiBudgetStatus } from '../ai-budget';
import { saveClientReport } from '../client-report';
import { clientReports, inboxItems } from '../schema/index';

type ClientReportRow = typeof clientReports.$inferSelect;
import { autoFirms, autoSettings, noteAutoRun } from './common';

export interface AutoReportsResult { period: string; prepared: number; kept: number; ai: string[]; published: number; errors: string[]; ran: boolean }

/** Show the report in the client's portal (with the portal message the first time). Audited `crPublish`. */
export async function publishClientReport(tx: Tx, r: Pick<ClientReportRow, 'id' | 'firmId' | 'period' | 'status' | 'publishedAt'>, by: { id: string | null; name: string }, data: Record<string, unknown> = {}): Promise<void> {
  await tx.update(clientReports).set({ status: r.status === 'sent' ? 'sent' : 'published', publishedAt: r.publishedAt ?? new Date() }).where(eq(clientReports.id, r.id));
  if (!r.publishedAt) {
    await tx.insert(inboxItems).values({
      firmId: r.firmId, fromOffice: true, done: true, fromUserId: by.id, fromName: by.name,
      subject: `📊 Месечен извештај – ${periodLabel(r.period)}`, note: 'Нов месечен извештај е достапен во порталот: „📊 Месечни извештаи“.',
    });
  }
  await audit(tx, { userId: by.id, firmId: r.firmId, action: 'crPublish', entityType: 'client_report', entityId: r.id, data });
}

/** Day 5 (configurable), 06:20. Returns the report ids to queue for the 💲 AI summary (the job enqueues them). */
export async function runAutoReports(db: Tx, o: { today?: string; force?: boolean } = {}): Promise<AutoReportsResult> {
  const today = o.today ?? todaySkopje();
  const S = await autoSettings(db);
  const period = lastFinishedMonth(today);
  const out: AutoReportsResult = { period, prepared: 0, kept: 0, ai: [], published: 0, errors: [], ran: false };
  if (!o.force && (!S.on.reports || !isAutoDay(today, S.reportDay))) return out;
  out.ran = true;
  // the clients: every active real firm but the office's own
  for (const f of await autoFirms(db, { office: false })) {
    try {
      await db.transaction(async (tx) => {
        const [old] = await tx.select({ status: clientReports.status }).from(clientReports).where(and(eq(clientReports.firmId, f.id), eq(clientReports.period, period))).limit(1);
        if (old && old.status !== 'draft') { out.kept++; return; }
        const r = await saveClientReport(tx, { firmId: f.id, period, userId: null, lang: klLang((f.settings as { kl?: KlConfig }).kl) });
        await audit(tx, { userId: null, firmId: f.id, action: 'crPrep', entityType: 'client_report', entityId: r.id, data: { period, auto: true, changed: r.changed } });
        out.prepared++;
        const [x] = await tx.select().from(clientReports).where(eq(clientReports.id, r.id)).limit(1);
        if (S.reportAi && x && !x.summary && x.aiStatus !== 'queued' && !(await aiBudgetStatus(tx, f.id)).paused) {
          await tx.update(clientReports).set({ aiStatus: 'queued', aiError: null }).where(eq(clientReports.id, r.id));
          out.ai.push(r.id);
        }
        if (S.reportPublish && x) { await publishClientReport(tx, x, { id: null, name: 'Канцеларија' }, { auto: true }); out.published++; }
      });
    } catch (e) { out.errors.push(`${f.name}: ${(e as Error).message}`); }
  }
  await noteAutoRun(db, 'reports', `${periodLabel(period)}: подготвени ${out.prepared}${out.kept ? `, веќе објавени ${out.kept}` : ''}${out.published ? `, објавени автоматски ${out.published}` : ''}`, { period, prepared: out.prepared });
  return out;
}

/** „Објави ги сите подготвени“ (owner): every DRAFT report of the period of the given firms. */
export async function publishPreparedReports(db: Tx, a: { period: string; firmIds: readonly string[]; user: { id: string; name: string } }): Promise<number> {
  if (!a.firmIds.length) return 0;
  const R = await db.select().from(clientReports).where(and(eq(clientReports.period, a.period), eq(clientReports.status, 'draft'), inArray(clientReports.firmId, [...a.firmIds])));
  for (const r of R) await db.transaction((tx) => publishClientReport(tx, r, a.user, { batch: true }));
  await audit(db, { userId: a.user.id, action: 'crPublishAll', entityType: 'client_report', data: { period: a.period, published: R.length } });
  return R.length;
}

/** Draft reports waiting (the owner's panel / status line). */
export async function draftReportCount(tx: Pick<Tx, 'select'>, period: string, firmIds?: readonly string[]): Promise<number> {
  if (firmIds && !firmIds.length) return 0;
  const R = await tx.select({ id: clientReports.id }).from(clientReports)
    .where(and(eq(clientReports.period, period), eq(clientReports.status, 'draft'), firmIds ? inArray(clientReports.firmId, [...firmIds]) : undefined));
  return R.length;
}
