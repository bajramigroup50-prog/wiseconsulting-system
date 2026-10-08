import { TrgPage, type TrgSP } from '../_stock/trade-pages';

export default async function Page({ searchParams }: { searchParams: Promise<TrgSP> }) {
  return <TrgPage retail={false} sp={await searchParams} />;
}
