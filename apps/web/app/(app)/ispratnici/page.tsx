/** Legacy `VIEWS.ispratnici` → `docList(m,'dispatch')` (LEGACY-MAP Phase 3 §3.3). */
import { InvoicesView, type SP } from '@/components/sales/invoices-view';

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  return <InvoicesView dt="dispatch" sp={await searchParams} />;
}
