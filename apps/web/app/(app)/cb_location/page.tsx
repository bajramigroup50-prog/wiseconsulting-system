/** Legacy `VIEWS.cb_location` (6973 → `cbList(m, 'location')`). */
import { CodebookPage, type CbSearch } from '../sifrarnik/codebook';

export default function Page({ searchParams }: { searchParams: Promise<CbSearch> }) {
  return <CodebookPage k="location" searchParams={searchParams} />;
}
