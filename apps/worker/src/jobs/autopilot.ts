import { runAutopilot } from '@wise/db';
import { defineJob } from '../job';

/**
 * Autopilot every 6 hours (legacy `apRun`, which ran when someone opened the app in the morning):
 * the notification + autopilot checks for every firm → `autopilot_findings`, metrics and peer risk,
 * proposed client messages (auto-sent to the portal for the types enabled in the office profile) and,
 * if enabled, office tasks for new `bad` findings.
 * TODO(merge): pass the real `OfficeDataSources` (Phases 3/5/6/7) once merged — see `defaultSources`.
 */
export const autopilot = defineJob<{ today?: string }>({
  name: 'autopilot',
  cron: '0 */6 * * *',
  async run(data, { db, log }) {
    const r = await runAutopilot(db, { trigger: 'cron', today: data?.today });
    log(`firms ${r.firms}, findings ${r.findings} (new bad ${r.newBad}), messages ${r.messages}, auto-sent ${r.autoSent}`);
  },
});
