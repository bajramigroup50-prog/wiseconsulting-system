/** Legacy `VIEWS.cb_cenovnik` (6973 → `cbList(m, 'cenovnik')`). */
import { CodebookPage, type CbSearch } from '../sifrarnik/codebook';

export default function Page({ searchParams }: { searchParams: Promise<CbSearch> }) {
  return <CodebookPage k="cenovnik" searchParams={searchParams} />;
}
