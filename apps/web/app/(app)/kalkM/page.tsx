import { KalkPage, type KalkSP } from '../_retail/kalk-page';

/** Legacy `VIEWS.kalkM` → `VIEWS.kalk` (stores). */
export default async function Page({ searchParams }: { searchParams: Promise<KalkSP> }) {
  return <KalkPage md="store" sp={await searchParams} />;
}
