/** Legacy `VIEWS.cb_store` (6973 → `cbList(m, 'store')`). */
import { CodebookPage, type CbSearch } from '../sifrarnik/codebook';

export default function Page({ searchParams }: { searchParams: Promise<CbSearch> }) {
  return <CodebookPage k="store" searchParams={searchParams} />;
}
