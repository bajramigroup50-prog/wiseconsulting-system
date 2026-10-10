/** Legacy `VIEWS.cb_paysif` (6973 → `cbList(m, 'paysif')`). */
import { CodebookPage, type CbSearch } from '../sifrarnik/codebook';

export default function Page({ searchParams }: { searchParams: Promise<CbSearch> }) {
  return <CodebookPage k="paysif" searchParams={searchParams} />;
}
