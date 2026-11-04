/** Print view of the official ДДВ-04 form (legacy `ACT.ddvPdf` 7317 → `pdf('DDV-04_…', ddvFormHTML(sel))`). */
import { notFound } from 'next/navigation';
import { perRange } from '@wise/core';
import { normalizeVatPeriod, vatYearOverview } from '@wise/db';
import { db } from '@/lib/db';
import { vatSource } from '@/lib/vat-source';
import { Ddv04Form } from '../../(app)/ddv/ddv04-form';
import { printGuard } from '../guard';

import { todayIso } from '@/lib/fmt';
export const metadata = { title: 'ДДВ-04' };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function PrintDdv04({ searchParams }: { searchParams: Promise<{ p?: string; from?: string; to?: string }> }) {
  const { firm } = await printGuard('ddv');
  const sp = await searchParams;
  const p = normalizeVatPeriod(sp.p);
  if (!p && ISO.test(sp.from ?? '') && ISO.test(sp.to ?? '') && sp.from! <= sp.to!) {
    /* a document package's period: every ДДВ-04 whose tax period lies inside from–to, one form per page */
    const out: { period: string; fields: Record<string, number>; amendmentNo?: string }[] = [];
    for (let y = Number(sp.from!.slice(0, 4)); y <= Number(sp.to!.slice(0, 4)); y++) {
      const ov = await vatYearOverview(db(), firm, y, vatSource);
      for (const x of ov.periods) {
        const [a, b] = perRange(x.period);
        if (a >= sp.from! && b <= sp.to!) out.push({ period: x.period, fields: x.fields, amendmentNo: x.row?.corrections.amendmentNo });
      }
    }
    return (
      <>{out.length ? out.map((x, i) => (
        <div key={x.period} className="pdfdoc" style={i ? { pageBreakBefore: 'always' } : undefined}>
          <Ddv04Form firm={firm} period={x.period} fields={x.fields} amendmentNo={x.amendmentNo} today={todayIso()} />
        </div>
      )) : <div className="pdfdoc"><p>Нема цел даночен период за ДДВ во {sp.from} – {sp.to}.</p></div>}</>
    );
  }
  if (!p) notFound();
  const ov = await vatYearOverview(db(), firm, Number(p.slice(0, 4)), vatSource);
  const cur = ov.periods.find((x) => x.period === p);
  if (!cur) notFound();
  return (
    <div className="pdfdoc">
      <Ddv04Form firm={firm} period={p} fields={cur.fields} amendmentNo={cur.row?.corrections.amendmentNo} today={todayIso()} />
    </div>
  );
}
