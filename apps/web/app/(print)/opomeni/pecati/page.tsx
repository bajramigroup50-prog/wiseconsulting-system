/** Legacy `opPdfHTML` (v401): the dunning letter, printed / saved as PDF (toolbar from the `(print)` layout). */
import { notFound } from 'next/navigation';
import { officePage } from '@/lib/office';
import { letterFor, loadDunning, lvlOk } from '../../../(app)/opomeni/data';

export default async function OpomenaPrint({ searchParams }: { searchParams: Promise<{ p?: string; l?: string }> }) {
  const sp = await searchParams;
  const { firm } = await officePage('opomeni');
  if (!firm || !sp.p) notFound();
  const D = await loadDunning(firm);
  const g = D.G.find((x) => x.pid === sp.p);
  if (!g) notFound();
  const { html } = letterFor(D, g, lvlOk(sp.l));
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
