/**
 * Legacy `VIEWS.hotelKniga` 9620 → 11809 — книга на гости, странци (пријава), такса за престој, зафатеност и приход
 * (ADR, RevPAR) and the ДЗС tab (доаѓања и ноќевања на туристи по земја, `htStat`); PDF of the shown table
 * (`htKPdf`, landscape) and the Excel export of the dig bar.
 */
import Link from 'next/link';
import { and, asc, eq, sql } from 'drizzle-orm';
import { hotelDzsStat, hotelGuestRows, hotelOccupancy, hotelTaxReport, nationalityName } from '@wise/core/industry';
import { firmHotelConfig, hotelReservations, hotelRooms } from '@wise/db';
import { inYearOr } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { Hd } from '@/components/hd';
import { ExportXlsx, ListPdf, type Cell } from '@/components/list-tools';

const TABS = [['book', '📒 Книга на гости'], ['for', '🛂 Странци (пријава)'], ['tax', '🏛 Такса за престој'], ['izv', '📈 Зафатеност и приход'], ['dzs', '📊 ДЗС – туристи по земја']] as const;
const PDF_T: Record<string, string> = { book: 'КНИГА НА ГОСТИ', for: 'СТРАНСКИ ГОСТИ – ПРИЈАВА', tax: 'ТАКСА ЗА ПРИВРЕМЕН ПРЕСТОЈ', izv: 'ЗАФАТЕНОСТ И ПРИХОД', dzs: 'ДОАЃАЊА И НОЌЕВАЊА НА ТУРИСТИ ПО ЗЕМЈА' };
const docTxt = (doc?: string, no?: string) => (doc === 'pas' ? 'пасош ' : doc === 'lk' ? 'л.к. ' : '') + (no ?? '');

