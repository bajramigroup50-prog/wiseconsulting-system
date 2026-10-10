/** Legacy `VIEWS.cb_fgroup` (6973 → `cbList(m, 'fgroup')`). */
import { CodebookPage, type CbSearch } from '../sifrarnik/codebook';

export default function Page({ searchParams }: { searchParams: Promise<CbSearch> }) {
  return <CodebookPage k="fgroup" searchParams={searchParams} />;
}
