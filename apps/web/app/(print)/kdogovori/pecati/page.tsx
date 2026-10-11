/**
 * Legacy `kdPdf` (+ the `tplRun(['kd'])` wrapper 16126): the accounting-service contract for print / PDF — from the
 * office's own Word template when one is active („📄 Шаблони“), otherwise the program's contract. `?builtin=1` forces
 * the program's contract.
 */
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { KD_SVC } from '@wise/core/firms/kdog';
import { tplKdVars } from '@wise/core/office';
import { serviceContracts } from '@wise/db';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { officePage } from '@/lib/office';
import { fillOwnTemplate, ownTemplate } from '@/lib/own-template';
import { contractHtml, loadOffice, rowToContract } from '../../../(app)/kdogovori/lib';

export default async function KdPrint({ searchParams }: { searchParams: Promise<{ id?: string; builtin?: string }> }) {
  const sp = await searchParams;
  const { firm } = await officePage('kdogovori');
  if (!firm || !sp.id || !/^[0-9a-f-]{36}$/i.test(sp.id)) notFound();
  const [r] = await db().select().from(serviceContracts).where(and(eq(serviceContracts.id, sp.id), eq(serviceContracts.firmId, firm.id))).limit(1);
  if (!r) notFound();
  const k = rowToContract(r);
  const t = sp.builtin ? null : await ownTemplate(['kd']);
  if (t) {
    const R = await fillOwnTemplate(t, firm, tplKdVars({ ...k, fee: fmt(Number(k.fee) || 0), services: KD_SVC.filter(([id]) => k.svc.includes(id)).map(([, n]) => n) }));
    return (
      <>
        {R.missing.length > 0 && <p className="note" data-noprint>⚠ Полиња без вредност во шаблонот: {R.missing.slice(0, 6).join(', ')}{R.missing.length > 6 ? ' …' : ''}</p>}
        <div dangerouslySetInnerHTML={{ __html: R.html() }} />
      </>
    );
  }
  return <div dangerouslySetInnerHTML={{ __html: await contractHtml(k, firm, await loadOffice(), { e: !!k.cliSig && !k.cliSig.scan }) }} />;
}
