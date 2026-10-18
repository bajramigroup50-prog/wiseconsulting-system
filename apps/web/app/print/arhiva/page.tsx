/**
 * „🖨 Печати избраните“ from the archive: every ticked file (photos and every page of the PDFs) with the stamp
 * „АРХИВСКИ ПРИМЕРОК“ – firm, document, nalog, date of printing – on each page.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { files } from '@wise/db';
import { archRows } from '@/lib/archive';
import { db } from '@/lib/db';
import { dmy, todayIso } from '@/lib/fmt';
import { printGuard } from '../guard';
import { ArchPrint } from './arch-print';

export const metadata = { title: 'Архивски примерок' };

export default async function PrintArhiva({ searchParams }: { searchParams: Promise<{ f?: string | string[] }> }) {
  const sp = await searchParams;
  const { firm } = await printGuard('arhiva');
  const raw = Array.isArray(sp.f) ? sp.f : sp.f ? [sp.f] : [];
  const ids = [...new Set(raw.flatMap((x) => x.split(',')).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 200);
  const F = ids.length ? await db().select({ id: files.id, name: files.name, mime: files.mime }).from(files).where(and(eq(files.firmId, firm.id), inArray(files.id, ids))) : [];
  const R = await archRows(firm.id);
  const rowOf = new Map(R.flatMap((r) => r.files.map((f) => [f.id, r] as const)));
  const items = ids.flatMap((id) => {
    const f = F.find((x) => x.id === id);
    if (!f) return [];
    const r = rowOf.get(id);
    const label = r ? [r.kind, r.no, r.pn, r.date ? dmy(r.date) : '', r.nalog ? 'налог ' + r.nalog : ''].filter(Boolean).join(' · ') : f.name;
    return [{ id: f.id, name: f.name, mime: f.mime, label }];
  });
  return <ArchPrint items={items} stamp={`АРХИВСКИ ПРИМЕРОК · ${firm.name} · печатено ${dmy(todayIso())}`} />;
}
