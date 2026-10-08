/** Legacy `VIEWS.zs_bu` (zsView 7711 → zmBox wrapper 10971) — Биланс на успех (ЦРМ образец 37, AOP 201–293). */
import { StatementPage } from '@/components/yearend/statement';

export default async function ZsBuPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  return <StatementPage rep="bu" edit={(await searchParams).edit === '1'} />;
}
