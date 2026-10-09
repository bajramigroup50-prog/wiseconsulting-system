'use client';
/** „✉ Испрати по е-пошта“ on the document print view (hidden on paper and left out of the server PDF). */
import { ActionForm } from '@/components/action-form';
import { sendInvoiceMail } from './actions';

export function InvoiceMailForm({ invoiceId, to, subject, body, open }: { invoiceId: string; to: string; subject: string; body: string; open?: boolean }) {
  return (
    <details className="noprint card" open={open} style={{ width: '190mm', maxWidth: '100%', margin: '0 auto 12px' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>✉ Испрати по е-пошта (со PDF во прилог)</summary>
      <ActionForm action={sendInvoiceMail.bind(null, invoiceId)} className="" reset={false}>
        <label className="f">До (е-пошта, повеќе одделени со запирка)<input name="to" defaultValue={to} placeholder="kupuvac@firma.mk" required /></label>
        <label className="f">Наслов<input name="subject" defaultValue={subject} /></label>
        <label className="f">Порака<textarea name="body" rows={7} defaultValue={body} /></label>
        <div className="row" style={{ gap: 8 }}><button className="btn pri">✉ Испрати веднаш</button></div>
      </ActionForm>
    </details>
  );
}
