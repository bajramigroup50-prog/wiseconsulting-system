/**
 * Услуги — legacy `VIEWS.uslugiS` 6974 (`simpleList('items', …, i => i.type === 'service')`, Шифрарник hub 6984):
 * the item list filtered to services, with the same row actions (lock / inactive / delete, bulk delete) and the item
 * form preset to type „Услуга“ that returns here.
 */
import ArtikliPage from '../artikli/page';

export default async function UslugiSPage({ searchParams }: { searchParams: Promise<{ q?: string; edit?: string; nov?: string; use?: string }> }) {
  const sp = await searchParams;
  return <ArtikliPage searchParams={Promise.resolve({ ...sp, t: 'service' })} />;
}
