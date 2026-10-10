/** Legacy `VIEWS.cb_city` (6973 → `cbList(m, 'city')`). */
import { CodebookPage, type CbSearch } from '../sifrarnik/codebook';

export default function Page({ searchParams }: { searchParams: Promise<CbSearch> }) {
  return <CodebookPage k="city" searchParams={searchParams} />;
}
