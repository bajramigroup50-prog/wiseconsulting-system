/** Legacy `aopXml` 7725: `AOP_<Y>.xml` (both statements, current and previous year). */
import { NextResponse } from 'next/server';
import { aopXml } from '@wise/core/yearend/tools';
import { loadYear } from '@wise/db';
import { booksPage } from '@/lib/books';
import { db } from '@/lib/db';

export async function GET() {
  const { firm, year } = await booksPage('zsProc');
  if (!firm) return new NextResponse('Изберете фирма.', { status: 400 });
  const L = await loadYear(db(), firm.id, year);
  const xml = aopXml(year, firm, L.rules, L.Y.co.zs.V, L.prev.V);
  return new NextResponse(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'content-disposition': `attachment; filename="AOP_${year}.xml"` } });
}
