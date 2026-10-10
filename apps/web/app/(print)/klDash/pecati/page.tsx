/** Legacy `kdRepPdf` (14981): the business report for the client, printed / saved as PDF. */
import { isKdPer, kdRange } from '@wise/core/firms/dash';
import { getOfficeProfile } from '@wise/db';
import { currentYear } from '@/lib/context';
import { db } from '@/lib/db';
import { officePage, today } from '@/lib/office';
import { kdData } from '../../../(app)/klDash/data';
import { kdReportHtml } from '../../../(app)/klDash/report';

export default async function KdReportPrint({ searchParams }: { searchParams: Promise<{ p?: string; f?: string; t?: string }> }) {
  const { u, firm } = await officePage('klDash');
  if (!firm) return <p>Изберете фирма.</p>;
  const sp = await searchParams;
  const year = await currentYear();
  const [from, to, pl] = kdRange(year, isKdPer(sp.p) ? sp.p : 'ytd', today(), sp.f, sp.t);
  const [R, O] = await Promise.all([kdData(firm, year, from, to), getOfficeProfile(db())]);
  return <div dangerouslySetInnerHTML={{ __html: kdReportHtml(R, firm, pl, from, to, [O.name, u.name].filter(Boolean).join(' – '), today()) }} />;
}
