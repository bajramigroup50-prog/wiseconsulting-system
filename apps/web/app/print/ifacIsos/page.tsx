/**
 * 🤝 IFAC – the list for ИСОС (ЗВСР чл. 32 ст. 9, by 31 January): the office's employees with their titles and ИСОС
 * register numbers and the professional liability insurance in force, for print / PDF (sent with the policy copy).
 */
import { notFound } from 'next/navigation';
import { can } from '@wise/core';
import { insNormalize, insStatus, isosListHtml, isosListNormalize, ISOS_KINDS } from '@wise/core/office/ifac-isos';
import { isosRows } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { isDemoUser } from '@/lib/demo';
import { viewAllowed } from '@/lib/nav';
import { today } from '@/lib/office';
import { loadProvider } from '../../(app)/kdogovori/lib';
import { isosListRows } from '../../(app)/ifac/lib';

export const metadata = { title: 'Список за ИСОС' };

export default async function PrintIfacIsos({ searchParams }: { searchParams: Promise<{ y?: string }> }) {
  const u = await requireUser();
  if (!viewAllowed(u.role, 'ifac') || !can(u.principal, 'office', null)) notFound();
  const sp = await searchParams;
  const year = /^\d{4}$/.test(sp.y ?? '') ? Number(sp.y) : new Date().getFullYear();
  const td = today();
  const [R, rows, P] = await Promise.all([db().transaction((tx) => isosRows(tx)), isosListRows(year, isDemoUser(u)), loadProvider(u)]);
  const L = R.find((r) => r.kind === ISOS_KINDS.list && r.year === year);
  const ld = L ? isosListNormalize(L.data) : null;
  // the date of the list: when it was sent, else today (but not after the deadline's year)
  const date = ld?.submittedOn ?? (td.startsWith(String(year)) ? td : `${year}-01-31`);
  const ins = insStatus(R.filter((r) => r.kind === ISOS_KINDS.ins).map((r) => insNormalize(r.data)), date);
  const html = isosListHtml({ office: P.O.name ?? '', edb: P.O.edb, city: P.O.city, year, date, rows: ld?.staff ?? rows, ins, rep: P.O.rep });
  return <div className="pdfdoc" dangerouslySetInnerHTML={{ __html: html }} />;
}
