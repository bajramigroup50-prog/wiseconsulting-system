/** ISRS 4410 (Revised) §40 – the compiler's report on the current firm's financial statements of the year, for print / PDF. */
import { notFound } from 'next/navigation';
import { can } from '@wise/core';
import { EL_FRAMEWORKS, elFileNormalize, qcNormalize } from '@wise/core/office/ifac';
import { crHtml } from '@wise/core/office/ifac-sqm';
import { ifacGet, letterOf } from '@wise/db';
import { db } from '@/lib/db';
import { printGuard } from '../guard';
import { firmOf, loadProvider } from '../../(app)/kdogovori/lib';

export const metadata = { title: 'Извештај за составување' };

export default async function PrintIfacCr({ searchParams }: { searchParams: Promise<{ y?: string }> }) {
  const { u, firm, year: y0 } = await printGuard('ifac');
  if (!can(u.principal, 'office', firm.id)) notFound();
  const sp = await searchParams;
  const year = /^\d{4}$/.test(sp.y ?? '') ? Number(sp.y) : y0;
  const [l, q, P] = await Promise.all([db().transaction((tx) => letterOf(tx, firm.id, year)), db().transaction((tx) => ifacGet(tx, 'qc', year, firm.id)), loadProvider(u)]);
  const doc = (q ? qcNormalize(q.data as never).doc : null) ?? elFileNormalize(null);
  const fw = EL_FRAMEWORKS.find((x) => x[0] === l?.letter.framework)?.[1] ?? EL_FRAMEWORKS[0][1];
  return <div className="pdfdoc" dangerouslySetInnerHTML={{ __html: crHtml(firmOf(firm), P.O, year, l?.letter ?? null, doc, fw) }} />;
}
