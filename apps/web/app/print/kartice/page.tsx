/**
 * PDF of all item cards — legacy `kartAllPdf` 7362 (g_kartica / m_kartica: every item with moves or a balance, one
 * card per page, landscape) and `cardsPdf` 7305 (Приемници и издатници: all cards or one, `?i=`).
 */
import { notFound } from 'next/navigation';
import { Fragment } from 'react';
import { itemCard, trackedItems } from '@wise/core';
import { loadStockContext } from '@wise/db';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { rangeOf } from '@/lib/stock';
import { KartTable } from '@/app/(app)/_stock/book-tables';
import { PageBreak } from '@/components/print-head';
import { FirmHead, Sig } from '../firm-head';
import { printGuard } from '../guard';

const VIEWS = new Set(['g_kartica', 'm_kartica', 'zaliha']);

export default async function PrintKartice({ searchParams }: { searchParams: Promise<{ r?: string; wh?: string; from?: string; to?: string; i?: string; v?: string }> }) {
  const sp = await searchParams;
  const retail = sp.r === '1';
  const view = sp.v && VIEWS.has(sp.v) ? sp.v : retail ? 'm_kartica' : 'g_kartica';
  const { firm, year } = await printGuard(view);
  const L = await loadStockContext(db(), firm.id);
  const wh = sp.wh && (sp.wh === 'main' || L.locations.some((l) => l.id === sp.wh)) ? sp.wh : '';
  const [from, to] = rangeOf(sp, year);
  const its = trackedItems(L.ctx).filter((i) => !sp.i || i.id === sp.i);
  if (sp.i && !its.length) notFound();
  const cards = its.map((it) => itemCard(L.ctx, { item: it, wh, from, to, retail })).filter((k) => !(k.rows.length < 2 && !(k.rows[0] && k.rows[0].open && k.rows[0].q)));
  const t = retail ? 'КАРТИЦА НА ПРОИЗВОД' : 'МАТЕРИЈАЛНА КАРТИЦА';
  return (
    <div className="pdfdoc land printarea">
      {!cards.length && <p>Нема картици за печатење.</p>}
      {cards.map((k, n) => (
        <Fragment key={k.item.id}>
          {n > 0 && <PageBreak />}
          <FirmHead firm={firm} title={t} sub={(k.item.code ? k.item.code + ' · ' : '') + k.item.name + ' · ' + (k.item.unit || '') + ' · ' + dmy(from) + ' – ' + dmy(to) + (wh ? ' · ' + L.locName(wh) : '')} />
          <KartTable k={k} retail={retail} />
        </Fragment>
      ))}
      {cards.length > 0 && <Sig />}
    </div>
  );
}
