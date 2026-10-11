/**
 * Legacy `VIEWS.hotel` 9521 — Хотел – рецепција: 14-day room grid (date jump, legend, 🧹 room cleaned), arrivals /
 * departures / in-house, foreigners not yet reported to the police, reservation list (partner, invoice / folio pills)
 * with Excel / PDF export and the reservation import of the dig bar (`DIG.hres`); reservation editor `htEditor`
 * (clash / date callouts, room → price and beds for a new reservation, guests, room charges with the article price,
 * stay calculation, check-in with the missing-data confirmation, check-out, invoice or "paid at the till").
 *
 * Invoice: legacy `htInv` opened a DRAFT invoice (`bzInvDraft`) for review; here the Phase 3 invoice service issues
 * the invoice (with the advance invoice deducted) and the editor links it for review / correction (`/izlez?edit=`).
 */
import Link from 'next/link';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import {
  addDays, BOARD, HOTEL_LEGEND, HOTEL_RES_IMPORT, HOTEL_STATUS, hotelCheckInCheck, hotelEditorCallouts, hotelTillConfirm, hrImportTemplate, htCalc, NATIONALITIES,
  nationalityName,
} from '@wise/core/industry';
import { firmHotelConfig, hotelReservations, hotelRooms, invoices, items, partners } from '@wise/db';
import { partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage, today } from '@/lib/industry';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { DateJump, ItemPick, PrefillSelect } from '@/components/hotel-rent';
import { ExportXlsx, ListPdf, XlsxImport } from '@/components/list-tools';
import { RowAction } from '@/components/row-action';
import { addChargeAction, cleanRoomAction, importReservationsAction, removeChargeAction, reservationStepAction, saveReservationAction } from './actions';

type SP = { id?: string; nov?: string; room?: string; d?: string; from?: string };
const WD = ['нед', 'пон', 'вто', 'сре', 'чет', 'пет', 'саб'];
const SRC = ['директно', 'телефон', 'Booking.com', 'Airbnb', 'агенција', 'друго'];

