/**
 * Пренос во продавница / Пренос од магацин — legacy `VIEWS.prenosi` 5556 → 17419, `prTable` 5550, `ACT.prSave` 17396,
 * `prPdf` (преносница), `prnLines` 17414 (posting through `transferLines`).
 */
import Link from 'next/link';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { transferBookTotals } from '@wise/core';
import { transfers } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { itemOptions, locOptions, stockPage, todayIso } from '@/lib/stock';
import { dmy, fmt, fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { PrintButton } from '@/components/stock-ui';
import { deleteTransferAction } from '../_stock/actions';
import { TransferEditor } from '../_stock/editors';

type SP = { nov?: string; id?: string; view?: string };

export default async function PrenosiPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year, L } = await stockPage('prenosi');
  if (!firm || !L) return <NoFirm t="Пренос во продавница" />;
  const write = canDo(u, 'prSave', firm.id);
  const locs = locOptions(L);
  const stores = locs.filter((l) => l.kind === 'store');
  const list = await db().select().from(transfers)
    .where(and(eq(transfers.firmId, firm.id), gte(transfers.date, `${year}-01-01`), lte(transfers.date, `${year}-12-31`)))
    .orderBy(desc(transfers.date), desc(transfers.number));
  const tot = (d: (typeof list)[number]) => {
    const t = transferBookTotals(L.ctx, { id: d.id, number: d.number, date: d.date, from: d.fromLocationId ?? 'main', to: d.toLocationId ?? 'main', lines: d.lines.map((l) => ({ item: l.itemId, qty: l.qty, nabU: l.nabU ?? 0, sp: l.sp ?? null })) });
    return { ...t, mg: t.marg };
  };

  const view = sp.view ? list.find((d) => d.id === sp.view) : undefined;
  if (view) {
    const its = new Map((L.ctx.items ?? []).map((i) => [i.id, i]));
    const t = tot(view);
    return (
      <>
        <Hd t={'Преносница ' + view.number}><Link className="btn" href="/prenosi">← Назад</Link><PrintButton /></Hd>
        <div className="printarea pdfdoc" style={{ background: '#fff', padding: 12 }}>
          <div className="ph"><div><div className="pt">ПРЕНОСНИЦА бр. {view.number}</div><div className="ps">{firm.name}</div></div>
            <div className="pm">Датум: {dmy(view.date)}<br />Од: {L.locName(view.fromLocationId)}<br />Во: {L.locName(view.toLocationId)}</div></div>
          <table>
            <thead><tr><th>Р.б.</th><th>Шифра</th><th>Назив</th><th>Ед.</th><th className="n">Количина</th><th className="n">Набавна цена</th><th className="n">Набавна вредност</th><th className="n">МПЦ со ДДВ</th><th className="n">Продажна вредност</th></tr></thead>
            <tbody>{view.lines.map((l, i) => {
              const it = its.get(l.itemId);
              return <tr key={i}><td>{i + 1}</td><td>{it?.code}</td><td>{it?.name}</td><td>{it?.unit}</td><td className="n">{fq(l.qty)}</td><td className="n">{fmt(l.nabU)}</td><td className="n">{fmt(l.qty * (l.nabU ?? 0))}</td><td className="n">{fmt(l.sp)}</td><td className="n">{fmt(l.qty * (l.sp ?? 0))}</td></tr>;
            })}</tbody>
            <tfoot><tr><td colSpan={6}>Вкупно</td><td className="n">{fmt(t.nab)}</td><td /><td className="n">{fmt(t.sp)}</td></tr></tfoot>
          </table>
          <p className="mini">Разлика во цена (без ДДВ): {fmt(t.mg)}</p>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 30 }}><span>Издал: ____________</span><span>Примил: ____________</span></div>
        </div>
      </>
    );
  }

  const edit = sp.id ? list.find((d) => d.id === sp.id) : undefined;
  const showEditor = write && (sp.nov !== undefined || !!edit);
  if (!stores.length && !edit) {
    return (
      <>
        <Hd t="Пренос во продавница" />
        <div className="card empty">За пренос прво додајте продавница во <b>Шифрарник → Сите шифрарници → Продавници</b>.</div>
      </>
    );
  }
  return (
    <>
      <Hd t="Пренос од магацин во продавница" sub="преносници · влез во малопродажба">
        {write && <Link className="btn pri" href="/prenosi?nov">+ Нов пренос</Link>}
      </Hd>
      {showEditor ? (
        <TransferEditor
          items={itemOptions(L)} locs={locs}
          initial={edit
            ? { id: edit.id, number: edit.number, date: edit.date, from: edit.fromLocationId ?? 'main', to: edit.toLocationId ?? 'main', note: edit.note ?? '', lines: edit.lines.map((l) => ({ itemId: l.itemId, qty: String(l.qty), sp: l.sp != null ? String(l.sp) : '' })) }
            : { date: todayIso().startsWith(String(year)) ? todayIso() : `${year}-12-31`, from: 'main', to: stores[0]?.id ?? '', note: '', lines: [] }}
        />
      ) : (
        <div className="callout">Стоката прво се прима во <b>магацин</b>. Со преносница се префрла во <b>продавница</b> по набавна цена од магацинот, а за продавницата се внесува малопродажна цена со ДДВ. Магацинот се раздолжува, продавницата се задолжува; кога продавницата се води по продажни цени, се книжи Д 6630 / П 6600 / П 6694 / П 6640.</div>
      )}
      {list.length ? (
        <div className="tw"><table>
          <thead><tr><th>Датум</th><th>Бр.</th><th>Од објект</th><th>Во објект</th><th className="n">Ставки</th><th className="n">Набавна вредност</th><th className="n">Разлика</th><th className="n">Продажна со ДДВ</th><th /></tr></thead>
          <tbody>
            {list.map((d) => {
              const t = tot(d);
              return (
                <tr key={d.id}>
                  <td>{dmy(d.date)}</td><td><b>{d.number}</b></td><td>{L.locName(d.fromLocationId)}</td><td>{L.locName(d.toLocationId)}</td>
                  <td className="n">{d.lines.length}</td><td className="n">{fmt(t.nab)}</td><td className="n">{fmt(t.mg)}</td><td className="n">{fmt(t.sp)}</td>
                  <td className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                    <Link className="btn sm" href={`/prenosi?view=${d.id}`}>Преносница</Link>
                    {write && <Link className="btn sm" href={`/prenosi?id=${d.id}`}>Измени</Link>}
                    {write && <RowAction action={deleteTransferAction.bind(null, d.id)} label="🗑" title="Избриши" confirm={`Да се избрише преносницата ${d.number}? Залихата и налогот се враќаат.`} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      ) : <div className="card empty">Нема преноси во {year}.</div>}
    </>
  );
}
