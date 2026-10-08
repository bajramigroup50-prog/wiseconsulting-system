/** Print view of a VAT book, landscape (legacy `ACT.dkPdf` 8910). */
import { dmy } from '@/lib/fmt';
import { bookTitle, defaultBookSel, loadVatBook, validBookSel } from '@/lib/vat-view';
import { BookTable } from '../../(app)/ddvKnigi/book-table';
import { FirmHead, Sig } from '../firm-head';
import { printGuard } from '../guard';

export const metadata = { title: 'Книга за ДДВ' };

export default async function PrintDdvKnigi({ searchParams }: { searchParams: Promise<{ t?: string; sel?: string }> }) {
  const sp = await searchParams;
  const { firm, year } = await printGuard('ddvKnigi');
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
