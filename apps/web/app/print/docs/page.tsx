/**
 * „🖨 Печати ги избраните“ (Излезни фактури): the ticked documents one after another, each on its own page – the same
 * template as one document (`invoicePrintHtml`), so the browser prints or saves them as one PDF.
 */
import { notFound } from 'next/navigation';
import { firmAllowed } from '@wise/core';
import { invoicePrintHtml } from '@wise/core/sales';
import { loadInvoicePrintData } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata = { title: 'Фактури' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PrintDocs({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const u = await requireUser();
  const ids = [...new Set(String((await searchParams).ids ?? '').split(',').filter((x) => UUID.test(x)))].slice(0, 300);
  if (!ids.length) notFound();
  const D = [];
  for (const id of ids) {
    const d = await loadInvoicePrintData(db(), id);
    if (d && firmAllowed(u.principal, d.invoice.firmId)) D.push(d);
  }
  if (!D.length) notFound();
  return (
    <>
      <div className="noprint" style={{ textAlign: 'center', margin: '4px 0 10px' }}><b>{D.length}</b> документи – секој на своја страница (Ctrl+P → печати или „Save as PDF“).</div>
      {D.map((d, i) => (
        <div key={d.invoice.id} style={i < D.length - 1 ? { breakAfter: 'page', pageBreakAfter: 'always' } : undefined}
          dangerouslySetInnerHTML={{ __html: invoicePrintHtml(d.input) }} />
      ))}
    </>
  );
}
