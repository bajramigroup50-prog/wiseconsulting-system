/**
 * ЦРСМ XML download (legacy ACT `crmXmlDl` 11066 behind `zcGate` 11234): `<AnnualAccount>` Operation 450, forms
 * 35–38. Query: `prev=1` adds the previous-year column, `zeros=1` writes zero AOPs too.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { crmXml } from '@wise/core';
import { forms3538, loadYear, yearFindings } from '@wise/db';
import { requireCan, requireUser } from '@/lib/auth';
import { currentFirm, currentYear } from '@/lib/context';
import { db } from '@/lib/db';
import { accountNames, todayMk } from '@/lib/yearend';

export async function GET(req: NextRequest) {
  const u0 = await requireUser();
  const firm = await currentFirm(u0);
  if (!firm) return new NextResponse('Изберете фирма.', { status: 400 });
  await requireCan('write', firm.id);
  const year = await currentYear();
  const L = await loadYear(db(), firm.id, year);
  const F = await yearFindings(db(), L, todayMk());
  if (F.open.length) {
    return new NextResponse(`XML за ЦРМ не се издава додека има ${F.open.length} неразрешени наоди во „Контрола“.`, { status: 409, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const { de, f35 } = forms3538(L, await accountNames(firm.id));
  const q = req.nextUrl.searchParams;
  const xml = crmXml({
    year, current: L.Y.co.zs, previous: L.prev, rules: L.rules, de38: de, f35, f35Raw: L.statement?.f35Raw ?? null,
    embs: firm.embs ?? '', period: L.statement?.crmPeriod ?? 1,
  }, { prev: q.get('prev') === '1', zeros: q.get('zeros') === '1' });
  const name = `GodisnaSmetka_${(firm.embs ?? '').replace(/\D/g, '') || 'firma'}_${year}.xml`;
  return new NextResponse(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'content-disposition': `attachment; filename="${name}"` } });
}
