/** Legacy `VIEWS.masovnoM` (LEGACY-MAP Phase 3 §3.3) — AI document reading and review. */
import { ScanCenter } from '@/components/sales/scan-center';

type SP = { k?: string; b?: string; wh?: string; cash?: string; cost?: string; saved?: string };

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  return <ScanCenter mode="masovnoM" sp={await searchParams} />;
}
