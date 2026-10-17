/** Print view „Прилог кон ДДВ-04 – промет по членови“: the invoices behind fields 07–11, to attach for УЈП. */
import { notFound } from 'next/navigation';
import { computeVatPeriod, fixtureVatSource, normalizeVatPeriod, vatPeriodLabel, vatYearOverview } from '@wise/db';
import { db } from '@/lib/db';
import { vatSource } from '@/lib/vat-source';
import { DdvAnnex } from '../../(app)/ddv/ddv-annex';
import { printGuard } from '../guard';

export const metadata = { title: 'Прилог кон ДДВ-04' };

export default async function PrintDdv04Prilog({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { firm } = await printGuard('ddv');
  const p = normalizeVatPeriod((await searchParams).p);
  if (!p) notFound();
  const ov = await vatYearOverview(db(), firm, Number(p.slice(0, 4)), vatSource);
  const cur = ov.periods.find((x) => x.period === p);
  if (!cur) notFound();
  const C = await computeVatPeriod(db(), firm, p, fixtureVatSource(ov.data), cur.row?.corrections ?? {}, ov.ctx);
  return (
    <div className="pdfdoc">
      <h2 style={{ margin: '0 0 2px' }}>Прилог кон ДДВ-04 – промет по членови</h2>
      <p style={{ margin: '0 0 10px' }}>{firm.name}{firm.edb ? ` · ЕДБ ${firm.edb}` : ''} · даночен период {vatPeriodLabel(p)}</p>
      <DdvAnnex sections={C.annex} />
    </div>
  );
}
