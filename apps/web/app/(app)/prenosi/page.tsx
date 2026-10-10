/**
 * Пренос во продавница / Пренос од магацин — legacy `VIEWS.prenosi` 5556 → 17419, `prTable` 5550, `ACT.prSave` 17396,
 * `PR_ACT` (`prFromCalc` → `?calc=`, `prMargin`, `prKeep`, `prAllStock`, `prPdf` / `prPlt` → `/print/prenos/<id>`),
 * `prnLines` 17414 (posting through `transferLines`). Header links „← Влезни калкулации“ / „Малопродажба →“.
 */
import Link from 'next/link';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { nextYearNumber, transferBookTotals } from '@wise/core';
import { transferFromCalc } from '@wise/core/parity-stock';
import { partners, purchases, purchaseStockLines, transfers } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { itemOptions, locOptions, stockPage, todayIso } from '@/lib/stock';
import { dmy, fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { deleteTransferAction } from '../_stock/actions';
import { TransferEditor, type CalcOpt } from '../_stock/editors';

type SP = { nov?: string; id?: string; view?: string; calc?: string };

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

  if (!stores.length) {
    return (
      <>
        <Hd t="Пренос во продавница" exp={false} />
        <div className="card empty">За пренос прво додајте продавница во <b>Шифрарник → Сите шифрарници → Продавници</b>.<div className="row" style={{ justifyContent: 'center', marginTop: 10 }}><Link className="btn pri" href="/cb_store">Отвори шифрарник</Link></div></div>
      </>
    );
  }

  const edit = sp.id ? list.find((d) => d.id === sp.id) : undefined;
  const showEditor = write && (sp.nov !== undefined || !!edit || !!sp.calc);
  const today = todayIso();
  let editor = null;
  if (showEditor) {
    // calculations of the year in warehouses (legacy `calcs` select: last 60, newest first)
    const P = await db().select({ p: purchases, pn: partners.name }).from(purchases).leftJoin(partners, eq(partners.id, purchases.partnerId))
      .where(and(eq(purchases.firmId, firm.id), eq(purchases.ptype, 'stock'), gte(purchases.date, `${year}-01-01`), lte(purchases.date, `${year}-12-31`)))
      .orderBy(desc(purchases.date)).limit(200);
    const kindOf = (id: string | null) => (!id ? 'warehouse' : L.locations.find((l) => l.id === id)?.kind ?? 'warehouse');
    const PW = P.filter(({ p }) => kindOf(p.warehouseId) === 'warehouse').slice(0, 60);
    const ST = PW.length ? await db().select().from(purchaseStockLines).where(inArray(purchaseStockLines.purchaseId, PW.map(({ p }) => p.id))).orderBy(asc(purchaseStockLines.lineNo)) : [];
    const calcs: CalcOpt[] = PW.map(({ p, pn }) => ({
      id: p.id, wh: p.warehouseId ?? 'main', date: p.date,
      label: `${p.calcNo ?? ''} · ${dmy(p.date)} · ${pn ?? p.supplierName ?? ''} · ф-ра ${p.number ?? ''}`,
      lines: ST.filter((s) => s.purchaseId === p.id).map((s) => ({ item: s.itemId, qty: Number(s.qty), sp: s.sp ?? '' })),
    }));
    const dflt = today.startsWith(String(year)) ? today : `${year}-12-31`;
    let initial;
    let info = '';
    if (edit) {
      initial = { id: edit.id, number: edit.number, date: edit.date, from: edit.fromLocationId ?? 'main', to: edit.toLocationId ?? 'main', note: edit.note ?? '', lines: edit.lines.map((l) => ({ itemId: l.itemId, qty: String(l.qty), sp: l.sp != null ? String(l.sp) : '' })) };
    } else {
      // one or more calculations (legacy `prFromCalc` / `ksPren`): same warehouse, newest date
      const cs = (sp.calc ?? '').split(',').map((id) => calcs.find((x) => x.id === id)).filter((x): x is CalcOpt => !!x);
      const c = cs[0];
      const from = c?.wh ?? 'main';
      const to = stores[0]?.id ?? '';
      const last = cs.map((x) => x.date).sort().pop();
      // legacy prFromCalc: date = today when the calculation is from this year and older, else its date
      const date = last ? (last.slice(0, 4) === today.slice(0, 4) && last < today ? today : last) : dflt;
      const lines = transferFromCalc(L.ctx, cs.filter((x) => x.wh === from).flatMap((x) => x.lines), from, to, date).map((l) => ({ itemId: l.itemId, qty: String(l.qty), sp: l.sp != null ? String(l.sp) : '' }));
      if (c && !lines.some((l) => Number(l.qty) > 0)) info = `Нема залиха од оваа калкулација во ${L.locName(from)}. Стоката е веќе пренесена или издадена/продадена.`;
      initial = { date, from, to, note: cs.length ? 'Од калкулација ' + cs.map((x) => x.label.split(' · ')[0]).join(', ') : '', lines };
    }
    const nextNo = nextYearNumber(list.map((x) => ({ number: x.number, date: x.date })), (initial.date ?? dflt).slice(0, 4), 4);
    const round = String((L.firm.settings as Record<string, unknown> | null)?.mgRound ?? '1');
    editor = (
      <>
        {info && <div className="callout warn">{info}</div>}
        <TransferEditor items={itemOptions(L)} locs={locs} calcs={calcs} nextNo={nextNo} round={round} initial={initial} />
      </>
    );
  }

  return (
    <>
      <Hd t="Пренос од магацин во продавница" sub="преносници · влез во малопродажба">
        <Link className="btn" href="/kalkG">← Влезни калкулации</Link>
        <Link className="btn" href="/kalkM">Малопродажба →</Link>
        {write && <Link className="btn pri" href="/prenosi?nov">+ Нов пренос</Link>}
      </Hd>
      {editor ?? (
        <div className="callout">Стоката прво се прима во <b>магацин</b> (Големопродажба → Влез). Со преносница се префрла во <b>продавница</b> по набавна цена од магацинот, а за продавницата се внесува малопродажна цена со ДДВ. Се печатат Преносница и ПЛТ за продавницата; магацинот се раздолжува, продавницата се задолжува (Д 6630 / П 6600 / П 6694 / П 6640).</div>
      )}
      {list.length ? (
        <div className="tw"><table>
          <thead><tr><th>Датум</th><th>Бр.</th><th>Од магацин</th><th>Во продавница</th><th className="n">Ставки</th><th className="n">Набавна вредност</th><th className="n">Разлика</th><th className="n">Продажна со ДДВ</th><th className="noprint" /></tr></thead>
          <tbody>
            {list.map((d) => {
              const t = tot(d);
              return (
                <tr key={d.id}>
                  <td>{dmy(d.date)}</td><td><b>{d.number}</b></td><td>{L.locName(d.fromLocationId)}</td><td>{L.locName(d.toLocationId)}</td>
                  <td className="n">{d.lines.length}</td><td className="n">{fmt(t.nab)}</td><td className="n">{fmt(t.mg)}</td><td className="n">{fmt(t.sp)}</td>
                  <td className="row noprint" style={{ gap: 4, flexWrap: 'nowrap' }}>
                    <Link className="btn sm" href={`/print/prenos/${d.id}`} target="_blank">Преносница</Link>
                    <Link className="btn sm" href={`/print/prenos/${d.id}?t=plt`} target="_blank">ПЛТ</Link>
                    {write && <Link className="btn sm" href={`/prenosi?id=${d.id}`}>Измени</Link>}
                    {write && <RowAction action={deleteTransferAction.bind(null, d.id)} label="🗑" title="Избриши" confirm={`Да се избрише преносницата ${d.number}? Стоката се враќа во ${L.locName(d.fromLocationId)}.`} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr><td colSpan={5}>Вкупно</td><td className="n">{fmt(list.reduce((a, d) => a + tot(d).nab, 0))}</td><td className="n">{fmt(list.reduce((a, d) => a + tot(d).mg, 0))}</td><td className="n">{fmt(list.reduce((a, d) => a + tot(d).sp, 0))}</td><td className="noprint" /></tr></tfoot>
        </table></div>
      ) : <div className="card empty">Нема преноси во {year}. Кликнете „+ Нов пренос“ или во листата Влез (магацин) кликнете „→ Продавница“ кај калкулацијата.</div>}
    </>
  );
}
