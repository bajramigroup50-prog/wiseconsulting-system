/** Legacy `VIEWS.cb_oe` (6973 → `cbList(m, 'oe')`). */
import { CodebookPage, type CbSearch } from '../sifrarnik/codebook';

export default function Page({ searchParams }: { searchParams: Promise<CbSearch> }) {
  return <CodebookPage k="oe" searchParams={searchParams} />;
}
