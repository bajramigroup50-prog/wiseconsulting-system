/** Legacy `ACT.gsXml` (`gsXml` 6791): `Godisna_smetka_<Y>.xml`. */
import { NextResponse } from 'next/server';
import { simpleStatements } from '@wise/core/yearend';
import { gsXml } from '@wise/core/yearend/tools';
import { loadYear } from '@wise/db';
import { booksPage } from '@/lib/books';
import { db } from '@/lib/db';
import { accountNames } from '@/lib/yearend';

export async function GET() {
  const { firm, year } = await booksPage('zsProc');
  if (!firm) return new NextResponse('Изберете фирма.', { status: 400 });
  const L = await loadYear(db(), firm.id, year);
  const B = L.Y.co.balances;
  const st = simpleStatements(B.pre, B.all, L.Y.closed ? Number(L.closing?.tax ?? 0) : null);
  const tb = Object.fromEntries(Object.entries(B.pre).map(([k, v]) => [k, { d: v.d, p: v.p }]));
  const xml = gsXml(year, { ...firm, aop: ((firm.settings ?? {}) as { aop?: Record<string, string> }).aop }, st, tb, await accountNames(firm.id));
  return new NextResponse(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'content-disposition': `attachment; filename="Godisna_smetka_${year}.xml"` } });
}
