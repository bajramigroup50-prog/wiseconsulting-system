/** ISRS 4410 engagement letter of the current firm and year, for print / PDF (the same HTML as the dossier copy). */
import { notFound } from 'next/navigation';
import { can } from '@wise/core';
import { letterOf } from '@wise/db';
import { db } from '@/lib/db';
import { printGuard } from '../guard';
import { loadProvider } from '../../(app)/kdogovori/lib';
import { letterHtml } from '../../(app)/ifac/lib';

export const metadata = { title: 'Писмо за ангажман' };

export default async function PrintIfacEl({ searchParams }: { searchParams: Promise<{ y?: string }> }) {
  const { u, firm, year: y0 } = await printGuard('ifac');
  if (!can(u.principal, 'office', firm.id)) notFound();
  const sp = await searchParams;
  const year = /^\d{4}$/.test(sp.y ?? '') ? Number(sp.y) : y0;
  const cur = await db().transaction((tx) => letterOf(tx, firm.id, year));
  if (!cur) notFound();
  return <div className="pdfdoc" dangerouslySetInnerHTML={{ __html: await letterHtml(cur.letter, firm, (await loadProvider(u)).O) }} />;
}
