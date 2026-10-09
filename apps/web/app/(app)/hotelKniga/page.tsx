/** Legacy `VIEWS.hotelKniga` 9620 → 11809 — книга на гости, странци (пријава), такса за престој, зафатеност и приход. */
import Link from 'next/link';
import { and, asc, eq, sql } from 'drizzle-orm';
import { hotelOccupancy, hotelTaxReport, nationalityName } from '@wise/core/industry';
import { firmHotelConfig, hotelReservations, hotelRooms } from '@wise/db';
import { inYearOr } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { Hd } from '@/components/hd';

const TABS = [['book', '📒 Книга на гости'], ['for', '🛂 Странци (пријава)'], ['tax', '🏛 Такса за престој'], ['izv', '📈 Зафатеност и приход']] as const;

export default async function HotelKniga({ searchParams }: { searchParams: Promise<{ t?: string; a?: string; b?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('hotelKniga', 'Хотел – книга на гости');
  if (g.blocked) return g.blocked;
  const T = TABS.some((x) => x[0] === sp.t) ? sp.t! : 'book';
  const a = inYearOr(sp.a, g.year, `${g.year}-01-01`), b = inYearOr(sp.b, g.year, `${g.year}-12-31`);
  const H = firmHotelConfig(g.firm);
  const rooms = await db().select().from(hotelRooms).where(eq(hotelRooms.firmId, g.firm.id));
  const R = await db().select().from(hotelReservations).where(and(eq(hotelReservations.firmId, g.firm.id), sql`${hotelReservations.from} <= ${b} and ${hotelReservations.to} >= ${a}`)).orderBy(asc(hotelReservations.from));
  const stays = R.map((r) => ({ ...r, room: r.roomId, price: Number(r.price), advance: Number(r.advance ?? 0) }));
  const guests = R.filter((r) => r.status === 'in' || r.status === 'out').flatMap((r) => r.guests.map((x) => ({ r, x, room: rooms.find((y) => y.id === r.roomId)?.no ?? '' })));
  const q = (o: Record<string, string>) => '/hotelKniga?' + new URLSearchParams({ t: T, a, b, ...o }).toString();
  let body: React.ReactNode;
  if (T === 'book' || T === 'for') {
    const L = T === 'for' ? guests.filter((y) => y.x.nat && y.x.nat !== 'MK') : guests;
    body = <div className="tw"><table className="dense"><thead><tr><th>Р.бр</th><th>Име и презиме</th><th>Датум на раѓање</th><th>Пол</th><th>Државјанство</th><th>Документ</th><th>Доаѓање</th><th>Заминување</th><th>Соба</th>{T === 'for' && <th>Пријава</th>}</tr></thead>
      <tbody>{L.map((y, i) => <tr key={i}><td>{i + 1}</td><td>{y.x.name}</td><td>{dmy(y.x.birth)}</td><td>{y.x.sex}</td><td>{nationalityName(y.x.nat)}</td><td>{(y.x.doc === 'pas' ? 'пасош ' : y.x.doc === 'lk' ? 'л.к. ' : '') + (y.x.docNo ?? '')}</td><td>{dmy(y.r.from)}</td><td>{dmy(y.r.to)}</td><td>{y.room}</td>
        {T === 'for' && <td>{y.x.police ? <span className="pill good">пријавен {dmy(y.x.police)}</span> : <span className="pill bad">НЕ Е ПРИЈАВЕН</span>}</td>}</tr>)}
        {!L.length && <tr><td colSpan={10} className="note">Нема гости во периодот.</td></tr>}</tbody></table></div>;
  } else if (T === 'tax') {
    const L = hotelTaxReport(stays, a, b, H);
    const s = (k: 'n' | 'per' | 'free' | 'units' | 'amt') => L.reduce((x, o) => x + o[k], 0);
    body = <><div className="tw"><table className="dense"><thead><tr><th>Месец</th><th className="n">Ноќевања (соба-ноќи)</th><th className="n">Ноќевања (лица)</th><th className="n">Ослободени</th><th className="n">Оданочиви единици</th><th className="n">Такса (ден.)</th></tr></thead>
      <tbody>{L.map((o) => <tr key={o.mo}><td>{o.mo.slice(5)}/{o.mo.slice(0, 4)}</td><td className="n">{o.n}</td><td className="n">{o.per}</td><td className="n">{o.free}</td><td className="n">{o.units}</td><td className="n"><b>{fmt(o.amt)}</b></td></tr>)}
        <tr><td><b>Вкупно</b></td><td className="n">{s('n')}</td><td className="n">{s('per')}</td><td className="n">{s('free')}</td><td className="n">{s('units')}</td><td className="n"><b>{fmt(s('amt'))}</b></td></tr></tbody></table></div>
      <p className="note">Износ по лице/ноќ: {fmt(H.tax)} ден. Таксата се уплатува на сметката на општината според нејзината одлука.</p></>;
  } else {
    const L = hotelOccupancy(stays, rooms.filter((r) => r.active).length, a, b, H);
    body = <><div className="tw"><table className="dense"><thead><tr><th>Месец</th><th className="n">Продадени соба-ноќи</th><th className="n">Зафатеност</th><th className="n">Приход од ноќевања (без ДДВ)</th><th className="n">ADR</th><th className="n">RevPAR</th></tr></thead>
      <tbody>{L.map((o) => <tr key={o.mo}><td>{o.mo.slice(5)}/{o.mo.slice(0, 4)}</td><td className="n">{o.n}</td><td className="n">{o.occ != null ? o.occ + '%' : '—'}</td><td className="n">{fmt(o.rev)}</td><td className="n">{o.adr != null ? fmt(o.adr) : ''}</td><td className="n">{o.revpar != null ? fmt(o.revpar) : ''}</td></tr>)}
        {!L.length && <tr><td colSpan={6} className="note">Нема податоци.</td></tr>}</tbody></table></div>
      <p className="note">Вклучени се и потврдените резервации за идните денови (прогноза). ADR = приход / продадени ноќи; RevPAR = приход / сите расположиви соба-ноќи.</p></>;
  }
  return (
    <>
      <Hd t="Хотел – книга на гости и извештаи"><Link className="btn" href="/hotel">🏨 Рецепција</Link></Hd>
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
