/**
 * „⬇ Преземи избраните“ in the archive: the ticked files of the current firm as one ZIP — a folder per document
 * („<date> <kind> <number>“) and „СПИСОК.txt“ (what was handed over, from the archive, with the keeping period).
 */
import { and, eq, inArray } from 'drizzle-orm';
import { firmAllowed } from '@wise/core';
import { archKeepUntil } from '@wise/core/office/archive';
import { files } from '@wise/db';
import { getUser } from '@/lib/auth';
import { archRows } from '@/lib/archive';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { zipFiles } from '@/lib/docx';
import { dmy, todayIso } from '@/lib/fmt';
import { getObjectBytes } from '@/lib/storage';

export async function GET(req: Request) {
  const u = await getUser();
  const firm = u ? await currentFirm(u) : null;
  if (!u || !firm || !firmAllowed(u.principal, firm.id, firm.ownerId)) return new Response('Forbidden', { status: 403 });
  const ids = [...new Set(new URL(req.url).searchParams.getAll('f').flatMap((x) => x.split(',')).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 300);
  if (!ids.length) return new Response('Изберете документи.', { status: 400 });
  const F = await db().select({ id: files.id, name: files.name, key: files.bucketKey }).from(files).where(and(eq(files.firmId, firm.id), inArray(files.id, ids)));
  const R = await archRows(firm.id);
  const rowOf = new Map(R.flatMap((r) => r.files.map((f) => [f.id, r] as const)));
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || 'документ';
  const entries: { name: string; data: Uint8Array | string }[] = [];
  const list: string[] = [`${firm.name} – документи од архивата (АРХИВСКИ ПРИМЕРОК), преземено ${dmy(todayIso())}`, ''];
  for (const f of F) {
    const r = rowOf.get(f.id);
    const dir = safe(r ? `${r.date} ${r.kind} ${r.no}`.trim() : 'Други');
    entries.push({ name: `${dir}/${safe(f.name)}`, data: await getObjectBytes(f.key) });
    const keep = r ? archKeepUntil(r) : null;
    list.push([r?.date ? dmy(r.date) : '', r?.kind ?? '', r?.no ?? '', r?.pn ?? '', r?.nalog ? 'налог ' + r.nalog : '', f.name, keep ? 'чувај до ' + dmy(keep) : ''].join('\t'));
  }
  entries.push({ name: 'СПИСОК.txt', data: list.join('\r\n') });
  return new Response(new Uint8Array(zipFiles(entries)), {
    headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="Arhiva_${todayIso()}.zip"` },
  });
}
