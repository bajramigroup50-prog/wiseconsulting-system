/** Legacy `VIEWS.zs_bs` (zsView 7711 → zmBox wrapper 10972) — Биланс на состојба (ЦРМ образец 36, AOP 001–112). */
import { StatementPage } from '@/components/yearend/statement';

export default async function ZsBsPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  return <StatementPage rep="bs" edit={(await searchParams).edit === '1'} />;
}
