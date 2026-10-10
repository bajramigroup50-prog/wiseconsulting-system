/**
 * Излез од продавница — legacy `VIEWS.m_izlez` 5706 (`MOUT`, `moEditor` 5719, `moSaveDoc` 5766, `moPdfHTML` 5789):
 * type (F7) — продажба / парагон, фактура од продавница, повратница до добавувач, отпис, контролен попис — store
 * filter, the note of the type, the list (Број, Датум, Продавница, Опис / Добавувач, Ставки, value) with Измени / PDF /
 * 🗑, „+ Нов документ (Ins)“, „← Влезни калкулации“, the editor with Excel template / import, and the document print
 * (ПРОДАЖБА / ПАРАГОН, ПОВРАТНИЦА, ЗАПИСНИК ЗА ОТПИС, ЗАПИСНИК ОД КОНТРОЛЕН ПОПИС).
 * Sales / returns: `store_outs` (`saveStoreOut`); counts / write-offs: `stock_counts` (`saveStockCount`).
 */
import Link from 'next/link';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { priceAt } from '@wise/core';
import { MOUT, moTotal, type MoutKind } from '@wise/core/retail';
import { effectiveChart, itemBarcodes, partners, stockCounts, storeOuts } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { itemOptions, locOptions, stockPage, todayIso } from '@/lib/stock';
import { dmy, fmt, fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { PdfButton } from '@/components/pdf-button';
import { FirmHead } from '@/app/print/firm-head';
import { deleteStockCountAction } from '../_stock/actions';
import { deleteStoreOutAction } from './actions';
import { MoEditor, type MoDraft } from './mo-editor';
import { MoKeys, MoTypeRadios, MoStoreFilter } from './mo-list-tools';

type SP = { t?: string; wh?: string; nov?: string; id?: string; view?: string; saved?: string };
const KINDS: MoutKind[] = ['sale', 'inv', 'ret', 'otp', 'pop'];

export default async function MIzlezPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const T: MoutKind = sp.t === 'count' ? 'pop' : sp.t === 'writeoff' ? 'otp' : KINDS.includes(sp.t as MoutKind) ? (sp.t as MoutKind) : 'sale';
  const { u, firm, year, L } = await stockPage('m_izlez');
  if (!firm || !L) return <NoFirm t="Излез од продавница" />;
  const stores = locOptions(L, 'store');
  if (!stores.length) {
    return (
      <>
        <Hd t="Излез од продавница" exp={false} />
        <div className="card empty">Немате регистрирано продавница. Додајте ја во <b>Шифрарник → Сите шифрарници → Продавници</b>.
          <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}><Link className="btn pri" href="/sifrarnik">Отвори шифрарник</Link></div></div>
      </>
    );
  }
  const write = canDo(u, 'moSave', firm.id);
  const W = sp.wh && stores.some((s) => s.id === sp.wh) ? sp.wh : '';
  const its = new Map((L.ctx.items ?? []).map((i) => [i.id, i]));
  const isCount = T === 'otp' || T === 'pop';
  const [counts, outs] = await Promise.all([
    isCount ? db().select().from(stockCounts).where(and(eq(stockCounts.firmId, firm.id), eq(stockCounts.kind, T === 'pop' ? 'count' : 'writeoff'), gte(stockCounts.date, `${year}-01-01`), lte(stockCounts.date, `${year}-12-31`))).orderBy(desc(stockCounts.date), desc(stockCounts.number)) : Promise.resolve([]),
    T === 'sale' || T === 'ret' ? db().select({ o: storeOuts, pn: partners.name }).from(storeOuts).leftJoin(partners, eq(partners.id, storeOuts.partnerId))
      .where(and(eq(storeOuts.firmId, firm.id), eq(storeOuts.kind, T), gte(storeOuts.date, `${year}-01-01`), lte(storeOuts.date, `${year}-12-31`))).orderBy(desc(storeOuts.date), desc(storeOuts.number)) : Promise.resolve([]),
  ]);
  type Doc = { id: string; number: string; date: string; wh: string; desc: string; lines: { itemId: string; qty?: number | null; price?: number | null; val?: number | null; sys?: number | null; cnt?: number | null; diff?: number | null; sp?: number | null }[]; note: string | null; partnerId?: string | null; ref?: string | null; account?: string | null; k1?: string; k2?: string | null };
  const docs: Doc[] = isCount
    ? counts.map((c) => ({ id: c.id, number: c.number, date: c.date, wh: c.locationId ?? 'main', desc: c.note ?? '', note: c.note, k1: c.shortageAccount, k2: c.surplusAccount,
      lines: c.lines.map((l) => {
        const it = its.get(l.itemId);
        return { ...l, val: T === 'otp' && it ? Math.round((l.qty ?? 0) * priceAt(L.ctx, it, c.locationId ?? 'main', c.date) * 100) / 100 : null };
      }) }))
    : outs.map(({ o, pn }) => ({ id: o.id, number: o.number, date: o.date, wh: o.locationId ?? 'main', desc: T === 'ret' ? pn ?? '' : o.note ?? '', lines: o.lines, note: o.note, partnerId: o.partnerId, ref: o.ref, account: o.account }));
  const list = docs.filter((x) => !W || x.wh === W);

  /* ---------- document print (legacy moPdfHTML) ---------- */
  const view = sp.view ? docs.find((x) => x.id === sp.view) : undefined;
  if (view) {
    const rows = view.lines.filter((l) => T !== 'pop' || l.diff);
    const tot = moTotal(T, view.lines);
    const title = (T === 'pop' ? 'ЗАПИСНИК ОД КОНТРОЛЕН ПОПИС' : T === 'otp' ? 'ЗАПИСНИК ЗА ОТПИС' : T === 'ret' ? 'ПОВРАТНИЦА' : 'ПРОДАЖБА / ПАРАГОН') + ' бр. ' + view.number;
    const sub = 'Објект: ' + L.locName(view.wh === 'main' ? null : view.wh) + ' · Датум: ' + dmy(view.date) + (T === 'ret' ? ' · Добавувач: ' + view.desc + (view.ref ? ' · Док. ' + view.ref : '') : '');
    return (
      <>
        <Hd t={MOUT[T].s + ' ' + view.number} exp={false}><Link className="btn" href={'/m_izlez?t=' + T}>← Назад</Link><PdfButton selector="#moDoc" title={title} /></Hd>
        <div id="moDoc"><div className="pdfdoc" style={{ background: '#fff', padding: 12 }}>
          <FirmHead firm={firm} title={title} sub={sub} />
          <table>
            <thead>{T === 'pop'
              ? <tr><th>Р.б.</th><th>Шифра</th><th>Артикл</th><th>ЕМ</th><th className="n">Состојба</th><th className="n">Пописано</th><th className="n">Разлика</th><th className="n">Прод. цена</th><th className="n">Вредност</th></tr>
              : <tr><th>Р.б.</th><th>Шифра</th><th>Артикл</th><th>ЕМ</th><th className="n">Количина</th><th className="n">Прод. цена</th><th className="n">Вредност</th></tr>}</thead>
            <tbody>{rows.map((l, i) => {
              const it = its.get(l.itemId);
              return T === 'pop'
                ? <tr key={i}><td>{i + 1}</td><td>{it?.code}</td><td>{it?.name}</td><td>{it?.unit}</td><td className="n">{fq(l.sys)}</td><td className="n">{fq(l.cnt)}</td><td className="n">{fq(l.diff)}</td><td className="n">{fmt(l.sp)}</td><td className="n">{fmt((l.diff ?? 0) * (l.sp ?? 0))}</td></tr>
                : <tr key={i}><td>{i + 1}</td><td>{it?.code}</td><td>{it?.name}</td><td>{it?.unit}</td><td className="n">{fq(l.qty)}</td><td className="n">{fmt(T === 'sale' ? l.price : (l.val ?? 0) / (l.qty || 1))}</td><td className="n">{fmt(l.val)}</td></tr>;
            })}</tbody>
            <tfoot><tr className="tot"><td colSpan={T === 'pop' ? 8 : 6}>Вкупно (по продажни цени со ДДВ)</td><td className="n">{fmt(tot)}</td></tr></tfoot>
          </table>
          {view.note && <p>{view.note}</p>}
          <div className="grid2" style={{ marginTop: 40 }}>
            <div>{T === 'pop' ? <>Пописна комисија:<br /><br />1. ____________________<br /><br />2. ____________________<br /><br />3. ____________________</> : 'Издал: ____________________'}</div>
            <div style={{ textAlign: 'right' }}>{T === 'ret' ? 'Примил: ____________________' : 'Одговорно лице: ____________________'}<br /><br />{firm.name}</div>
          </div>
        </div></div>
      </>
    );
  }

  /* ---------- editor ---------- */
  if (write && T !== 'inv' && (sp.nov !== undefined || sp.id)) {
    const e = sp.id ? docs.find((x) => x.id === sp.id) : undefined;
    const [bcs, P, chart] = await Promise.all([
      db().select({ itemId: itemBarcodes.itemId, barcode: itemBarcodes.barcode }).from(itemBarcodes).where(eq(itemBarcodes.firmId, firm.id)),
      T === 'ret' ? db().select({ id: partners.id, name: partners.name }).from(partners).where(eq(partners.firmId, firm.id)).orderBy(asc(partners.name)) : Promise.resolve([]),
      effectiveChart(db(), firm.id),
    ]);
    const bcOf = new Map<string, string[]>();
    for (const b of bcs) bcOf.set(b.itemId, [...(bcOf.get(b.itemId) ?? []), b.barcode]);
    const items = itemOptions(L).map((i) => ({ id: i.id, code: i.code, name: i.name, unit: i.unit, barcodes: bcOf.get(i.id) ?? [], rate: i.rate, avg: i.avg, have: i.have, sp: i.sp }));
    const kk = (re: RegExp) => chart.filter((a) => re.test(a.code)).map((a) => [a.code, a.name] as [string, string]);
    const today = todayIso();
    const initial: MoDraft = e
      ? { id: e.id, kind: T as MoDraft['kind'], number: e.number, date: e.date, wh: e.wh, partnerId: e.partnerId ?? '', ref: e.ref ?? '', konto: e.account ?? e.k1 ?? '', konto2: e.k2 ?? '7690', note: e.note ?? '',
        lines: e.lines.map((l) => (T === 'pop' ? { itemId: l.itemId, qty: '', cnt: String(l.cnt ?? '') } : { itemId: l.itemId, qty: String(l.qty ?? ''), price: String(l.price ?? '') })) }
      : { kind: T as MoDraft['kind'], number: '', date: today.startsWith(String(year)) ? today : `${year}-12-31`, wh: W || stores[0]!.id, partnerId: '', ref: '', konto: T === 'sale' ? '1009' : '4690', konto2: '7690', note: '', lines: [] };
    return <MoEditor initial={initial} items={items} locs={locOptions(L)} partners={P} k10={kk(/^10/)} k4={kk(/^4/)} k7={kk(/^7/)} />;
  }

  return (
    <>
      <MoKeys t={T} write={write} />
      <Hd t="Излез од продавница" sub="раздолжување на залихата во малопродажба">
        <Link className="btn" href="/kalkM">← Влезни калкулации</Link>
        {write && T !== 'inv' && <Link className="btn pri" href={`/m_izlez?t=${T}&nov${W ? '&wh=' + W : ''}`}>+ Нов документ (Ins)</Link>}
      </Hd>
      {sp.saved && <div className="callout good">{MOUT[T].s} {sp.saved} е зачуван(а) и залихата е ажурирана.</div>}
      <div className="cols" style={{ gridTemplateColumns: '260px 1fr', alignItems: 'start' }}>
        <div className="card">
          <MoTypeRadios t={T} wh={W} options={KINDS.map((k) => [k, MOUT[k].n])} />
          <MoStoreFilter t={T} wh={W} stores={stores.map((s) => [s.id, s.name])} />
          <p className="note">{MOUT[T].note}</p>
        </div>
        <div className="card">{T === 'inv'
          ? <div className="empty">Фактурите од продавница се во <b>Излезни фактури</b> (со објект = продавница).
            <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>{write && <Link className="btn pri" href="/izlez?nov=1">+ Нова фактура од продавница</Link>}<Link className="btn" href="/izlez">Листа на фактури</Link></div></div>
          : list.length ? (
            <div className="tw"><table>
              <thead><tr><th>Број</th><th>Датум</th><th>Продавница</th><th>{T === 'ret' ? 'Добавувач' : 'Опис'}</th><th className="n">Ставки</th><th className="n">{T === 'pop' ? 'Разлика (прод. вред.)' : 'Продажна вредност'}</th><th /></tr></thead>
              <tbody>{list.map((x) => (
                <tr key={x.id}><td><b>{x.number}</b></td><td>{dmy(x.date)}</td><td>{L.locName(x.wh === 'main' ? null : x.wh)}</td><td>{x.desc}</td>
                  <td className="n">{x.lines.filter((l) => T !== 'pop' || l.diff).length}</td><td className="n">{fmt(moTotal(T, x.lines))}</td>
                  <td><div className="row" style={{ flexWrap: 'nowrap' }}>
                    {write && <Link className="btn sm" href={`/m_izlez?t=${T}&id=${x.id}`}>Измени</Link>}
                    <Link className="btn sm" href={`/m_izlez?t=${T}&view=${x.id}`}>PDF</Link>
                    {write && <RowAction action={(isCount ? deleteStockCountAction : deleteStoreOutAction).bind(null, x.id)} label="🗑" title="Избриши" style={{ color: 'var(--bad)' }} confirm={`Да се избрише ${x.number}? Залихата и налогот се враќаат.`} />}
                  </div></td></tr>
              ))}</tbody>
            </table></div>
          ) : <div className="empty">Нема документи „{MOUT[T].s}“ за {year}.</div>}
        </div>
      </div>
    </>
  );
}
