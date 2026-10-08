import { EtPage, type TrgSP } from '../_stock/trade-pages';

export default async function Page({ searchParams }: { searchParams: Promise<TrgSP> }) {
  return <EtPage sp={await searchParams} />;
}
