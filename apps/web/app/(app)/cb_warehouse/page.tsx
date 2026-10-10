/** Legacy `VIEWS.cb_warehouse` (6973 → `cbList(m, 'warehouse')`). */
import { CodebookPage, type CbSearch } from '../sifrarnik/codebook';

export default function Page({ searchParams }: { searchParams: Promise<CbSearch> }) {
  return <CodebookPage k="warehouse" searchParams={searchParams} />;
}
