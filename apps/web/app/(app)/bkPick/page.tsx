/** Legacy `VIEWS.bkPick` 12692 (на кого е платено / од кого е примено) is the line editor of „Изводи“ (`/banka?line=<id>`). */
import { redirect } from 'next/navigation';

export default async function BkPickPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  redirect(id && /^[0-9a-f-]{36}$/i.test(id) ? `/banka?line=${id}` : '/banka');
}
