/**
 * `bank.konta-all` — „🏦 Примени за сите фирми“ (Изводи → ⚙ Поставки, office owner only). The web stores the request
 * (`app_settings` `bankKontaAll`: firms, steps, year) and sends its `runId`; this job applies the steps firm by firm,
 * each firm in its own transaction with the totals check (`@wise/db` `runBankKontaAllJob`), and writes the progress /
 * the per-firm result into the same row after every firm. A newer request or a finished run → nothing (no retries).
 */
import { BANK_KONTA_ALL_JOB, runBankKontaAllJob, type Tx } from '@wise/db';
import { defineJob } from '../job';

export const bankKontaAll = defineJob<{ runId: string }>({
  name: BANK_KONTA_ALL_JOB,
  queue: { retryLimit: 0, expireInSeconds: 2 * 60 * 60 },
  async run(data, { db, log }) {
    if (!data?.runId) return;
    const ran = await runBankKontaAllJob(db as unknown as Tx, data.runId);
    log(ran ? `bank konta for all firms: run ${data.runId} finished` : `bank konta for all firms: run ${data.runId} not queued – skipped`);
  },
});
