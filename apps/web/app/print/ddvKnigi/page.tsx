/** Print view of a VAT book, landscape (legacy `ACT.dkPdf` 8910). */
import { dmy } from '@/lib/fmt';
import { bookTitle, defaultBookSel, loadVatBook, validBookSel } from '@/lib/vat-view';
import { BookTable } from '../../(app)/ddvKnigi/book-table';
import { FirmHead, Sig } from '../firm-head';
import { printGuard } from '../guard';

export const metadata = { title: 'Книга за ДДВ' };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function PrintDdvKnigi({ searchParams }: { searchParams: Promise<{ t?: string; sel?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const { firm, year } = await printGuard('ddvKnigi');
  if (!sp.t && ISO.test(sp.from ?? '') && ISO.test(sp.to ?? '') && sp.from! <= sp.to!) {
    const range: [string, string] = [sp.from!, sp.to!];
    const BB = [await loadVatBook(firm, year, 'out', 'Y', range), await loadVatBook(firm, year, 'in', 'Y', range)];
    return (
      <>{BB.map((B, i) => (
        <div key={B.t} className="pdfdoc land" style={i ? { pageBreakBefore: 'always' } : undefined}>
          {!i && <style dangerouslySetInnerHTML={{ __html: '@page{size:A4 landscape}' }} />}
          <FirmHead firm={firm} title={bookTitle(B.t).toUpperCase()} sub={`Период ${dmy(B.from)} – ${dmy(B.to)}`} />
          <div style={{ fontSize: '7.5pt' }}><BookTable B={B} pdf /></div>
          <Sig />
        </div>
      ))}</>
    );
  }
  const t = sp.t === 'in' ? 'in' : 'out';
  const sel = validBookSel(sp.sel) ? sp.sel : defaultBookSel(firm);
  const B = await loadVatBook(firm, year, t, sel);
  return (
    <div className="pdfdoc land">
      <style dangerouslySetInnerHTML={{ __html: '@page{size:A4 landscape}' }} />
      <FirmHead firm={firm} title={bookTitle(t).toUpperCase()} sub={`Период ${dmy(B.from)} – ${dmy(B.to)}`} />
      <div style={{ fontSize: '7.5pt' }}><BookTable B={B} pdf /></div>
      <Sig />
    </div>
  );
}
