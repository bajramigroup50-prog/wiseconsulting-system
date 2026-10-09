/**
 * Print of an outgoing document — legacy `docHTML` 4250 / `invAlt` 4227: invoice / advance invoice / credit note /
 * proforma (`?k=` omitted), dispatch note (`?k=dispatch`), waybill (`?k=waybill`).
 *
 * The markup is `invoicePrintHtml` (`@wise/core/sales`) — the same template the worker's `invoice.mail` job renders
 * to the PDF it e-mails, so the e-mailed PDF and this view never differ. `?mail=1` opens the e-mail form.
 */
import { notFound } from 'next/navigation';
import { can, firmAllowed } from '@wise/core';
import { invoiceMailText, invoicePrintHtml } from '@wise/core/sales';
import { loadInvoicePrintData } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { InvoiceMailForm } from './mail-form';

const MAILABLE = ['invoice', 'credit', 'proforma'];

export default async function PrintDoc({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ k?: string; mail?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const u = await requireUser();
  const d = await loadInvoicePrintData(db(), id, sp.k);
  if (!d || !firmAllowed(u.principal, d.invoice.firmId)) notFound();
  const { input, invoice: doc, firm, partner } = d;
  const mailable = MAILABLE.includes(input.kind) && doc.status === 'posted' && can(u.principal, 'write', doc.firmId);
  let mail: React.ReactNode = null;
  if (mailable) {
    const t = invoiceMailText({ kind: doc.kind, number: doc.number, date: doc.date, due: doc.due, total: Number(doc.total), currency: doc.currency, firm });
    mail = <InvoiceMailForm invoiceId={doc.id} to={partner?.email ?? ''} subject={t.subject} body={t.body} open={sp.mail === '1'} />;
  }
  return (
    <>
      {mail}
      <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: invoicePrintHtml(input) }} />
    </>
  );
}
