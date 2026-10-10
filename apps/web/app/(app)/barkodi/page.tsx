/**
 * Баркодови и етикети — legacy `VIEWS.barkodi` 9201, `bkGen`, `bkPrint`, `bkStock`, `bkOne`, `bkClr`: internal EAN-13
 * (prefix 29) for items without a barcode, A4 3 × 8 labels with name, barcode and retail price at a location.
 */
import { retailPrice, stock, Retail } from '@wise/core';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { loadArtItems } from '@/lib/retail';
import { locOptions, pickLoc, stockPage } from '@/lib/stock';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { bkGenAction } from '../_retail/actions';
import { Labels } from './labels';

export default async function BarkodiPage({ searchParams }: { searchParams: Promise<{ wh?: string; only?: string }> }) {
  const sp = await searchParams;
  const { u, firm, L } = await stockPage('barkodi');
  if (!firm || !L) return <NoFirm t="Баркодови и етикети" />;
  const write = canDo(u, 'bkGen', firm.id);
  const W = pickLoc(L, sp.wh) || 'main';
  const { items } = await loadArtItems(db(), firm.id);
  const core = new Map((L.ctx.items ?? []).map((i) => [i.id, i]));
  const list = items.filter((i) => i.active !== false && i.type !== 'service').sort((a, b) => a.name.localeCompare(b.name, 'mk'));
  const noBc = list.filter((i) => !(i.barcodes ?? []).length).length;
  const rows = list.filter((i) => sp.only !== 'no' || !(i.barcodes ?? []).length).map((i) => {
    const bc = (i.barcodes ?? [])[0] ?? '';
    const it = core.get(i.id);
    return { id: i.id, code: i.code ?? '', name: i.name, unit: i.unit ?? '', barcode: bc, valid: Retail.eanValid(bc), price: it ? retailPrice(it, W) : 0, qty: stock(L.ctx, i.id, W).qty };
  });
  return (
    <>
      <Hd t="Баркодови и етикети" sub={`${items.length} артикли`}>
        {write && <RowAction action={bkGenAction} className="btn" label={`Додели внатрешен баркод на ${noBc} артикли без баркод`} confirm={`Да се доделат внатрешни баркодови (29…) на ${noBc} артикли без баркод?`} />}
      </Hd>
      <form className="card noprint"><div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="mini">Прикажи <select name="only" defaultValue={sp.only ?? ''} style={{ width: 'auto' }}><option value="">сите</option><option value="no">без баркод</option></select></label>
        <label className="mini">Цена за објект <select name="wh" defaultValue={W} style={{ width: 'auto' }}>{locOptions(L).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <button className="btn">Прикажи</button>
      </div>
      <p className="note" style={{ margin: '8px 0 0' }}>Артиклите што немаат баркод од производителот добиваат внатрешен EAN-13 (почнува со 29 – за употреба само во вашите продавници). Етикетите (A4, 3×8) имаат назив, баркод и малопродажна цена со ДДВ. Скенерот работи како тастатура: каде пишува „📷 Скенирај“ (каса, влез, фактура) само скенирајте.</p></form>
      <Labels rows={rows} firmName={firm.name} />
    </>
  );
}
