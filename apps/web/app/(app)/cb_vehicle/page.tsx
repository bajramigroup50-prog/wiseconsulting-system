/** Legacy `VIEWS.cb_vehicle` (6973 → `cbList(m, 'vehicle')`). */
import { CodebookPage, type CbSearch } from '../sifrarnik/codebook';

export default function Page({ searchParams }: { searchParams: Promise<CbSearch> }) {
  return <CodebookPage k="vehicle" searchParams={searchParams} />;
}
