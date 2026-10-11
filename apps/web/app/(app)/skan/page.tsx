/** Legacy `VIEWS.skan` (LEGACY-MAP Phase 3 §3.3) — AI document reading and review; `?cmp=1` = 🧪 Тест AI (legacy `aiCmp`). */
import { ScanCenter } from '@/components/sales/scan-center';
import { AiCompare } from '@/components/sales/ai-compare';
import { booksPage, canDo } from '@/lib/books';

type SP = { k?: string; b?: string; wh?: string; cash?: string; cost?: string; saved?: string; cmp?: string };

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  if (sp.cmp) {
    const { u, firm } = await booksPage('skan');
    if (firm && canDo(u, 'del', firm.id)) return <AiCompare firmId={firm.id} />;
  }
  return <ScanCenter mode="skan" sp={sp} />;
}
