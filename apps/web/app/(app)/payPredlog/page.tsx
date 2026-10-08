/** Legacy `VIEWS.payPredlog` 6266 → 15260, Плата › Внеси предлог податоци. */
import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
import { payrollRuns } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { payPage } from '@/lib/payroll/server';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { NewMonth } from '../plati/new-month';

export default async function PayPredlogPage() {
  const { u, firm, year } = await payPage('payPredlog');
  if (!firm) return <NoFirm t="Внеси предлог податоци" />;
  const [last] = await db().select({ month: payrollRuns.month }).from(payrollRuns).where(and(eq(payrollRuns.firmId, firm.id))).orderBy(desc(payrollRuns.month)).limit(1);
  const next = last ? (last.month.slice(5) === '12' ? `${+last.month.slice(0, 4) + 1}-01` : `${last.month.slice(0, 4)}-${String(+last.month.slice(5) + 1).padStart(2, '0')}`) : `${year}-${new Date().toISOString().slice(5, 7)}`;
  return (
    <>
      <Hd t="Внеси предлог податоци" sub="нов месец со предлог ставки"><Link className="btn" href="/plati">← Пресметка на плата</Link></Hd>
      {canDo(u, 'write', firm.id) ? <NewMonth next={next} full /> : <div className="card empty">Немате дозвола за внес.</div>}
    </>
  );
}
