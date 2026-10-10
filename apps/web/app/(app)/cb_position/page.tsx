/** Legacy `VIEWS.cb_position` (6973 → `cbList(m, 'position')`). */
import { CodebookPage, type CbSearch } from '../sifrarnik/codebook';

export default function Page({ searchParams }: { searchParams: Promise<CbSearch> }) {
  return <CodebookPage k="position" searchParams={searchParams} />;
}
