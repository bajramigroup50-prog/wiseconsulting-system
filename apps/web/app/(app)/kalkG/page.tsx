import { KalkPage, type KalkSP } from '../_retail/kalk-page';

/** Legacy `VIEWS.kalkG` → `VIEWS.kalk` (warehouses). */
export default async function Page({ searchParams }: { searchParams: Promise<KalkSP> }) {
  return <KalkPage md="warehouse" sp={await searchParams} />;
}
