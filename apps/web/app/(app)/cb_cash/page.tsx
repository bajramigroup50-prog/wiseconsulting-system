/** Legacy `VIEWS.cb_cash` (6973 → `cbList(m, 'cash')`). */
import { CodebookPage, type CbSearch } from '../sifrarnik/codebook';

export default function Page({ searchParams }: { searchParams: Promise<CbSearch> }) {
  return <CodebookPage k="cash" searchParams={searchParams} />;
}
