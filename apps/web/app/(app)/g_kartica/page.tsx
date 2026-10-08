import { KartPage, type KartSP } from '../_stock/kart-page';

export default async function Page({ searchParams }: { searchParams: Promise<KartSP> }) {
  return <KartPage retail={false} sp={await searchParams} />;
}
