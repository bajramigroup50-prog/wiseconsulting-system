/** Legacy `ppPrint` (15797): payment orders, 3 per A4 page (`full` / `data`) or one 210×99 slip per page (`data1`). */
import { notFound } from 'next/navigation';
import { and, eq, inArray } from 'drizzle-orm';
import type { PaymentOrder } from '@wise/core';
import { appSettings, paymentOrders } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { PpSlip } from '@/components/pp-slip';
import { PrintPage } from '@/components/print-page';
import { markPrintedAction } from '../../../(app)/ppNal/actions';

export default async function PpPrint({ searchParams }: { searchParams: Promise<{ ids?: string | string[]; m?: string }> }) {
  const sp = await searchParams;
  const { u, firm } = await booksPage('ppNal');
  if (!firm) notFound();
  const ids = (Array.isArray(sp.ids) ? sp.ids : String(sp.ids ?? '').split(',')).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const L = ids.length ? await db().select().from(paymentOrders).where(and(eq(paymentOrders.firmId, firm.id), inArray(paymentOrders.id, ids))) : [];
  if (!L.length) return <PrintPage title="Налози"><p>Нема избрани налози.</p></PrintPage>;
  const mode = sp.m === 'data1' ? 'data1' : sp.m === 'data' ? 'data' : 'full';
  // calibration for pre-printed forms (legacy `ppCal`, office setting `ppCal[kind] = {dx, dy}`)
  const [off] = await db().select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, 'office')).limit(1);
  const cal = ((off?.v as Record<string, unknown> | undefined)?.ppCal ?? {}) as Record<string, { dx?: number; dy?: number }>;
  const per = mode === 'data1' ? 1 : 3;
  const pages: (typeof L)[] = [];
  for (let i = 0; i < L.length; i += per) pages.push(L.slice(i, i + per));
  const write = canDo(u, 'write', firm.id);
  return (
    <PrintPage title="Налози" onPrinted={write ? markPrintedAction.bind(null, L.map((o) => o.id)) : undefined}>
      <style>{`@page{size:${mode === 'data1' ? '210mm 99mm' : 'A4'};margin:0}#printArea{padding:0!important}.pg{width:210mm;height:${mode === 'data1' ? '99mm' : '297mm'};page-break-after:always;overflow:hidden}`}</style>
      {pages.map((p, i) => (
        <div className="pg" key={i}>
          {p.map((o) => {
            const n = o.data as unknown as PaymentOrder;
            const c = cal[n.kind] ?? {};
            return <PpSlip key={o.id} n={n} mode={mode === 'full' ? 'full' : 'data'} dx={Number(c.dx) || 0} dy={Number(c.dy) || 0} />;
          })}
        </div>
      ))}
    </PrintPage>
  );
}
