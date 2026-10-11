/** Legacy `arXlsx`: „Листа (Excel)“ of the archive, with the screen's filters. */
import * as XLSX from 'xlsx';
import { archFilter, archXlsxRows } from '@wise/core/office/archive';
import { getUser } from '@/lib/auth';
import { archRows } from '@/lib/archive';
import { currentFirm } from '@/lib/context';

export async function GET(req: Request) {
  const u = await getUser();
  const firm = u ? await currentFirm(u) : null;
  if (!u || !firm) return new Response('Forbidden', { status: 403 });
  const p = new URL(req.url).searchParams;
  const g = (k: string) => p.get(k) ?? '';
  const R = archFilter(await archRows(firm.id), { q: g('q'), kind: g('kind'), from: g('from'), to: g('to'), year: Number(g('year')) || undefined });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(archXlsxRows(R)), 'Архива');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="Arhiva_${new Date().toISOString().slice(0, 10)}.xlsx"` },
  });
}
