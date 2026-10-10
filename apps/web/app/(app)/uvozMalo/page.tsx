import { UvHub } from '../_retail/uv-hub';

/** Legacy `VIEWS.uvozMalo` → `uvHub(m, 'malo')`. */
export default async function Page({ searchParams }: { searchParams: Promise<{ wh?: string }> }) {
  return <UvHub k="malo" sp={await searchParams} />;
}
