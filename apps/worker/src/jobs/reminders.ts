import { dispatchReminders } from '@wise/db';
import { defineJob, type JobCtx } from '../job';

/**
 * Hand queued `mail_log` rows (written by the `@wise/db` office services inside their transaction) to `mail.send`.
 * Without a queue (tests) or if enqueueing fails, the rows stay `queued` and the `mail.flush` sweep sends them.
 */
export async function sendQueuedMail(ctx: Pick<JobCtx, 'send' | 'log'>, ids: readonly string[]): Promise<number> {
  if (!ctx.send || !ids.length) return 0;
  let n = 0;
  for (const logId of ids) {
    try { await ctx.send('mail.send', { logId }); n++; } catch (e) { ctx.log(`mail ${logId} left for mail.flush: ${(e as Error).message}`); }
  }
  return n;
}

/**
 * Hourly: raise reminders for firm deadlines entering their window and deliver due reminders
 * (portal message / in-app / e-mail — `mail` reminders are queued in `mail_log` and sent through `mail.send`).
 */
export const remindersJob = defineJob({
  name: 'reminders',
  cron: '5 * * * *',
  async run(_data, ctx) {
    const r = await dispatchReminders(ctx.db);
    const m = await sendQueuedMail(ctx, r.mailIds);
    ctx.log(`created ${r.created}, sent ${r.sent}, e-mails ${r.mailIds.length} (queued ${m})`);
  },
});
