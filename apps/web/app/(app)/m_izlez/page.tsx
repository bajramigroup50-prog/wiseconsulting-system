/**
 * Излез од продавница — legacy `VIEWS.m_izlez` 5706 (`moEditor`, `moSaveDoc` 5772, `moPdfHTML`): here the stock
 * count (контролен попис: кусок / вишок) and write-off (отпис) kinds. Retail sales go through Каса / фискални
 * извештаи; supplier returns through Phase 3 (повратници до добавувачи).
 */
import Link from 'next/link';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { effectiveChart, stockCounts } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { itemOptions, locOptions, stockPage, todayIso } from '@/lib/stock';
import { dmy, fmt, fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { PrintButton } from '@/components/stock-ui';
import { deleteStockCountAction } from '../_stock/actions';
import { CountEditor } from '../_stock/editors';

type SP = { t?: string; nov?: string; id?: string; view?: string };
const T = { count: 'Контролен попис (кусок / вишок)', writeoff: 'Отпис (кало, крш, расипување)' } as const;

export default async function MIzlezPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const kind = sp.t === 'writeoff' ? 'writeoff' : 'count';
  const { u, firm, year, L } = await stockPage('m_izlez');
  if (!firm || !L) return <NoFirm t="Излез" />;
  const write = canDo(u, 'moSave', firm.id);
  const list = await db().select().from(stockCounts)
    .where(and(eq(stockCounts.firmId, firm.id), eq(stockCounts.kind, kind), gte(stockCounts.date, `${year}-01-01`), lte(stockCounts.date, `${year}-12-31`)))
    .orderBy(desc(stockCounts.date), desc(stockCounts.number));
  const its = new Map((L.ctx.items ?? []).map((i) => [i.id, i]));
  const value = (d: (typeof list)[number]) => d.lines.reduce((s, l) => s + (kind === 'count' ? (l.diff ?? 0) * (l.sp ?? 0) : 0), 0);

  const view = sp.view ? list.find((d) => d.id === sp.view) : undefined;
  if (view) {
    return (
      <>
        <Hd t={(kind === 'count' ? 'Попис ' : 'Отпис ') + view.number}><Link className="btn" href={'/m_izlez?t=' + kind}>← Назад</Link><PrintButton /></Hd>
        <div className="printarea pdfdoc" style={{ background: '#fff', padding: 12 }}>
          <div className="ph"><div><div className="pt">{kind === 'count' ? 'ЗАПИСНИК ОД КОНТРОЛЕН ПОПИС' : 'ЗАПИСНИК ЗА ОТПИС'} бр. {view.number}</div><div className="ps">{firm.name}</div></div>
            <div className="pm">Датум: {dmy(view.date)}<br />Објект: {L.locName(view.locationId)}</div></div>
          <table>
            <thead>{kind === 'count'
              ? <tr><th>Р.б.</th><th>Шифра</th><th>Назив</th><th>Ед.</th><th className="n">Состојба</th><th className="n">Попис</th><th className="n">Разлика</th><th className="n">МПЦ</th><th className="n">Вредност</th></tr>
              : <tr><th>Р.б.</th><th>Шифра</th><th>Назив</th><th>Ед.</th><th className="n">Количина</th></tr>}</thead>
            <tbody>{view.lines.map((l, i) => {
              const it = its.get(l.itemId);
              return kind === 'count'
                ? <tr key={i}><td>{i + 1}</td><td>{it?.code}</td><td>{it?.name}</td><td>{it?.unit}</td><td className="n">{fq(l.sys)}</td><td className="n">{fq(l.cnt)}</td><td className="n">{fq(l.diff)}</td><td className="n">{fmt(l.sp)}</td><td className="n">{fmt((l.diff ?? 0) * (l.sp ?? 0))}</td></tr>
                : <tr key={i}><td>{i + 1}</td><td>{it?.code}</td><td>{it?.name}</td><td>{it?.unit}</td><td className="n">{fq(l.qty)}</td></tr>;
            })}</tbody>
          </table>
          {view.note && <p>{view.note}</p>}
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 30 }}><span>Комисија: ____________</span><span>Одговорно лице: ____________</span></div>
        </div>
      </>
    );
  }

  const edit = sp.id ? list.find((d) => d.id === sp.id) : undefined;
  const showEditor = write && (sp.nov !== undefined || !!edit);
  const locs = locOptions(L);
  const today = todayIso();
  const chart = showEditor ? (await effectiveChart(db(), firm.id)).filter((a) => /^[47]/.test(a.code)).map((a) => [a.code, a.name] as [string, string]) : [];
  return (
    <>
      <Hd t="Излез (попис, отпис)">{write && <Link className="btn pri" href={`/m_izlez?t=${kind}&nov`}>+ Нов {kind === 'count' ? 'попис' : 'отпис'}</Link>}</Hd>
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>
        {(['count', 'writeoff'] as const).map((k) => <Link key={k} className={`btn sm ${k === kind ? 'pri' : ''}`} href={'/m_izlez?t=' + k}>{T[k]}</Link>)}
      </div>
      {showEditor && (
        <CountEditor items={itemOptions(L)} locs={locs} accounts={chart}
          initial={edit
            ? { id: edit.id, number: edit.number, kind, date: edit.date, wh: edit.locationId ?? 'main', note: edit.note ?? '', shortageAccount: edit.shortageAccount, surplusAccount: edit.surplusAccount ?? '7690',
              lines: edit.lines.map((l) => ({ itemId: l.itemId, v: String(kind === 'count' ? l.cnt ?? '' : l.qty ?? '') })) }
            : { kind, date: today.startsWith(String(year)) ? today : `${year}-12-31`, wh: locs.find((l) => l.kind === 'store')?.id ?? 'main', note: '', shortageAccount: '4690', surplusAccount: '7690', lines: [] }} />
      )}
      {list.length ? (
        <div className="tw"><table>
          <thead><tr><th>Датум</th><th>Бр.</th><th>Објект</th><th className="n">Ставки</th>{kind === 'count' && <th className="n">Разлика по МПЦ</th>}<th>Конта</th><th /></tr></thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.id}>
                <td>{dmy(d.date)}</td><td><b>{d.number}</b></td><td>{L.locName(d.locationId)}</td><td className="n">{d.lines.length}</td>
                {kind === 'count' && <td className="n">{fmt(value(d))}</td>}
                <td className="mini">{d.shortageAccount}{d.surplusAccount ? ' / ' + d.surplusAccount : ''}</td>
                <td className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                  <Link className="btn sm" href={`/m_izlez?t=${kind}&view=${d.id}`}>Записник</Link>
                  {write && <Link className="btn sm" href={`/m_izlez?t=${kind}&id=${d.id}`}>Измени</Link>}
                  {write && <RowAction action={deleteStockCountAction.bind(null, d.id)} label="🗑" title="Избриши" confirm={`Да се избрише ${d.number}? Залихата и налогот се враќаат.`} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : <div className="card empty">Нема документи во {year}.</div>}
    </>
  );
}
