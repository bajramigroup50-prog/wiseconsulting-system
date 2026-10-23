import { sql } from 'drizzle-orm';
import { auditLog, queueNonVatRepairs, repairCashPurchaseNalogs, REPOST_JOB, runAutopilot } from '@wise/db';
import { defineJob } from '../job';
import { sendQueuedMail } from './reminders';

/**
 * Autopilot every 6 hours (legacy `apRun`, which ran when someone opened the app in the morning):
 * the notification + autopilot checks for every firm → `autopilot_findings`, metrics and peer risk,
 * proposed client messages (auto-sent to the portal and by e-mail for the types enabled in the office profile)
 * and, if enabled, office tasks for new `bad` findings. Module data (invoices with paid amounts, payroll, VAT
 * closes and the VAT due estimate, Z reports) comes from `defaultSources` in `@wise/db` office.
 */
export const autopilot = defineJob<{ today?: string; firmIds?: string[] }>({
  name: 'autopilot',
  cron: '0 */6 * * *',
  async run(data, ctx) {
    // a firm that is not a VAT payer with VAT / 1200009 still in its posted documents: re-posted (never left mixed)
    try {
      const year = Number((data?.today ?? new Date().toISOString()).slice(0, 4));
      const runs = await ctx.db.transaction((tx) => queueNonVatRepairs(tx, year, data?.firmIds));
      for (const q of runs) await ctx.send?.(REPOST_JOB, q);
      if (runs.length) ctx.log(`non-VAT firms re-posted: ${runs.length}`);
    } catch (e) { ctx.log(`non-VAT repair: ${(e as Error).message}`); }
    try { const m = await ctx.db.transaction((tx) => repairCashPurchaseNalogs(tx, data?.firmIds)); if (m) ctx.log(`cash receipts moved to the cash nalog: ${m}`); } catch (e) { ctx.log(`cash nalog repair: ${(e as Error).message}`); }
    const r = await runAutopilot(ctx.db, { trigger: data?.firmIds ? 'manual' : 'cron', today: data?.today, firmIds: data?.firmIds });
    await sendQueuedMail(ctx, r.mailIds);
    ctx.log(`firms ${r.firms}, findings ${r.findings} (new bad ${r.newBad}), messages ${r.messages}, auto-sent ${r.autoSent}, e-mails ${r.mailIds.length}`);
  },
});

/** When each firm was last re-checked by {@link autopilotRecent} (in memory: after a restart every recent firm once). */
const lastCheck = new Map<string, number>();

/**
 * Every 5 minutes: the firms where something was saved, booked or deleted since their last check (the audit log) are
 * re-checked – a finding the user just fixed (an invoice booked, a statement imported, a payment linked…) leaves the
 * list within minutes, without waiting for the 6-hourly run or a click on „↻ Провери пак“.
 */
export const autopilotRecent = defineJob<Record<string, never>>({
  name: 'autopilot.recent',
  cron: '*/5 * * * *',
  async run(_data, ctx) {
    const R = await ctx.db.execute(sql`select ${auditLog.firmId} as id, max(${auditLog.at}) as at from ${auditLog}
      where ${auditLog.at} > now() - interval '30 minutes' and ${auditLog.firmId} is not null and ${auditLog.userId} is not null and ${auditLog.action} not in ('login', 'logout', 'autoRepost', 'autoRepostRequest')
      group by ${auditLog.firmId}`);
    const rows = ((R as unknown as { rows?: { id: string; at: string | Date }[] }).rows ?? (R as unknown as { id: string; at: string | Date }[]));
    const ids = rows.filter((r) => new Date(r.at).getTime() > (lastCheck.get(r.id) ?? 0)).map((r) => r.id);
    if (!ids.length) return;
    // receipts paid in cash outside the cash register's nalog of their period: moved there
    try { const m = await ctx.db.transaction((tx) => repairCashPurchaseNalogs(tx, ids)); if (m) ctx.log(`cash receipts moved to the cash nalog: ${m}`); } catch (e) { ctx.log(`cash nalog repair: ${(e as Error).message}`); }
    const r = await runAutopilot(ctx.db, { trigger: 'manual', firmIds: ids });
    // after the run: what the run itself writes is not a new change
    const now = Date.now();
    for (const id of ids) lastCheck.set(id, now);
    ctx.log(`re-checked ${ids.length} firm(s) with recent changes, findings ${r.findings}`);
  },
});
