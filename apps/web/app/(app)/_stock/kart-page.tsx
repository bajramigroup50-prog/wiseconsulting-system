/**
 * Материјална картица / Картица на производ — legacy `kartView(retail)` 4981 (`kartData` 4973, `kartTable` 4979).
 * At cost (g_kartica) or at the current retail price of the location (m_kartica). Header: „PDF сите картици“
 * (`kartAllPdf` 7362 → `/print/kartice`), „PDF“ (`kartPdf` 7361: firm head, item · unit · period, landscape), plus Excel.
 */
import Link from 'next/link';
import { itemCard, trackedItems } from '@wise/core';
import { stockPage, locOptions, pickLoc, rangeOf } from '@/lib/stock';
import { dmy } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { ExportButtons, ServerPdfButton } from '@/components/doc-tools';
import { PrintHead, PrintSig } from '@/components/print-head';
import { PrintButton } from '@/components/stock-ui';
import { KartTable, kartAoa } from './book-tables';

export type KartSP = { i?: string; wh?: string; from?: string; to?: string };

export async function KartPage({ retail, sp }: { retail: boolean; sp: KartSP }) {
  const t = retail ? 'Картица на производ' : 'Материјална картица';
  const { firm, year, L } = await stockPage(retail ? 'm_kartica' : 'g_kartica');
  if (!firm || !L) return <NoFirm t={t} />;
  const its = trackedItems(L.ctx);
  const it = its.find((i) => i.id === sp.i) ?? its[0];
  if (!it) return <><Hd t={t} /><div className="card empty">Нема артикли со залиха.</div></>;
  const wh = pickLoc(L, sp.wh);
  const [from, to] = rangeOf(sp, year);
  const k = itemCard(L.ctx, { item: it, wh, from, to, retail });
  const all = '/print/kartice?' + new URLSearchParams({ r: retail ? '1' : '0', from, to, ...(wh ? { wh } : {}) }).toString();
  const sub = (it.code ? it.code + ' · ' : '') + it.name + ' · ' + (it.unit || '') + ' · ' + dmy(from) + ' – ' + dmy(to);
  return (
    <>
      <Hd exp={false} t={t} sub={retail ? 'по малопродажна цена' : 'по набавна вредност'}>
        <Link className="btn" href={all} target="_blank">PDF сите картици</Link>
        <ExportButtons name={(retail ? 'Kartica_proizvod_' : 'Materijalna_kartica_') + (it.code || it.name)} rows={kartAoa(k, retail)} />
        <ServerPdfButton title={t + ' ' + (it.name ?? '')} landscape />
        <PrintButton label="Печати" className="btn" />
      </Hd>
      <form className="card">
        <div className="row" style={{ gap: 12, alignItems: 'end' }}>
          <label className="f" style={{ minWidth: 260 }}>Артикл
            <select name="i" defaultValue={it.id}>{its.map((i) => <option key={i.id} value={i.id}>{(i.code ? i.code + ' · ' : '') + i.name}</option>)}</select>
          </label>
          <label className="f">Објект
            <select name="wh" defaultValue={wh}><option value="">Сите објекти</option>{locOptions(L).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          </label>
          <label className="f">Од<input type="date" name="from" defaultValue={from} /></label>
          <label className="f">До<input type="date" name="to" defaultValue={to} /></label>
          <button className="btn">Прикажи</button>
        </div>
      </form>
      <div className="tw printarea" id="rpt">
        <PrintHead firm={firm} title={retail ? 'КАРТИЦА НА ПРОИЗВОД' : 'МАТЕРИЈАЛНА КАРТИЦА'} sub={sub} />
        <p className="mini noprint">{firm.name} · {t} · {(it.code ? it.code + ' · ' : '') + it.name} · {wh ? L.locName(wh) : 'сите објекти'} · {dmy(from)} – {dmy(to)}</p>
        <KartTable k={k} retail={retail} />
        <PrintSig />
      </div>
    </>
  );
}
