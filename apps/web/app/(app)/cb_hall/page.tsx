/** Legacy `VIEWS.cb_hall` (6973 → `cbList(m, 'hall')`). */
import { CodebookPage, type CbSearch } from '../sifrarnik/codebook';

export default function Page({ searchParams }: { searchParams: Promise<CbSearch> }) {
  return <CodebookPage k="hall" searchParams={searchParams} />;
}
