/** Legacy firm list „⬇ Извоз“: the user's firms as Excel, in the columns the firm import (`firmiImp`) reads back. */
import * as XLSX from 'xlsx';
import { asc, eq, inArray, or } from 'drizzle-orm';
import { can } from '@wise/core';
import { FIMP_TEMPLATE } from '@wise/core/firms/firmimp';
import { firms, userFirms } from '@wise/db';
import { getUser } from '@/lib/auth';
import { db } from '@/lib/db';

export async function GET() {
  const u = await getUser();
  if (!u || !can(u.principal, 'firms')) return new Response('Forbidden', { status: 403 });
  const scoped = u.principal.firms.includes('*')
    ? undefined
    : or(inArray(firms.id, db().select({ id: userFirms.firmId }).from(userFirms).where(eq(userFirms.userId, u.id))), eq(firms.ownerId, u.id));
  const rows = await db().select().from(firms).where(scoped).orderBy(asc(firms.name));
  const str = (v: unknown) => (v == null ? '' : String(v));
  const data = rows.map((f) => {
    const s = (f.settings ?? {}) as Record<string, unknown>;
    return [f.code, f.name, f.legalForm, f.edb, f.embs, f.address, f.city, f.phone, f.email, f.activity, s.bank, s.bankName, s.contact,
      f.vatRegistered ? 'да' : 'не', f.vatRegistered ? (f.vatPeriod === 'month' ? 'месечно' : 'тромесечно') : ''].map(str);
  });
  const ws = XLSX.utils.aoa_to_sheet([FIMP_TEMPLATE, ...data]);
  ws['!cols'] = FIMP_TEMPLATE.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Фирми');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': "attachment; filename=\"Firmi.xlsx\"" },
  });
}
