/**
 * `invoice.mail` `{ invoiceId, to?, userId?, subject?, body? }` — legacy `sendMailGo` 7041 / `recMail`: render the
 * outgoing document with the print template (`invoicePrintHtml`, the same markup as `/print/doc/[id]`), store the
 * PDF (`pdf.render` path) and e-mail it to the buyer through the office mailer (`mail_log`, `sendLoggedMail`).
 *
 * Started by the web „Испрати по е-пошта“ form and by the recurring-invoice job. Delivery problems end as a `failed`
 * `mail_log` row (no SMTP, no address, …) like every other message; the job itself does not throw for them.
 */
import { invoiceMailText, invoicePdfName, invoicePrintHtml, partnerCardHtml } from '@wise/core/sales';
import { PDFDOC_CSS } from '@wise/core/print-css';
import { files, firmMailboxInfo, loadInvoicePrintData, partnerCardRows, textMailHtml, type DB, type InvoiceMailRequest, type PdfFileLink } from '@wise/db';
import { inArray } from 'drizzle-orm';
import { defineJob } from '../job';
import type { PdfInput } from '../pdf/document';
import { sharedMailer, type Mailer } from '../mail/mailer';
import { readS3File, s3Configured } from '../mail/files';
import { sendLoggedMail, type MailDeps } from '../mail/send';
import type { ObjectStore } from '../storage';
import { renderPdfToFile } from './pdf';

export const INVOICE_MAIL = 'invoice.mail';

/** `card: false` leaves out the buyer's financial card (attached by default to an invoice with a buyer). */
export interface InvoiceMailData extends InvoiceMailRequest { subject?: string; body?: string; card?: boolean }

export interface InvoiceMailDeps {
  mail: MailDeps;
  render?: (p: PdfInput) => Promise<Uint8Array>;
  store?: ObjectStore;
}

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Render an outgoing document as PDF with the print template and store it (`files`), optionally owned by another firm
 * and linked to an entity (fee invoices: the client firm's portal message). Null when the document is gone.
 */
export async function renderInvoicePdf(db: DB, invoiceId: string, deps: InvoiceMailDeps, o: { userId?: string | null; firmId?: string; link?: PdfFileLink } = {}) {
  const P = invoiceId ? await loadInvoicePrintData(db, invoiceId) : null;
  if (!P) return null;
  const { invoice: inv, firm } = P;
  // logo / signature / stamp are `files.id` values: Chromium in the worker has no network, so inline them
  const S = (firm.settings ?? {}) as Record<string, unknown>;
  const ids = ['logo', 'sign', 'stamp'].map((k) => String(S[k] ?? '')).filter((v) => UUID.test(v));
  const data = new Map<string, string>();
  if (ids.length && deps.mail.readFile) {
    const F = await db.select().from(files).where(inArray(files.id, ids));
    for (const f of F) {
      if (f.firmId !== firm.id || f.status !== 'ready' || !f.mime.startsWith('image/')) continue;
      try { data.set(f.id, `data:${f.mime};base64,${(await deps.mail.readFile(f.bucketKey)).toString('base64')}`); } catch { /* image left out */ }
    }
  }
  const html = invoicePrintHtml({ ...P.input, img: (v) => (UUID.test(v) ? data.get(v) ?? '' : v) });
  const fileId = await renderPdfToFile(db, { html, css: PDFDOC_CSS, title: invoicePdfName(inv.kind, inv.number), firmId: o.firmId ?? firm.id, userId: o.userId ?? null, ...(o.link ? { link: o.link } : {}) }, { render: deps.render, store: deps.store });
  return { fileId, P };
}

/** The work of the job, separated for tests. Returns the `mail_log` row (or null when the document is gone). */
export async function runInvoiceMail(db: DB, d: InvoiceMailData, deps: InvoiceMailDeps) {
  const r = d?.invoiceId ? await renderInvoicePdf(db, d.invoiceId, deps, { userId: d.userId ?? null }) : null;
  if (!r) return null;
  const { invoice: inv, firm, partner } = r.P;
  const t = invoiceMailText({ kind: inv.kind, advance: inv.advance, number: inv.number, date: inv.date, due: inv.due, total: Number(inv.total), currency: inv.currency, firm });
  const buyer = (d.to || partner?.email || '').trim();
  const att = [r.fileId];
  // the buyer's financial card (customer accounts 12x, this year up to today) as a second PDF – firm setting `cardOnMail: false` turns it off
  const S = (firm.settings ?? {}) as { cardOnMail?: unknown };
  if (inv.kind === 'invoice' && partner && d.card !== false && S.cardOnMail !== false) {
    try {
      const to = new Date().toISOString().slice(0, 10) > inv.date ? new Date().toISOString().slice(0, 10) : inv.date;
      const C = await partnerCardRows(db, firm.id, partner.id, to);
      if (C.rows.length) {
        const html = partnerCardHtml({ firm: { name: firm.name, address: firm.address, city: firm.city, edb: firm.edb }, partner: { name: partner.name, edb: partner.edb, address: partner.address }, ...C });
        att.push(await renderPdfToFile(db, { html, css: PDFDOC_CSS, title: `Картица ${partner.name}`.slice(0, 80), firmId: firm.id, userId: d.userId ?? null }, { render: deps.render, store: deps.store }));
      }
    } catch { /* the invoice goes without the card */ }
  }
  if (d.copyFirm) {
    // automatically issued invoice: first a copy to the issuing firm itself (its own mailbox, else its e-mail), then the buyer
    const own = ((await firmMailboxInfo(db, firm.id))?.user || firm.email || '').trim();
    if (own && own.toLowerCase() !== buyer.toLowerCase()) {
      await sendLoggedMail(db, {
        firmId: firm.id, to: own, subject: `Копија: ${t.subject}${partner?.name ? ' – ' + partner.name : ''}`,
        html: textMailHtml(`Издадена е фактура ${inv.number ?? ''} за ${partner?.name ?? 'купувачот'}${buyer ? ` и се праќа на ${buyer}` : ' (купувачот нема е-пошта – не е пратена)'}.\n\n${d.body || t.body}`),
        attachments: att, entityType: 'invoice', entityId: inv.id, userId: d.userId ?? null,
      }, deps.mail);
    }
  }
  return sendLoggedMail(db, {
    firmId: firm.id, to: buyer, subject: d.subject || t.subject, html: textMailHtml(d.body || t.body),
    attachments: att, entityType: 'invoice', entityId: inv.id, userId: d.userId ?? null,
  }, deps.mail);
}


export const invoiceMail = defineJob<InvoiceMailData>({
  name: INVOICE_MAIL,
  async run(data, { db, log }) {
    const mailer = sharedMailer();
    const r = await runInvoiceMail(db, data, { mail: { mailer, ...(s3Configured() ? { readFile: readS3File } : {}) } });
    log(r ? `${data.invoiceId} → ${r.to.join(', ')}: ${r.status}${r.error ? ' (' + r.error + ')' : ''}` : `${data?.invoiceId}: document not found`);
  },
});
