import { UvHub } from '../_retail/uv-hub';

/** Legacy `VIEWS.uvozMat` → `uvHub(m, 'mat')`. */
export default async function Page({ searchParams }: { searchParams: Promise<{ wh?: string }> }) {
  return <UvHub k="mat" sp={await searchParams} />;
}
