import { dispatchReminders } from '@wise/db';
import { defineJob } from '../job';

/**
 * Hourly: raise reminders for firm deadlines entering their window and deliver due reminders
 * (portal message / in-app). TODO(mail): `mail` channel → Phase 6 `mail.send` (inside `dispatchReminders`).
 */
export const remindersJob = defineJob({
  name: 'reminders',
  cron: '5 * * * *',
  async run(_data, { db, log }) {
    const r = await dispatchReminders(db);
    log(`created ${r.created}, sent ${r.sent}`);
  },
});
