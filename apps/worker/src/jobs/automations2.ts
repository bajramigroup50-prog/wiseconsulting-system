/**
 * UX Phase 3 (docs/ux-rindertim.md P35–P38, P43) — scheduled automations. The program PREPARES, a person CONFIRMS:
 * every job writes drafts / findings / prepared lists only (nothing posted, filed, sent to a client or to УЈП), skips
 * locked periods and 🎭 demo firms, does nothing while its „автоматски“ switch is off (office settings „⚙ Автоматизации“)
 * and records its last run for the status line. `{ force: true }` = „▶ Пушти сега“ from the owner's panel.
 *
 * - `auto.close`   02:10 daily — P35 month ready to lock (`runAutoClose`)
 * - `auto.lawrep`  03:10 daily — P43 tax review → autopilot findings (`runAutoLawrep`)
 * - `auto.aml`     04:00 Sunday — P43 УФР monitoring + retention list (`runAutoAml`)
 * - `auto.payroll` 05:20 daily, works on the configured day — P36 payroll drafts (`runAutoPayroll`)
 * - `auto.vat`     05:40 daily — P37 ДДВ-04 drafts (`runAutoVat`)
 * - `auto.reports` 06:20 daily, works on the configured day — P38 client reports (`runAutoReports`)
 * - `auto.dunning` 06:30 Monday — P43 dunning suggestions (`runAutoDunning`)
 * The service reminders run in the hourly `reminders` job, the law texts in the daily law robot.
 */
import { CLIENT_REPORT_AI_JOB } from '@wise/core/office';
import { AUTO_JOB } from '@wise/core/office/automations';
import { runAutoAml, runAutoClose, runAutoDunning, runAutoLawrep, runAutoPayroll, runAutoReports, runAutoVat } from '@wise/db';
import { defineJob } from '../job';

type D = { today?: string; force?: boolean };
const errs = (L: readonly string[]) => (L.length ? ` · грешки: ${L.slice(0, 5).join('; ')}` : '');

export const autoClose = defineJob<D>({
  name: AUTO_JOB.close,
  cron: '10 2 * * *',
  async run(data, ctx) {
    const r = await runAutoClose(ctx.db, data ?? {});
    ctx.log(r.skipped ? 'off' : `${r.month}: ready ${r.ready}/${r.firms}, locked ${r.locked}`);
  },
});

export const autoLawrep = defineJob<D>({
  name: AUTO_JOB.lawrep,
  cron: '10 3 * * *',
  queue: { expireInSeconds: 3600 },
  async run(data, ctx) {
    const r = await runAutoLawrep(ctx.db, data ?? {});
    ctx.log(r.skipped ? 'off' : `firms ${r.firms}, findings ${r.findings}${errs(r.errors)}`);
  },
});

export const autoAml = defineJob<D>({
  name: AUTO_JOB.aml,
  cron: '0 4 * * 0',
  queue: { expireInSeconds: 3600 },
  async run(data, ctx) {
    const r = await runAutoAml(ctx.db, data ?? {});
    ctx.log(r.skipped ? 'off' : `clients ${r.clients}, alerts ${r.alerts}, purge list ${r.purge}${errs(r.errors)}`);
  },
});

export const autoPayroll = defineJob<D & { month?: string }>({
  name: AUTO_JOB.payroll,
  cron: '20 5 * * *',
  async run(data, ctx) {
    const r = await runAutoPayroll(ctx.db, data ?? {});
    ctx.log(r.ran ? `${r.month}: drafts ${r.drafts}, skipped ${JSON.stringify(r.skipped)}${errs(r.errors)}` : 'not today / off');
  },
});

export const autoVat = defineJob<D>({
  name: AUTO_JOB.vat,
  cron: '40 5 * * *',
  queue: { expireInSeconds: 3600 },
  async run(data, ctx) {
    const r = await runAutoVat(ctx.db, data ?? {});
    ctx.log(r.skipped ? 'off' : `drafts ${r.drafts} (problems ${r.problems}), closed ${r.closed}, locked ${r.locked}${errs(r.errors)}`);
  },
});

export const autoReports = defineJob<D>({
  name: AUTO_JOB.reports,
  cron: '20 6 * * *',
  async run(data, ctx) {
    const r = await runAutoReports(ctx.db, data ?? {});
    // 💲 only when the owner switched the AI summary on (the service already checked the monthly limit)
    if (ctx.send) for (const id of r.ai) await ctx.send(CLIENT_REPORT_AI_JOB, { id });
    ctx.log(r.ran ? `${r.period}: prepared ${r.prepared}, kept ${r.kept}, AI ${r.ai.length}, published ${r.published}${errs(r.errors)}` : 'not today / off');
  },
});

export const autoDunning = defineJob<D>({
  name: AUTO_JOB.dunning,
  cron: '30 6 * * 1',
  async run(data, ctx) {
    const r = await runAutoDunning(ctx.db, data ?? {});
    ctx.log(r.skipped ? 'off' : `firms ${r.firms}, customers ${r.customers}`);
  },
});

export const AUTOMATION_JOBS = [autoClose, autoLawrep, autoAml, autoPayroll, autoVat, autoReports, autoDunning];
