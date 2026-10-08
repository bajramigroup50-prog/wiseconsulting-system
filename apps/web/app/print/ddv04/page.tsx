/** Print view of the official ДДВ-04 form (legacy `ACT.ddvPdf` 7317 → `pdf('DDV-04_…', ddvFormHTML(sel))`). */
import { notFound } from 'next/navigation';
import { normalizeVatPeriod, vatYearOverview } from '@wise/db';
import { db } from '@/lib/db';
import { vatSource } from '@/lib/vat-source';
import { Ddv04Form } from '../../(app)/ddv/ddv04-form';
import { printGuard } from '../guard';

export const metadata = { title: 'ДДВ-04' };

export default async function PrintDdv04({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { firm } = await printGuard('ddv');
  const p = normalizeVatPeriod((await searchParams).p);
  if (!p) notFound();
  const ov = await vatYearOverview(db(), firm, Number(p.slice(0, 4)), vatSource);
  const cur = ov.periods.find((x) => x.period === p);
  if (!cur) notFound();
  return (
    <div className="pdfdoc">
      <Ddv04Form firm={firm} period={p} fields={cur.fields} amendmentNo={cur.row?.corrections.amendmentNo} today={new Date().toISOString().slice(0, 10)} />
    </div>
  );
}
