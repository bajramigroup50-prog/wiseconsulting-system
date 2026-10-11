/**
 * Print of an outgoing document — legacy `docHTML` 4250 / `invAlt` 4227: invoice / advance invoice / credit note /
 * proforma (`?k=` omitted), dispatch note (`?k=dispatch`), waybill (`?k=waybill`).
 *
 * The markup is `invoicePrintHtml` (`@wise/core/sales`) — the same template the worker's `invoice.mail` job renders
 * to the PDF it e-mails, so the e-mailed PDF and this view never differ. `?mail=1` opens the e-mail form.
 */
import { notFound } from 'next/navigation';
import { PodLink } from '@/components/pod-link';
import { can, firmAllowed } from '@wise/core';
import { DT, invoiceMailText, invoicePdfName, invoicePrintHtml } from '@wise/core/sales';
import { WaPanel } from './wa-panel';
import { loadInvoicePrintData } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { InvoiceMailForm } from './mail-form';

const MAILABLE = ['invoice', 'credit', 'proforma'];

/** The print / PDF file name (legacy `docPdf`: Faktura_<number>.pdf). */
export async function generateMetadata({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ k?: string }> }) {
  const d = await loadInvoicePrintData(db(), (await params).id, (await searchParams).k);
  return { title: d ? invoicePdfName(d.input.kind, d.invoice.number) : 'Документ' };
}

export default async function PrintDoc({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ k?: string; mail?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const u = await requireUser();
  const d = await loadInvoicePrintData(db(), id, sp.k);
  if (!d || !firmAllowed(u.principal, d.invoice.firmId)) notFound();
  const { input, invoice: doc, firm, partner } = d;
  // proformas are never booked (status draft) but are e-mailed like legacy
  const mailable = MAILABLE.includes(input.kind) && (doc.status === 'posted' || (doc.kind === 'proforma' && doc.status !== 'pending')) && can(u.principal, 'write', doc.firmId);
  let mail: React.ReactNode = null;
  if (mailable) {
    const t = invoiceMailText({ kind: doc.kind, number: doc.number, date: doc.date, due: doc.due, total: Number(doc.total), currency: doc.currency, firm });
    const S = (firm.settings ?? {}) as Record<string, string | undefined>;
    const fm = (v: number) => v.toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dmy = (x: string | null) => (x ? x.split('-').reverse().join('.') : '');
    const NL = String.fromCharCode(10);
    // legacy `sendWa` (7059): the WhatsApp / Viber message
    const wa = `${DT[doc.kind as 'invoice']?.n ?? 'Документ'} бр. ${doc.number} од ${dmy(doc.date)}${NL}${firm.name}${NL}Износ: ${fm(Number(doc.total))} ден.${doc.due ? NL + 'Рок на плаќање: ' + dmy(doc.due) : ''}${S.bank ? NL + 'Жиро сметка: ' + S.bank + NL + 'Повикување на број: ' + doc.number : ''}`;
    mail = <>
      <h2 className="noprint" style={{ textAlign: 'center', margin: '4px 0 8px' }}>{DT[doc.kind as 'invoice']?.n ?? ''} {doc.number}</h2>
      <InvoiceMailForm invoiceId={doc.id} to={partner?.email ?? ''} subject={t.subject} body={t.body} open={sp.mail === '1'} />
      <WaPanel phone={String(partner?.phone ?? '').replace(/\D/g, '').replace(/^0/, '389')} text={wa} pdfName={invoicePdfName(input.kind, doc.number)} />
    </>;
  }
  return (
    <>
      {mail}
      {doc.kind === 'invoice' && <PodLink firmId={doc.firmId} invoiceId={doc.id} />}
      <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: invoicePrintHtml(input) }} />
    </>
  );
}
