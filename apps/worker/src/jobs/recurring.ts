import { INVOICE_MAIL_JOB, issueDueRecurring } from '@wise/db';
import { defineJob } from '../job';

/**
 * Recurring invoices (legacy `recAutoCheck`, which issued when the firm was opened): every morning, issue each due
 * definition through the Phase 3 invoice service — a *draft* invoice the office approves, or, for definitions sent
 * by e-mail, an issued and booked invoice that is then mailed to the buyer by the `invoice.mail` job (legacy `recMail`:
 * PDF of the invoice to the partner's e-mail).
 */
export const recurring = defineJob<{ today?: string }>({
  name: 'recurring',
  cron: '0 6 * * *',
  async run(data, { db, log, send }) {
    const r = await issueDueRecurring(db, { today: data?.today });
    let queued = 0;
    if (send) for (const m of r.mail) { await send(INVOICE_MAIL_JOB, m); queued++; }
    for (const e of r.errors) log(`definition ${e.id} (firm ${e.firmId}) not issued: ${e.error}`);
    log(`definitions ${r.definitions}, issued ${r.issued}, to e-mail ${r.mail.length} (queued ${queued}), errors ${r.errors.length}`);
  },
});