export default async function HotelKniga({ searchParams }: { searchParams: Promise<{ t?: string; a?: string; b?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('hotelKniga', 'Хотел – книга на гости');
  if (g.blocked) return g.blocked;
  const T = TABS.some((x) => x[0] === sp.t) ? sp.t! : 'book';
  const a = inYearOr(sp.a, g.year, `${g.year}-01-01`), b = inYearOr(sp.b, g.year, `${g.year}-12-31`);
  const H = firmHotelConfig(g.firm);
  const rooms = await db().select().from(hotelRooms).where(eq(hotelRooms.firmId, g.firm.id));
  const R = await db().select().from(hotelReservations).where(and(eq(hotelReservations.firmId, g.firm.id), sql`${hotelReservations.from} <= ${b} and ${hotelReservations.to} >= ${a}`)).orderBy(asc(hotelReservations.from));
  const stays = R.map((r) => ({ ...r, room: r.roomId, roomNo: rooms.find((y) => y.id === r.roomId)?.no ?? '', price: Number(r.price), advance: Number(r.advance ?? 0) }));
  const q = (o: Record<string, string>) => '/hotelKniga?' + new URLSearchParams({ t: T, a, b, ...o }).toString();
  let body: React.ReactNode;
  let xl: Cell[][] = [];
  if (T === 'book') {
    const L = hotelGuestRows(stays, a, b);
    xl = [['Р.бр', 'Име и презиме', 'Датум на раѓање', 'Пол', 'Државјанство', 'Документ', 'Доаѓање', 'Заминување', 'Соба'], ...L.map((y, i) => [i + 1, y.g.name, dmy(y.g.birth), y.g.sex ?? '', nationalityName(y.g.nat), docTxt(y.g.doc, y.g.docNo), dmy(y.r.from), dmy(y.r.to), y.room])];
    body = <div className="tw" id="hk_tw"><table className="dense"><thead><tr>{xl[0]!.map((h) => <th key={String(h)}>{h}</th>)}</tr></thead>
      <tbody>{xl.slice(1).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
        {!L.length && <tr><td colSpan={9} className="note">Нема пријавени гости во периодот.</td></tr>}</tbody></table></div>;
  } else if (T === 'for') {
    const L = hotelGuestRows(stays, a, b).filter((y) => y.g.nat && y.g.nat !== 'MK');
    xl = [['Име и презиме', 'Државјанство', 'Датум на раѓање', 'Пасош / документ', 'Доаѓање', 'Заминување', 'Соба', 'Пријава'], ...L.map((y) => [y.g.name, nationalityName(y.g.nat), dmy(y.g.birth), y.g.docNo ?? '', dmy(y.r.from), dmy(y.r.to), y.room, y.g.police ? `пријавен ${dmy(y.g.police)}` : 'НЕ Е ПРИЈАВЕН'])];
    body = <><p className="note">Странските гости се пријавуваат во полиција (МВР) во рок од 24 часа од доаѓањето. Означете „пријавен“ во резервацијата откако ќе ги пријавите.</p>
      <div className="tw" id="hk_tw"><table className="dense"><thead><tr>{xl[0]!.map((h) => <th key={String(h)}>{h}</th>)}</tr></thead>
        <tbody>{L.map((y, i) => <tr key={i}><td><Link href={`/hotel?id=${y.r.id}`}>{y.g.name}</Link></td><td>{nationalityName(y.g.nat)}</td><td>{dmy(y.g.birth)}</td><td>{y.g.docNo}</td><td>{dmy(y.r.from)}</td><td>{dmy(y.r.to)}</td><td>{y.room}</td>
          <td>{y.g.police ? <span className="pill good">пријавен {dmy(y.g.police)}</span> : <span className="pill bad">НЕ Е ПРИЈАВЕН</span>}</td></tr>)}
          {!L.length && <tr><td colSpan={8} className="note">Нема странски гости.</td></tr>}</tbody></table></div></>;
  } else if (T === 'tax') {
    const L = hotelTaxReport(stays, a, b, H);
    const s = (k: 'n' | 'per' | 'free' | 'units' | 'amt') => L.reduce((x, o) => x + o[k], 0);
    xl = [['Месец', 'Ноќевања (соба-ноќи)', 'Ноќевања (лица)', 'Ослободени', 'Оданочиви единици', 'Такса (ден.)'], ...L.map((o) => [`${o.mo.slice(5)}/${o.mo.slice(0, 4)}`, o.n, o.per, o.free, o.units, o.amt]), ['Вкупно', s('n'), s('per'), s('free'), s('units'), Math.round(s('amt') * 100) / 100]];
    body = <><div className="tw" id="hk_tw"><table className="dense"><thead><tr><th>Месец</th><th className="n">Ноќевања (соба-ноќи)</th><th className="n">Ноќевања (лица)</th><th className="n">Ослободени</th><th className="n">Оданочиви единици</th><th className="n">Такса (ден.)</th></tr></thead>
      <tbody>{L.map((o) => <tr key={o.mo}><td>{o.mo.slice(5)}/{o.mo.slice(0, 4)}</td><td className="n">{o.n}</td><td className="n">{o.per}</td><td className="n">{o.free}</td><td className="n">{o.units}</td><td className="n"><b>{fmt(o.amt)}</b></td></tr>)}
        <tr><td><b>Вкупно</b></td><td className="n">{s('n')}</td><td className="n">{s('per')}</td><td className="n">{s('free')}</td><td className="n">{s('units')}</td><td className="n"><b>{fmt(s('amt'))}</b></td></tr></tbody></table></div>
      <p className="note">Износ по лице/ноќ: {fmt(H.tax)} ден. Таксата се уплатува на сметката на општината според нејзината одлука (рок и образец – проверете во општината).</p></>;
  } else if (T === 'izv') {
    const L = hotelOccupancy(stays, rooms.filter((r) => r.active).length, a, b, H);
    xl = [['Месец', 'Продадени соба-ноќи', 'Зафатеност %', 'Приход од ноќевања (без ДДВ)', 'ADR (просечна цена)', 'RevPAR'], ...L.map((o) => [`${o.mo.slice(5)}/${o.mo.slice(0, 4)}`, o.n, o.occ, o.rev, o.adr, o.revpar])];
    body = <><div className="tw" id="hk_tw"><table className="dense"><thead><tr><th>Месец</th><th className="n">Продадени соба-ноќи</th><th className="n">Зафатеност</th><th className="n">Приход од ноќевања (без ДДВ)</th><th className="n">ADR (просечна цена)</th><th className="n">RevPAR</th></tr></thead>
      <tbody>{L.map((o) => <tr key={o.mo}><td>{o.mo.slice(5)}/{o.mo.slice(0, 4)}</td><td className="n">{o.n}</td><td className="n">{o.occ != null ? o.occ + '%' : '—'}</td><td className="n">{fmt(o.rev)}</td><td className="n">{o.adr != null ? fmt(o.adr) : ''}</td><td className="n">{o.revpar != null ? fmt(o.revpar) : ''}</td></tr>)}
        {!L.length && <tr><td colSpan={6} className="note">Нема податоци.</td></tr>}</tbody></table></div>
      <p className="note">Вклучени се и потврдените резервации за идните денови (прогноза). ADR = приход / продадени ноќи; RevPAR = приход / сите расположиви соба-ноќи.</p></>;
  } else {
    const S = hotelDzsStat(stays, a, b);
    xl = [['Земја на постојано живеење / државјанство', 'Доаѓања (туристи)', 'Ноќевања', 'Просечен престој (ноќи)'],
      ['Домашни туристи', S.dom.arr, S.dom.nights, S.avg(S.dom.nights, S.dom.arr)], ['Странски туристи – вкупно', S.fa, S.fn, S.avg(S.fn, S.fa)],
      ...S.foreign.map(([k, o]) => [nationalityName(k), o.arr, o.nights, S.avg(o.nights, o.arr)]), ['ВКУПНО', S.total.arr, S.total.nights, S.avg(S.total.nights, S.total.arr)]];
    body = <><div className="tw" id="hk_tw"><table className="dense"><thead><tr><th>Земја на постојано живеење / државјанство</th><th className="n">Доаѓања (туристи)</th><th className="n">Ноќевања</th><th className="n">Просечен престој (ноќи)</th></tr></thead><tbody>
      <tr style={{ background: 'var(--soft)' }}><td><b>Домашни туристи</b></td><td className="n"><b>{S.dom.arr}</b></td><td className="n"><b>{S.dom.nights}</b></td><td className="n">{S.avg(S.dom.nights, S.dom.arr)}</td></tr>
      <tr style={{ background: 'var(--soft)' }}><td><b>Странски туристи – вкупно</b></td><td className="n"><b>{S.fa}</b></td><td className="n"><b>{S.fn}</b></td><td className="n">{S.avg(S.fn, S.fa)}</td></tr>
      {S.foreign.map(([k, o]) => <tr key={k}><td style={{ paddingLeft: 22 }}>{nationalityName(k)}</td><td className="n">{o.arr}</td><td className="n">{o.nights}</td><td className="n">{S.avg(o.nights, o.arr)}</td></tr>)}
      <tr><td><b>ВКУПНО</b></td><td className="n"><b>{S.total.arr}</b></td><td className="n"><b>{S.total.nights}</b></td><td className="n">{S.avg(S.total.nights, S.total.arr)}</td></tr></tbody></table></div>
      <p className="note">Месечен статистички извештај за туристи (Државен завод за статистика): доаѓања = гости пријавени во периодот, ноќевања = ноќи во периодот. Изберете период од 1-ви до последен ден во месецот. Податоците се од книгата на гости (државјанство на секој гостин). Образецот и рокот проверете ги кај ДЗС.</p></>;
  }
  const title = PDF_T[T]!;
  return (
    <>
      <Hd t="Хотел – книга на гости и извештаи">
        <ExportXlsx name={`Hotel_${T}.xlsx`} label="⬇ Извоз" sheets={[{ name: title, rows: xl }]} />
        <ListPdf target="#hk_tw" title={`${title} · ${dmy(a)} – ${dmy(b)}`} landscape={T !== 'dzs'} label="PDF" />
        <Link className="btn" href="/hotel">🏨 Рецепција</Link>
      </Hd>
      <form className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }} action="/hotelKniga">
        {TABS.map(([k, n]) => <Link key={k} className={`btn ${T === k ? 'pri' : ''}`} href={q({ t: k })}>{n}</Link>)}
        <span style={{ flex: 1 }} /><input type="hidden" name="t" value={T} />
        <label className="mini">од <input name="a" type="date" defaultValue={a} style={{ width: 'auto' }} /></label>
        <label className="mini">до <input name="b" type="date" defaultValue={b} style={{ width: 'auto' }} /></label>
        <button className="btn sm">Прикажи</button>
      </form>
      {body}
    </>
  );
}
