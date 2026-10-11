/** Legacy `ACT.kkPdf` 7973: „АНАЛИТИЧКА КАРТИЦА – КОНТО k“, sub = name · period · partner, `kkTable(X,true)`, landscape, signatures. */
import { dmy } from '@/lib/fmt';
import { kkData, type KkSP } from '../../(app)/kkart/data';
import { KkTable } from '../../(app)/kkart/table';
import { FirmHead, Sig } from '../firm-head';
import { printGuard } from '../guard';

export const metadata = { title: 'Аналитичка картица' };

export default async function PrintKkart({ searchParams }: { searchParams: Promise<KkSP> }) {
  const sp = await searchParams;
  const { firm, year } = await printGuard('kkart');
  const d = await kkData(firm.id, year, sp);
  return (
    <div className="pdfdoc land">
      <style dangerouslySetInnerHTML={{ __html: '@page{size:A4 landscape}' }} />
      <FirmHead firm={firm} title={`АНАЛИТИЧКА КАРТИЦА – КОНТО ${d.k}`} sub={`${d.name} · ${dmy(d.from)} – ${dmy(d.to)}${d.subT}`} />
      <KkTable d={d} pdf />
      <Sig who={['Составил', 'Одговорно лице']} />
    </div>
  );
}
