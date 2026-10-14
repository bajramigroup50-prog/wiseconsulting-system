/**
 * ⚖ Правен асистент — a saved case as an internal memo (print / server PDF). Office staff only (`officePage('lawAi')`
 * + access to the case's firm); never the client portal.
 */
import { notFound } from 'next/navigation';
import { lawCaseMemo } from '@/lib/law-case';
import { officePage } from '@/lib/office';

export default async function LawMemo({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { u } = await officePage('lawAi');
  const m = await lawCaseMemo(u, (await searchParams).id ?? '');
  if (!m) notFound();
  return <div style={{ fontSize: 12.5, lineHeight: 1.45 }} dangerouslySetInnerHTML={{ __html: m.html }} />;
}
