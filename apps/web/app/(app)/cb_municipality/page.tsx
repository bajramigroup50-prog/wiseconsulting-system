/** Legacy `VIEWS.cb_municipality` (6973 → `cbList(m, 'municipality')`). */
import { CodebookPage, type CbSearch } from '../sifrarnik/codebook';

export default function Page({ searchParams }: { searchParams: Promise<CbSearch> }) {
  return <CodebookPage k="municipality" searchParams={searchParams} />;
}
