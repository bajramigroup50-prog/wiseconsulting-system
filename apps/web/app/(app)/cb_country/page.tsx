/** Legacy `VIEWS.cb_country` (6973 → `cbList(m, 'country')`). */
import { CodebookPage, type CbSearch } from '../sifrarnik/codebook';

export default function Page({ searchParams }: { searchParams: Promise<CbSearch> }) {
  return <CodebookPage k="country" searchParams={searchParams} />;
}
