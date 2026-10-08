import { issueDueRecurring } from '@wise/db';
import { defineJob } from '../job';

/**
 * Recurring invoices (legacy `recAutoCheck`, which issued when the firm was opened): every morning, issue
 * each due definition as a *draft* invoice.
 * TODO(merge): pass Phase 3's invoice service as the `sink` (default keeps drafts in `firm_docs`).
 * TODO(mail): definitions with `mail` → enqueue Phase 6 `mail.send` with the invoice PDF for `r.mail`.
 */
export const recurring = defineJob<{ today?: string }>({
  name: 'recurring',
  cron: '0 6 * * *',
  async run(data, { db, log }) {
    const r = await issueDueRecurring(db, { today: data?.today });
    log(`definitions ${r.definitions}, issued ${r.issued}, to e-mail ${r.mail.length}`);
  },
});
