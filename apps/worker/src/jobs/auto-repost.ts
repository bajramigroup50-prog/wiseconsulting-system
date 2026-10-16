/**
 * `books.repost` — UX Phase 3 (P31): re-posting of one firm after a change of the posting schemes / bank kontos / chart,
 * in the background, OPEN periods only, with the „разлики“ report (`@wise/db` `runFirmRepost`). Queued by the web when
 * the owner switched „автоматски“ on for the firm, or when a person pressed „Прекнижи“ on the suggestion. A newer
 * request or a finished run → nothing (no retries: the state row says what happened).
 */
import { REPOST_JOB, runFirmRepost, type Tx } from '@wise/db';
import { defineJob } from '../job';

export const autoRepost = defineJob<{ firmId: string; runId: string }>({
  name: REPOST_JOB,
  queue: { retryLimit: 0, expireInSeconds: 60 * 60 },
  async run(data, { db, log }) {
    if (!data?.firmId || !data.runId) return;
    const ran = await runFirmRepost(db as unknown as Tx, data.firmId, data.runId);
    log(ran ? `repost ${data.firmId}: run ${data.runId} finished` : `repost ${data.firmId}: run ${data.runId} not queued – skipped`);
  },
});
