/** Legacy `VIEWS.cb_route` (6973 → `cbList(m, 'route')`). */
import { CodebookPage, type CbSearch } from '../sifrarnik/codebook';

export default function Page({ searchParams }: { searchParams: Promise<CbSearch> }) {
  return <CodebookPage k="route" searchParams={searchParams} />;
}
