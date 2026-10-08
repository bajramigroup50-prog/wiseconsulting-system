/**
 * Нивелација — legacy `VIEWS.nivel` 5137 → 17433, `ACT.saveNivel` 13211 (+ correction 17188), `nivelPdf`, ledger
 * posting 3461 (`levellingEntries`). FIX (LEGACY-MAP §7.4 item 9): numbers are max + 1 per year (legacy count + 1
 * repeated numbers after a delete); quantities come from the corrected `stockAt` (legacy: always 0).
 */
import Link from 'next/link';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { levellingDiff, retailOn } from '@wise/core';
import { journals, levellingDocs } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { itemOptions, locOptions, stockPage, todayIso } from '@/lib/stock';
import { dmy, fmt, fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { PrintButton } from '@/components/stock-ui';
import { deleteLevellingAction } from '../_stock/actions';
import { LevellingEditor } from '../_stock/editors';

type SP = { nov?: string; id?: string; view?: string };

export default async function NivelPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year, L } = await stockPage('nivel');
  if (!firm || !L) return <NoFirm t="Нивелација" />;
  const write = canDo(u, 'saveNivel', firm.id);
  const list = await db().select().from(levellingDocs)
    .where(and(eq(levellingDocs.firmId, firm.id), gte(levellingDocs.date, `${year}-01-01`), lte(levellingDocs.date, `${year}-12-31`)))
    .orderBy(desc(levellingDocs.date), desc(levellingDocs.number));
  const posted = new Set(list.length ? (await db().select({ s: journals.sourceId }).from(journals)
    .where(and(eq(journals.firmId, firm.id), eq(journals.sourceType, 'levelling'), inArray(journals.sourceId, list.map((d) => d.id))))).map((r) => r.s) : []);
  const its = new Map((L.ctx.items ?? []).map((i) => [i.id, i]));
  const diffOf = (d: (typeof list)[number]) => levellingDiff(d.lines.map((l) => ({ item: l.itemId, qty: l.qty, old: l.old, new: l.new })));

  const view = sp.view ? list.find((d) => d.id === sp.view) : undefined;
  if (view) {
    return (
      <>
        <Hd t={'Нивелација ' + view.number}><Link className="btn" href="/nivel">← Назад</Link><PrintButton /></Hd>
        <div className="printarea pdfdoc" style={{ background: '#fff', padding: 12 }}>
          <div className="ph"><div><div className="pt">ИЗВЕШТАЈ ЗА НИВЕЛАЦИЈА НА ЦЕНИ бр. {view.number}</div><div className="ps">{firm.name}</div></div>
            <div className="pm">Датум: {dmy(view.date)}<br />Објект: {L.locName(view.locationId)}</div></div>
          <table>
            <thead><tr><th>Р.б.</th><th>Шифра</th><th>Назив</th><th>Ед.</th><th className="n">Количина</th><th className="n">Стара цена</th><th className="n">Нова цена</th><th className="n">Разлика по ед.</th><th className="n">Вкупна разлика</th></tr></thead>
            <tbody>{view.lines.map((l, i) => {
              const it = its.get(l.itemId);
              return <tr key={i}><td>{i + 1}</td><td>{it?.code}</td><td>{it?.name}</td><td>{it?.unit}</td><td className="n">{fq(l.qty)}</td><td className="n">{fmt(l.old)}</td><td className="n">{fmt(l.new)}</td><td className="n">{fmt(l.new - l.old)}</td><td className="n">{fmt(l.qty * (l.new - l.old))}</td></tr>;
            })}</tbody>
            <tfoot><tr><td colSpan={8}>Вкупно</td><td className="n">{fmt(diffOf(view))}</td></tr></tfoot>
          </table>
          {view.note && <p>{view.note}</p>}
        </div>
      </>
    );
  }

  const edit = sp.id ? list.find((d) => d.id === sp.id) : undefined;
  const locs = locOptions(L);
  const stores = locs.filter((l) => l.kind === 'store');
  const showEditor = write && (sp.nov !== undefined || !!edit);
  const today = todayIso();
  return (
    <>
      <Hd t="Нивелација" sub="промена на малопродажни цени">{write && <Link className="btn pri" href="/nivel?nov">+ Нова нивелација</Link>}</Hd>
      {showEditor && (
        <LevellingEditor items={itemOptions(L)} locs={locs}
          initial={edit
            ? { id: edit.id, number: edit.number, date: edit.date, wh: edit.locationId ?? 'main', note: edit.note ?? '', promoTo: '', prices: Object.fromEntries(edit.lines.map((l) => [l.itemId, String(l.new)])) }
            : { date: today.startsWith(String(year)) ? today : `${year}-12-31`, wh: stores[0]?.id ?? 'main', note: '', promoTo: '', prices: {} }} />
      )}
      {!showEditor && <div className="callout">Нивелацијата се книжи само во објект што се води по продажни цени (шема: малопродажба по продажни цени): Д 6630 / П 6694 / П 6640 за вкупната разлика. Количината е залихата на датумот на нивелацијата.</div>}
      {list.length ? (
        <div className="tw"><table>
          <thead><tr><th>Датум</th><th>Бр.</th><th>Објект</th><th className="n">Ставки</th><th className="n">Разлика</th><th>Белешка</th><th>Книжење</th><th /></tr></thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.id}>
                <td>{dmy(d.date)}</td><td><b>{d.number}</b></td><td>{L.locName(d.locationId)}</td><td className="n">{d.lines.length}</td><td className="n">{fmt(diffOf(d))}</td>
                <td className="mini">{d.note}{d.promoBackOf ? ` (враќање по ${d.promoBackOf})` : ''}</td>
                <td>{posted.has(d.id) ? <span className="pill good">налог</span> : retailOn(L.ctx, d.locationId ?? 'main') ? <span className="pill warn">без износ</span> : <span className="pill">по набавни цени</span>}</td>
                <td className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                  <Link className="btn sm" href={`/nivel?view=${d.id}`}>Извештај</Link>
                  {write && <Link className="btn sm" href={`/nivel?id=${d.id}`}>Корекција</Link>}
                  {write && <RowAction action={deleteLevellingAction.bind(null, d.id)} label="🗑" title="Избриши" confirm={`Да се избрише нивелацијата ${d.number}?`} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : <div className="card empty">Нема нивелации во {year}.</div>}
    </>
  );
}
