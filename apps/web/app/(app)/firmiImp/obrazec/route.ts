/** Legacy `tplXlsx` (`c=firms`): empty Excel with the headings the firm import recognises. */
import * as XLSX from 'xlsx';
import { can } from '@wise/core';
import { FIMP_TEMPLATE } from '@wise/core/firms/firmimp';
import { getUser } from '@/lib/auth';

export async function GET() {
  const u = await getUser();
  if (!u || !can(u.principal, 'firms')) return new Response('Forbidden', { status: 403 });
  const ws = XLSX.utils.aoa_to_sheet([FIMP_TEMPLATE, ['', 'ПРИМЕР ДООЕЛ Скопје', 'ДООЕЛ', '4030000000000', '7000000', 'ул. Пример 1', 'Скопје', '02 000 000', 'info@primer.mk', '62.01 Компјутерско програмирање', '300000000000000', 'Банка', 'Име Презиме', 'да', 'тромесечно']]);
  ws['!cols'] = FIMP_TEMPLATE.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Фирми');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': "attachment; filename=\"Firmi_obrazec.xlsx\"" },
  });
}