export default async function HotelPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const g = await industryPage('hotel', 'Хотел – рецепција');
  if (g.blocked) return g.blocked;
  const { firm, write } = g;
  const cfg = firmHotelConfig(firm);
  const R = await db().select().from(hotelRooms).where(and(eq(hotelRooms.firmId, firm.id), eq(hotelRooms.active, true))).orderBy(asc(hotelRooms.no));
  const T = today();

  if (sp.id || sp.nov) {
    const [E] = sp.id ? await db().select().from(hotelReservations).where(and(eq(hotelReservations.id, sp.id), eq(hotelReservations.firmId, firm.id))).limit(1) : [];
    const room0 = R.find((r) => r.id === (sp.room ?? E?.roomId)) ?? R[0];
    const from = E?.from ?? sp.d ?? T;
    const e = E ?? { id: '', number: '', roomId: room0?.id ?? '', from, to: addDays(from, 1), guestName: '', phone: '', email: '', adults: room0?.beds ?? 2, children: 0, price: room0?.price ?? '0', board: 'BB', partnerId: null, src: 'директно', advance: null, guests: [], charges: [], status: 'resv' as const, note: '', noTax: false, invoiceId: null, advanceInvoiceId: null, folioAt: null };
    const k = htCalc({ ...e, price: Number(e.price), advance: Number(e.advance ?? 0) }, cfg);
    const [P, IT, inv, adv, others] = await Promise.all([
      partnerOptions(firm.id),
      db().select({ id: items.id, name: items.name, price: items.price, rate: items.vatRate }).from(items).where(and(eq(items.firmId, firm.id), eq(items.active, true))).orderBy(asc(items.name)),
      e.invoiceId ? db().select({ id: invoices.id, n: invoices.number }).from(invoices).where(eq(invoices.id, e.invoiceId)).then((x) => x[0]) : null,
      e.advanceInvoiceId ? db().select({ n: invoices.number }).from(invoices).where(eq(invoices.id, e.advanceInvoiceId)).then((x) => x[0]?.n) : null,
      e.roomId ? db().select({ id: hotelReservations.id, roomId: hotelReservations.roomId, from: hotelReservations.from, to: hotelReservations.to, status: hotelReservations.status }).from(hotelReservations).where(and(eq(hotelReservations.firmId, firm.id), eq(hotelReservations.roomId, e.roomId))) : [],
    ]);
    const st = HOTEL_STATUS[e.status];
    const ro = !write || !!e.invoiceId || e.status === 'out' || e.status === 'cancel';
    const guests = [...e.guests, ...Array(e.status === 'out' ? 0 : 2).fill({ name: '', nat: 'MK', doc: 'lk' })];
    const W = e.status === 'cancel' ? [] : hotelEditorCallouts({ id: e.id || null, roomId: e.roomId, from: e.from, to: e.to }, others);
    const ci = hotelCheckInCheck(e.guests);
    const allRooms = e.roomId && !R.some((r) => r.id === e.roomId) ? [...R, ...(await db().select().from(hotelRooms).where(eq(hotelRooms.id, e.roomId)))] : R;
    return (
      <>
        <Hd t={e.id ? `Резервација ${e.number}` : 'Нова резервација'} sub={st[0]}>
          <Link className="btn" href="/hotel">← Рецепција</Link>
          {e.id && <Link className="btn" href={`/hotel/folio?id=${e.id}`} target="_blank">🖨 Сметка за престој</Link>}
        </Hd>
        {W.length > 0 && W.map((w) => <div key={w} className="callout warn">{w}</div>)}
        <BankForm action={saveReservationAction}>
          <input type="hidden" name="id" value={e.id} />
          <div className="card"><div className="form">
            <label className="f">Соба<PrefillSelect name="room" defaultValue={e.roomId} apply={!e.id}
              options={[{ value: '', label: '—' }, ...allRooms.map((r) => ({ value: r.id, label: `${r.no} · ${r.kind ?? ''} · ${r.beds} лег.`, set: { price: Number(r.price) || null, adults: r.beds } }))]} /></label>
            <label className="f">Доаѓање<input name="from" type="date" defaultValue={e.from} /></label>
            <label className="f">Заминување<input name="to" type="date" defaultValue={e.to} /></label>
            <label className="f">Гостин (носител)<input name="guestName" defaultValue={e.guestName} /></label>
            <label className="f">Телефон<input name="phone" defaultValue={e.phone ?? ''} /></label>
            <label className="f">Е-пошта<input name="email" defaultValue={e.email ?? ''} /></label>
            <label className="f">Возрасни<input name="adults" type="number" min={1} defaultValue={e.adults} /></label>
            <label className="f">Деца<input name="children" type="number" min={0} defaultValue={e.children} /></label>
            <label className="f">Цена по ноќ (со ДДВ)<input name="price" type="number" step="any" defaultValue={Number(e.price) || ''} /></label>
            <label className="f">Услуга<select name="board" defaultValue={e.board}>{Object.entries(BOARD).map(([k2, v]) => <option key={k2} value={k2}>{v}</option>)}</select></label>
            <label className="f">Извор<select name="src" defaultValue={e.src ?? 'директно'}>{[...SRC, ...(e.src && !SRC.includes(e.src) ? [e.src] : [])].map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="f">Плаќа фирма (фактура на)<select name="partner" defaultValue={e.partnerId ?? ''}><option value="">— гостин —</option>{P.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="f">Аванс / депозит (ден.)<input name="advance" type="number" step="any" defaultValue={e.advance ? Number(e.advance) : ''} /></label>
            <label className="f wide">Забелешка<input name="note" defaultValue={e.note ?? ''} /></label>
          </div>
            <label className="chk" style={{ marginTop: 6 }}><input type="checkbox" name="noTax" defaultChecked={e.noTax} /> Без такса за престој (ослободени – наведете во забелешка)</label>
          </div>
          <div className="card">
            <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Гости (за книгата на гости и пријава на странци)</h2>
            <div className="tw"><table className="dense"><thead><tr><th>Име и презиме</th><th>Датум на раѓање</th><th>Државјанство</th><th>Документ</th><th>Број на документ</th><th>Пол</th><th>Пријавен во полиција</th></tr></thead>
              <tbody>{guests.map((x, i) => (
                <tr key={i}>
                  <td><input name={`g.name.${i}`} defaultValue={x.name || (i === 0 && !e.guests.length ? e.guestName : '')} /></td>
                  <td><input name={`g.birth.${i}`} type="date" defaultValue={x.birth ?? ''} /></td>
                  <td><select name={`g.nat.${i}`} defaultValue={x.nat ?? 'MK'}>{NATIONALITIES.map(([c, nm]) => <option key={c} value={c}>{nm}</option>)}</select></td>
                  <td><select name={`g.doc.${i}`} defaultValue={x.doc ?? 'lk'}><option value="lk">лична карта</option><option value="pas">пасош</option><option value="oth">друго</option></select></td>
                  <td><input name={`g.docNo.${i}`} defaultValue={x.docNo ?? ''} /></td>
                  <td><select name={`g.sex.${i}`} defaultValue={x.sex ?? ''} style={{ width: 60 }}><option value="">—</option><option>М</option><option>Ж</option></select></td>
                  <td><input type="hidden" name={`g.police.${i}`} value={x.police ?? ''} />{x.nat && x.nat !== 'MK'
                    ? <label className="chk"><input type="checkbox" name={`g.pol.${i}`} defaultChecked={!!x.police} /> {x.police ? dmy(x.police) : 'не'}</label>
                    : x.name ? <span className="mini">домашен</span> : <label className="chk"><input type="checkbox" name={`g.pol.${i}`} /> странец – пријавен</label>}</td>
                </tr>
              ))}</tbody></table></div>
            <p className="note">Внесете ги гостите при пријавата (check-in): име, датум на раѓање, државјанство и документ. Странците мора да се пријават во полиција во рок од 24 часа. За нов гостин пополнете празен ред и зачувајте; за бришење избришете го името.</p>
          </div>
          {write && !e.invoiceId && <div className="row" style={{ marginBottom: 8, gap: 8 }}><span style={{ flex: 1 }} /><Link className="btn" href="/hotel">Затвори</Link><button className="btn pri">Зачувај</button></div>}
        </BankForm>
        {e.id && (
          <div className="card">
            <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Потрошувачка на собата (ресторан, бар, мини-бар, перење…)</h2>
            {e.charges.length > 0 && <table className="dense"><thead><tr><th>Датум</th><th>Опис</th><th className="n">Кол.</th><th className="n">Цена со ДДВ</th><th className="n">ДДВ %</th><th className="n">Износ</th><th /></tr></thead>
              <tbody>{e.charges.map((x, i) => <tr key={i}><td>{dmy(x.date)}</td><td>{x.name}</td><td className="n">{x.qty}</td><td className="n">{fmt(x.price)}</td><td className="n">{x.rate}%</td><td className="n">{fmt(x.qty * x.price)}</td>
                <td>{!ro && <RowAction action={removeChargeAction.bind(null, e.id, e.charges, i)} label="✕" />}</td></tr>)}</tbody></table>}
            {!ro && <BankForm action={addChargeAction} className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'end', marginTop: 6 }}>
              <input type="hidden" name="id" value={e.id} /><input type="hidden" name="charges" value={JSON.stringify(e.charges)} />
              <label className="f">Артикл / услуга<ItemPick items={IT.map((i) => ({ id: i.id, name: i.name, gross: Math.round(Number(i.price ?? 0) * (1 + Number(i.rate ?? 0) / 100) * 100) / 100, rate: Number(i.rate ?? 0) }))} /></label>
              <label className="f">Кол.<input name="cqty" type="number" defaultValue={1} style={{ width: 70 }} /></label>
              <label className="f">Цена со ДДВ<input name="cprice" type="number" step="any" style={{ width: 100 }} /></label>
              <label className="f">ДДВ<select name="crate" defaultValue="10"><option value="10">10% (храна, безалк.)</option><option value="18">18% (алкохол, друго)</option><option value="5">5%</option></select></label>
              <button className="btn sm">+ Додај</button>
            </BankForm>}
          </div>
        )}
        <div className="card"><table className="dense" style={{ maxWidth: 560 }}><tbody>
          <tr><td>Ноќевања: {k.n} × {fmt(Number(e.price))} <span className="mini">(ДДВ {cfg.rate}%)</span></td><td className="n">{fmt(k.acc)}</td></tr>
          <tr><td>Потрошувачка</td><td className="n">{fmt(k.ch)}</td></tr>
          <tr><td>Такса за привремен престој: {k.tu.units} лица × {k.n} ноќи × {fmt(cfg.tax)}{k.tu.free ? ` · ослободени ${k.tu.free}` : ''}{k.tu.half ? ` · 50% ${k.tu.half}` : ''} <span className="mini">(не е ДДВ промет)</span></td><td className="n">{fmt(k.tax)}</td></tr>
          <tr><td><b>Вкупно</b></td><td className="n"><b>{fmt(k.tot)}</b></td></tr>
          {k.adv > 0 && <><tr><td>Платен аванс{adv ? ` (ф-ра ${adv})` : ''}</td><td className="n">−{fmt(k.adv)}</td></tr><tr><td><b>За наплата</b></td><td className="n"><b>{fmt(k.rest)}</b></td></tr></>}
        </tbody></table></div>
        {e.id && write && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span style={{ flex: 1 }} />
            {e.status === 'resv' && !e.advanceInvoiceId && <RowAction className="btn ghost" style={{ color: 'var(--bad)' }} action={reservationStepAction.bind(null, e.id, 'cancel')} confirm={`Да се откаже резервацијата ${e.number}?`} label="Откажи резервација" />}
            {e.status === 'resv' && e.from < T && <RowAction className="btn ghost" action={reservationStepAction.bind(null, e.id, 'noshow')} label="Не дојде" />}
            {Number(e.advance) > 0 && !e.advanceInvoiceId && !e.invoiceId && <RowAction className="btn" action={reservationStepAction.bind(null, e.id, 'adv')} label="🧾 Авансна фактура" />}
            {e.status === 'resv' && <RowAction className="btn pri" action={reservationStepAction.bind(null, e.id, 'in')} confirm={ci.confirm ?? undefined} label="🔑 Пријава (check-in)" />}
            {e.status === 'in' && <RowAction className="btn pri" action={reservationStepAction.bind(null, e.id, 'out')} confirm={e.to !== T ? `Одјавата е на ${dmy(T)}, а резервацијата е до ${dmy(e.to)}. Да се смени заминувањето на денес (ноќевањата се пресметуваат до денес)?` : undefined} label="🧳 Одјава (check-out)" />}
            {e.status === 'out' && !e.invoiceId && !e.folioAt && <>
              <RowAction className="btn pri" action={reservationStepAction.bind(null, e.id, 'inv')} label="🧾 Фактура" />
              <RowAction className="btn" action={reservationStepAction.bind(null, e.id, 'till')} confirm={hotelTillConfirm(fmt(k.tax))} label="💶 Платено на фискална каса" />
            </>}
            {inv && <><span className="pill good">Фактура {inv.n}</span><Link className="btn sm" href={`/izlez?edit=${inv.id}`}>Провери / измени фактура</Link><Link className="btn sm" href={`/print/doc/${inv.id}`} target="_blank">👁</Link></>}
            {e.folioAt && <span className="pill good">платено на каса</span>}
          </div>
        )}
      </>
    );
  }

  const F = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : addDays(T, -1);
  const days = [...Array(14)].map((_, i) => addDays(F, i));
  const A = await db().select().from(hotelReservations).where(and(eq(hotelReservations.firmId, firm.id), ne(hotelReservations.status, 'cancel'))).orderBy(asc(hotelReservations.from));
  const live = A.filter((r) => r.status !== 'noshow');
  const occ = (room: string, d: string) => live.find((r) => r.roomId === room && r.from <= d && d < r.to);
  const arr = live.filter((r) => r.from === T && r.status === 'resv'), dep = live.filter((r) => r.to === T && r.status === 'in'), inH = live.filter((r) => r.status === 'in');
  const late = live.filter((r) => r.status === 'in' && r.to < T);
  const pol = inH.flatMap((r) => r.guests.filter((x) => x.nat && x.nat !== 'MK' && !x.police).map((x) => `${x.name} (${nationalityName(x.nat)}, соба ${R.find((y) => y.id === r.roomId)?.no ?? ''})`));
  const occN = R.filter((rm) => occ(rm.id, T)).length;
  const list = live.filter((r) => r.to >= T || r.status === 'in').slice(0, 60);
  const allRooms = await db().select().from(hotelRooms).where(eq(hotelRooms.firmId, firm.id));
  const pIds = [...new Set(list.map((r) => r.partnerId).filter((x): x is string => !!x))];
  const iIds = list.map((r) => r.invoiceId).filter((x): x is string => !!x);
  const [PN, IN] = await Promise.all([
    pIds.length ? db().select({ id: partners.id, name: partners.name }).from(partners).where(inArray(partners.id, pIds)) : [],
    iIds.length ? db().select({ id: invoices.id, number: invoices.number }).from(invoices).where(inArray(invoices.id, iIds)) : [],
  ]);
  const rows = list.map((r) => {
    const k = htCalc({ ...r, price: Number(r.price), advance: Number(r.advance ?? 0) }, cfg);
    return { r, k, room: allRooms.find((x) => x.id === r.roomId)?.no ?? '', partner: PN.find((p) => p.id === r.partnerId)?.name ?? '', inv: IN.find((i) => i.id === r.invoiceId)?.number ?? null };
  });
  const xl = [['Број', 'Гостин', 'Плаќа фирма', 'Соба', 'Доаѓање', 'Заминување', 'Ноќи', 'Вкупно', 'Статус', 'Фактура'],
    ...rows.map((x) => [x.r.number, x.r.guestName, x.partner, x.room, dmy(x.r.from), dmy(x.r.to), x.k.n, x.k.tot, HOTEL_STATUS[x.r.status][0], x.inv ?? (x.r.folioAt ? 'сметка' : '')])];
  const grid = [['Соба', ...days.map((d) => `${d.slice(8)}.${d.slice(5, 7)}`)], ...R.map((rm) => [rm.no, ...days.map((d) => { const r = occ(rm.id, d); return r ? `${r.guestName} (${HOTEL_STATUS[r.status][0]})` : ''; })])];
  return (
    <>
      <Hd t="Хотел – рецепција" sub={dmy(T)}>
        {write && <XlsxImport action={importReservationsAction} label="📥 Резервации од Excel" templateName="Rezervacii_obrazec.xlsx" template={hrImportTemplate(HOTEL_RES_IMPORT, ['Име Презиме', '01.08.2026', '04.08.2026', R[0]?.no ?? '101', 2, 9000, 'Booking.com', '', ''])} />}
        <ExportXlsx name="Hotel_rezervacii.xlsx" label="⬇ Извоз" sheets={[{ name: 'Тековни и идни резервации', rows: xl }, { name: 'Рецепција', rows: grid }]} />
        <ListPdf target="#ht_list" title="Тековни и идни резервации" landscape />
        <Link className="btn" href="/hotelSoby">🛏 Соби и цени</Link>
        <Link className="btn" href="/hotelKniga">📒 Книга на гости / такса</Link>
        {write && <Link className="btn pri" href="/hotel?nov=1">+ Нова резервација</Link>}
      </Hd>
      {!R.length && <div className="callout warn">Прво внесете ги собите во „🛏 Соби и цени“.</div>}
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        {([['Зафатеност денес', R.length ? Math.round((occN / R.length) * 100) + '%' : '—', `${occN} / ${R.length} соби`], ['Доаѓања денес', arr.length, arr.map((r) => r.guestName).join(', ')], ['Заминувања денес', dep.length, dep.map((r) => r.guestName).join(', ')], ['Гости во хотел', inH.reduce((s, r) => s + Math.max(r.guests.filter((x) => x.name).length, r.adults), 0), `${inH.length} соби`]] as const).map(([t, v, s]) => (
          <div key={t} className="card" style={{ flex: 1, minWidth: 170, margin: 0 }}><div className="mini">{t}</div><div style={{ fontSize: 24, fontWeight: 700 }}>{v}</div><div className="mini">{s}</div></div>
        ))}
      </div>
      {pol.length > 0 && <div className="callout warn">🛂 Странци во хотелот кои не се означени како пријавени во полиција (рок 24 часа од доаѓањето): {pol.join(', ')}</div>}
      {late.length > 0 && <div className="callout warn">⏰ Требаше да се одјават: {late.map((r) => `${r.guestName} (${dmy(r.to)})`).join(', ')}</div>}
      <div className="card" style={{ padding: 8 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <Link className="btn sm" href={`/hotel?from=${addDays(F, -7)}`}>◀ 7 дена</Link>
          <DateJump base="/hotel" value={F} />
          <Link className="btn sm" href={`/hotel?from=${addDays(F, 7)}`}>7 дена ▶</Link>
          <Link className="btn sm ghost" href="/hotel">Денес</Link>
          <span className="mini">Клик на празно поле = нова резервација · клик на гостин = отвори</span>
        </div>
        <div className="tw"><table className="dense" style={{ tableLayout: 'fixed', minWidth: 900 }}>
          <thead><tr><th style={{ width: 110 }}>Соба</th>{days.map((d) => { const wd = new Date(d + 'T12:00:00Z').getUTCDay(); return <th key={d} style={{ textAlign: 'center', background: d === T ? 'var(--accent-soft)' : undefined, color: wd === 0 || wd === 6 ? '#b45' : undefined }}>{d.slice(8)}.{d.slice(5, 7)}<br /><span className="mini">{WD[wd]}</span></th>; })}</tr></thead>
          <tbody>{R.map((rm) => (
            <tr key={rm.id}>
              <td><b>{rm.no}</b> <span className="mini">{rm.kind}</span>{rm.hk === 'dirty' && <> {write
                ? <RowAction className="pill warn" style={{ cursor: 'pointer', border: 0 }} title="За чистење – клик кога е исчистена" action={cleanRoomAction.bind(null, rm.id)} label="🧹" />
                : <span className="pill warn" title="За чистење">🧹</span>}</>}</td>
              {days.map((d) => {
                const r = occ(rm.id, d);
                if (!r) return <td key={d} style={{ background: d === T ? 'var(--accent-soft)' : undefined }}>{write && <Link href={`/hotel?nov=1&room=${rm.id}&d=${d}`} style={{ display: 'block', height: 18 }} aria-label="нова резервација" />}</td>;
                const first = r.from === d || d === days[0];
                return <td key={d} title={`${r.guestName} · ${dmy(r.from)}–${dmy(r.to)} · ${HOTEL_STATUS[r.status][0]}`} style={{ background: HOTEL_STATUS[r.status][2], overflow: 'hidden', whiteSpace: 'nowrap', fontSize: 11, borderLeft: first ? '3px solid #555' : undefined }}>
                  <Link href={`/hotel?id=${r.id}`} style={{ color: 'inherit', display: 'block' }}>{first ? r.guestName || '?' : ' '}</Link></td>;
              })}
            </tr>
          ))}</tbody></table></div>
        <div className="mini" style={{ marginTop: 6 }}>{HOTEL_LEGEND.map(([t, c]) => <span key={t}><span style={{ display: 'inline-block', width: 12, height: 12, background: c, verticalAlign: 'middle', margin: '0 4px 0 10px' }} />{t}</span>)}</div>
      </div>
      <div className="card" id="ht_list"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Тековни и идни резервации ({list.length})</h2>
        <div className="tw"><table className="dense"><thead><tr><th>Број</th><th>Гостин</th><th>Соба</th><th>Доаѓање</th><th>Заминување</th><th className="n">Ноќи</th><th className="n">Вкупно</th><th>Статус</th><th /></tr></thead>
          <tbody>{rows.map(({ r, k, room, partner, inv }) => { const st = HOTEL_STATUS[r.status]; return (
            <tr key={r.id}><td>{r.number}</td><td>{r.guestName}{partner && <span className="mini"> · {partner}</span>}</td><td>{room}</td><td>{dmy(r.from)}</td><td>{dmy(r.to)}</td><td className="n">{k.n}</td><td className="n">{fmt(k.tot)}</td>
              <td><span className={`pill ${st[1]}`}>{st[0]}</span>{inv ? <> <span className="pill good">ф-ра {inv}</span></> : r.folioAt ? <> <span className="pill good">сметка</span></> : null}</td><td><Link className="btn sm" href={`/hotel?id=${r.id}`}>Отвори</Link></td></tr>); })}
            {!list.length && <tr><td colSpan={9} className="note">Нема.</td></tr>}</tbody></table></div>
      </div>
    </>
  );
}
