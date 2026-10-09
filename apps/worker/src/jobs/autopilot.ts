import { runAutopilot } from '@wise/db';
import { defineJob } from '../job';
import { sendQueuedMail } from './reminders';

/**
 * Autopilot every 6 hours (legacy `apRun`, which ran when someone opened the app in the morning):
 * the notification + autopilot checks for every firm → `autopilot_findings`, metrics and peer risk,
 * proposed client messages (auto-sent to the portal and by e-mail for the types enabled in the office profile)
 * and, if enabled, office tasks for new `bad` findings. Module data (invoices with paid amounts, payroll, VAT
 * closes and the VAT due estimate, Z reports) comes from `defaultSources` in `@wise/db` office.
 */
export const autopilot = defineJob<{ today?: string }>({
  name: 'autopilot',
  cron: '0 */6 * * *',
  async run(data, ctx) {
    const r = await runAutopilot(ctx.db, { trigger: 'cron', today: data?.today });
    await sendQueuedMail(ctx, r.mailIds);
    ctx.log(`firms ${r.firms}, findings ${r.findings} (new bad ${r.newBad}), messages ${r.messages}, auto-sent ${r.autoSent}, e-mails ${r.mailIds.length}`);
  },
});
