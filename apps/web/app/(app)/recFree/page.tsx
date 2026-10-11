/** Legacy `VIEWS.recFree` 13756 (+ v431 common period / auto direction) — 🔍 Споредба на две картици (од било кој програм). */
import { booksPage } from '@/lib/books';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { CompareForm } from '../recon/recon-client';

export default async function RecFreePage() {
  const { firm, year } = await booksPage('recFree');
  if (!firm) return <NoFirm t="Споредба на две картици" />;
  const short = String((firm.settings as { short?: string } | null)?.short ?? '') || firm.name;
  return (
    <>
      <Hd t="Споредба на две картици" sub="прикачете ги двете картици – од нашиот или од било кој друг програм – и програмот ги наоѓа разликите" />
      <CompareForm firmName={short} firmId={firm.id} year={year} />
      <p className="note">Картиците се читаат од Excel (.xlsx/.xls) или CSV со колони датум, документ / опис, должи, побарува, или од PDF / слика (автоматско читање). Ставките за почетно / пренесено салдо и ставките пред заедничкиот период се собираат во салдото пред периодот.</p>
    </>
  );
}
