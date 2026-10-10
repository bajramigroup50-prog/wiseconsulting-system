/** Legacy `VIEWS.cb_currency` (6973 → `cbList(m, 'currency')`). */
import { CodebookPage, type CbSearch } from '../sifrarnik/codebook';

export default function Page({ searchParams }: { searchParams: Promise<CbSearch> }) {
  return <CodebookPage k="currency" searchParams={searchParams} />;
}
