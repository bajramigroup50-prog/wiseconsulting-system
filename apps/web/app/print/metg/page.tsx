/** Legacy `metgAllPdf` 5073: МЕТГ (quantity card) for every item with moves or an opening balance, one per page. */
import { Fragment } from 'react';
import { metgCard, trackedItems } from '@wise/core';
import { loadStockContext, stockDocResolver } from '@wise/db';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { rangeOf } from '@/lib/stock';
import { MetgTable } from '@/app/(app)/_stock/book-tables';
import { PageBreak } from '@/components/print-head';
import { FirmHead, Sig } from '../firm-head';
import { printGuard } from '../guard';

export default async function PrintMetg({ searchParams }: { searchParams: Promise<{ wh?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const { firm, year } = await printGuard('g_trg');
  const L = await loadStockContext(db(), firm.id);
  const wh = sp.wh && (sp.wh === 'main' || L.locations.some((l) => l.id === sp.wh && l.kind === 'warehouse')) ? sp.wh : '';
  const [from, to] = rangeOf(sp, year);
  const docOf = await stockDocResolver(db(), L);
  const parts = trackedItems(L.ctx).map((it) => ({ it, D: metgCard(L.ctx, { item: it.id, wh, from, to, docOf }) })).filter((x) => x.D.rows.length || x.D.open);
  return (
    <div className="pdfdoc land printarea">
      {!parts.length && <p>Нема движења за печатење.</p>}
      {parts.map(({ it, D }, n) => (
        <Fragment key={it.id}>
          {n > 0 && <PageBreak />}
          <FirmHead firm={firm} title="КОЛИЧИНСКА ЕВИДЕНЦИЈА ПО АРТИКЛ" sub={dmy(from) + ' – ' + dmy(to)} />
          <MetgTable it={it} D={D} whName={wh ? L.locName(wh) : 'сите магацини'} from={from} to={to} />
        </Fragment>
      ))}
      {parts.length > 0 && <Sig />}
    </div>
  );
}
