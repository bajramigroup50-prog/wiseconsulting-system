/** Legacy `frXlsx` (12081): the firm report as Excel, in the filter of the „🖨 Извештај за фирмите“ card. */
import * as XLSX from 'xlsx';
import { can } from '@wise/core';
import { FR_XLSX_HEAD } from '@wise/core/firms/firmform';
import { getUser } from '@/lib/auth';
import { firmReport } from '@/lib/firm-list';

export async function GET(req: Request) {
  const u = await getUser();
  if (!u || !can(u.principal, 'firms')) return new Response('Forbidden', { status: 403 });
  const p = new URL(req.url).searchParams;
  const { k, list } = await firmReport(u, { f: p.get('f') ?? undefined, ex: p.get('ex') ?? undefined });
  const rows = [[...FR_XLSX_HEAD], ...list.map((f, i) => [i + 1, f.name, f.edb ?? '', f.embs ?? '', f.address ?? '', f.city ?? '',
    f.vatRegistered ? 'Да' : 'Не', f.vatRegistered ? (f.vatPeriod === 'month' ? 'месечен' : 'тромесечен') : '', f.vatFrom, f.lockDate ?? ''])];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Фирми');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="Firmi_${k}.xlsx"` },
  });
}
