import { LagerPage, type LagerSP } from '../_stock/lager-page';

export default async function Page({ searchParams }: { searchParams: Promise<LagerSP> }) {
  return <LagerPage view="m_lager" sp={await searchParams} />;
}
