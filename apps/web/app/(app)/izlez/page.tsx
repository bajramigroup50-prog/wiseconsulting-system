/** Legacy `VIEWS.izlez` → `docList(m,'invoice')` (LEGACY-MAP Phase 3 §3.3). */
import { InvoicesView, type SP } from '@/components/sales/invoices-view';

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  return <InvoicesView dt="invoice" sp={await searchParams} />;
}
