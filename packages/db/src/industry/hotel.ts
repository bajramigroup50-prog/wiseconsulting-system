/**
 * Hotel service (legacy ACT `htNewB … htClean` 9575, `htRoom*` 9613, `htCfgSave` 9616).
 *
 * Invoicing goes through the Phase 3 invoice service: `invoiceReservation` issues the final invoice (nights, room
 * charges, tourist tax on its liability konto). FIX (LEGACY-MAP 10.4 item 11): legacy `htInv` ignored the advance —
 * here `issueReservationAdvance` issues a Phase 3 advance invoice for it and the final invoice deducts it.
 */
import { and, eq, ne, sql } from 'drizzle-orm';
import {
  hotelAdvanceNet, hotelConfig, hotelInvoiceLines, htCalc, nextModuleNumber, stayOverlaps, type HotelConfig,
} from '@wise/core/industry';
import { audit, type Tx } from '../audit';
import { hotelReservations, hotelRooms, invoices, type HotelReservation } from '../schema/index';
import type { HotelChargeRow, HotelGuestRow } from '../schema/industry';
import {
  assertPartner, dec2, dmy, findOrCreatePartner, IndustryError, industryConfigOf, issueModuleInvoice, loadIndustryFirm, n, type IndActor,
} from './context';

const MOD = 'hotel';
const fail = (m: string): never => { throw new IndustryError(m); };
const isDate = (d: string | null | undefined) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

export const firmHotelConfig = (f: Parameters<typeof industryConfigOf>[0]): HotelConfig => hotelConfig(industryConfigOf<HotelConfig>(f, 'hotel'));

/* ---------------- rooms ---------------- */

export interface RoomInput { id?: string | null; no: string; kind?: string | null; beds?: number | null; floor?: string | null; price?: number | null; active?: boolean }

export async function saveRoom(tx: Tx, a: IndActor, r: RoomInput): Promise<string> {
  await loadIndustryFirm(tx, a.firmId, MOD);
  const no = r.no.trim() || fail('Внесете број на соба.');
  const [dup] = await tx.select({ id: hotelRooms.id }).from(hotelRooms).where(and(eq(hotelRooms.firmId, a.firmId), eq(hotelRooms.no, no), r.id ? ne(hotelRooms.id, r.id) : undefined)).limit(1);
  if (dup) fail(`Собата ${no} веќе постои.`);
  const v = { no, kind: r.kind?.trim() || null, beds: Math.max(1, Math.round(n(r.beds)) || 1), floor: r.floor?.trim() || null, price: dec2(n(r.price))!, active: r.active !== false };
  let id = r.id ?? '';
  if (id) {
    const [u] = await tx.update(hotelRooms).set(v).where(and(eq(hotelRooms.id, id), eq(hotelRooms.firmId, a.firmId))).returning({ id: hotelRooms.id });
    if (!u) fail('Собата не постои.');
  } else id = (await tx.insert(hotelRooms).values({ ...v, firmId: a.firmId }).returning({ id: hotelRooms.id }))[0]!.id;
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'htRoomSave', entityType: 'hotel_room', entityId: id, data: { no } });
  return id;
}

/** Legacy `htClean`: room cleaned after a check-out. */
export async function setRoomClean(tx: Tx, a: IndActor, id: string): Promise<void> {
  await tx.update(hotelRooms).set({ hk: null }).where(and(eq(hotelRooms.id, id), eq(hotelRooms.firmId, a.firmId)));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'htClean', entityType: 'hotel_room', entityId: id });
}

/* ---------------- reservations ---------------- */

export interface ReservationInput {
  id?: string | null; roomId: string; from: string; to: string; guestName: string; phone?: string | null; email?: string | null;
  adults?: number | null; children?: number | null; price?: number | null; board?: string | null; partnerId?: string | null; src?: string | null;
  advance?: number | null; note?: string | null; noTax?: boolean;
  guests?: HotelGuestRow[]; charges?: HotelChargeRow[];
}

async function own(tx: Tx, firmId: string, id: string): Promise<HotelReservation> {
  const [r] = await tx.select().from(hotelReservations).where(and(eq(hotelReservations.id, id), eq(hotelReservations.firmId, firmId))).for('update').limit(1);
  return r ?? fail('Резервацијата не постои.');
}

async function clash(tx: Tx, firmId: string, roomId: string, from: string, to: string, exceptId?: string | null) {
  const L = await tx.select({ id: hotelReservations.id, number: hotelReservations.number, from: hotelReservations.from, to: hotelReservations.to })
    .from(hotelReservations).where(and(eq(hotelReservations.firmId, firmId), eq(hotelReservations.roomId, roomId), sql`${hotelReservations.status} not in ('cancel','noshow')`,
      exceptId ? ne(hotelReservations.id, exceptId) : undefined));
  return L.find((r) => stayOverlaps({ from, to }, r));
}

/** Legacy `htSaveB`: validate (room, guest, dates, room free) and save. Guests / charges are replaced when given. */
export async function saveReservation(tx: Tx, a: IndActor, r: ReservationInput): Promise<{ id: string; number: string }> {
  await loadIndustryFirm(tx, a.firmId, MOD);
  const prev = r.id ? await own(tx, a.firmId, r.id) : null;
  if (prev && prev.invoiceId) fail('Резервацијата е фактурирана – не може да се менува.');
  if (!r.roomId) fail('Изберете соба.');
  const [room] = await tx.select().from(hotelRooms).where(and(eq(hotelRooms.id, r.roomId), eq(hotelRooms.firmId, a.firmId))).limit(1);
  if (!room) fail('Собата не постои.');
  const guestName = r.guestName.trim() || fail('Внесете име на гостинот.');
  if (!isDate(r.from) || !isDate(r.to) || !(r.to > r.from)) fail('Проверете ги датумите (заминувањето е по доаѓањето).');
  const c = await clash(tx, a.firmId, r.roomId, r.from, r.to, prev?.id);
  if (c) fail(`Собата е зафатена во тој период (${c.number}, ${dmy(c.from)}–${dmy(c.to)}).`);
  const partnerId = await assertPartner(tx, a.firmId, r.partnerId);
  const head = {
    roomId: r.roomId, from: r.from, to: r.to, guestName, phone: r.phone?.trim() || null, email: r.email?.trim() || null,
    adults: Math.max(1, Math.round(n(r.adults)) || 1), children: Math.max(0, Math.round(n(r.children))), price: dec2(r.price == null ? n(room!.price) : n(r.price))!,
    board: ['RO', 'BB', 'HB', 'FB'].includes(String(r.board)) ? String(r.board) : 'BB', partnerId, src: r.src?.trim() || null,
    advance: r.advance ? dec2(n(r.advance)) : null, note: r.note?.trim() || null, noTax: !!r.noTax,
    ...(r.guests ? { guests: r.guests.filter((g) => g.name?.trim()).map((g) => ({ ...g, name: g.name.trim() })) } : {}),
    ...(r.charges ? { charges: r.charges } : {}),
  };
  let id: string, number: string;
  if (prev) {
    if (prev.advanceInvoiceId && n(prev.advance) !== n(head.advance)) fail('За авансот е издадена авансна фактура – износот не може да се менува.');
    await tx.update(hotelReservations).set(head).where(eq(hotelReservations.id, prev.id));
    id = prev.id; number = prev.number;
  } else {
    const y = r.from.slice(0, 4);
    const used = (await tx.select({ n: hotelReservations.number }).from(hotelReservations).where(and(eq(hotelReservations.firmId, a.firmId), sql`${hotelReservations.number} like ${'%/' + y}`))).map((x) => x.n);
    number = nextModuleNumber('Р-', used, y);
    id = (await tx.insert(hotelReservations).values({ ...head, firmId: a.firmId, number, date: new Date().toISOString().slice(0, 10), createdBy: a.userId }).returning({ id: hotelReservations.id }))[0]!.id;
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: prev ? 'htSave' : 'htNew', entityType: 'hotel_reservation', entityId: id, data: { number, roomId: r.roomId, from: r.from, to: r.to } });
  return { id, number };
}

/** Legacy `htChAdd` / `htChRm`: room charges (gross prices). */
export async function setReservationCharges(tx: Tx, a: IndActor, id: string, charges: HotelChargeRow[]): Promise<void> {
  const r = await own(tx, a.firmId, id);
  if (r.status === 'out' || r.invoiceId) fail('Гостинот е одјавен – потрошувачката не се менува.');
  for (const c of charges) if (!c.name?.trim() || !(n(c.price) > 0) || !(n(c.qty) > 0)) fail('Внесете опис, количина и цена.');
  await tx.update(hotelReservations).set({ charges }).where(eq(hotelReservations.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'htCharges', entityType: 'hotel_reservation', entityId: id, data: { n: charges.length } });
}

export async function setReservationGuests(tx: Tx, a: IndActor, id: string, guests: HotelGuestRow[]): Promise<void> {
  await own(tx, a.firmId, id);
  await tx.update(hotelReservations).set({ guests: guests.filter((g) => g.name?.trim()) }).where(eq(hotelReservations.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'htGuests', entityType: 'hotel_reservation', entityId: id, data: { n: guests.length } });
}

/**
 * Legacy `htIn`: check-in needs the guests; arrival moves to today when it was later. Returns the foreigners still to
 * be reported to the police (24-hour rule) and guests missing a birth date / document number.
 */
export async function checkIn(tx: Tx, a: IndActor, id: string, today: string): Promise<{ foreigners: number; incomplete: number }> {
  const r = await own(tx, a.firmId, id);
  if (r.status !== 'resv') fail('Резервацијата не е во статус „резервација“.');
  const G = r.guests.filter((g) => g.name);
  if (!G.length) fail('Внесете ги гостите (име, датум на раѓање, документ) пред пријавата.');
  const from = r.from > today ? today : r.from;
  if (from !== r.from) { const c = await clash(tx, a.firmId, r.roomId, from, r.to, r.id); if (c) fail(`Собата е зафатена (${c.number}).`); }
  await tx.update(hotelReservations).set({ status: 'in', inAt: new Date(), from }).where(eq(hotelReservations.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'htIn', entityType: 'hotel_reservation', entityId: id, data: { number: r.number } });
  return { foreigners: G.filter((g) => g.nat && g.nat !== 'MK' && !g.police).length, incomplete: G.filter((g) => !g.docNo || !g.birth).length };
}

/** Legacy `htOut`: departure = today (nights are charged up to today), room marked for cleaning. */
export async function checkOut(tx: Tx, a: IndActor, id: string, today: string): Promise<void> {
  const r = await own(tx, a.firmId, id);
  if (r.status !== 'in') fail('Гостинот не е пријавен.');
  const to = today > r.from ? today : new Date(Date.parse(r.from + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
  await tx.update(hotelReservations).set({ status: 'out', outAt: new Date(), to }).where(eq(hotelReservations.id, id));
  await tx.update(hotelRooms).set({ hk: 'dirty' }).where(eq(hotelRooms.id, r.roomId));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'htOut', entityType: 'hotel_reservation', entityId: id, data: { number: r.number, to } });
}

/** Legacy `htCancel`; `noshow` for a guest who did not arrive (FIX 10.4 item 11). */
export async function setReservationStatus(tx: Tx, a: IndActor, id: string, status: 'cancel' | 'noshow'): Promise<void> {
  const r = await own(tx, a.firmId, id);
  if (r.status !== 'resv') fail('Може да се откаже само резервација што не е пријавена.');
  if (r.advanceInvoiceId) fail('За резервацијата е издадена авансна фактура – прво сторнирајте ја (одобрение).');
  await tx.update(hotelReservations).set({ status }).where(eq(hotelReservations.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: status === 'cancel' ? 'htCancel' : 'htNoShow', entityType: 'hotel_reservation', entityId: id, data: { number: r.number } });
}

/** Legacy `htFisc`: paid at the fiscal till — revenue comes with the Z report; the reservation is closed. */
export async function markPaidAtTill(tx: Tx, a: IndActor, id: string): Promise<void> {
  const r = await own(tx, a.firmId, id);
  if (r.status !== 'out' || r.invoiceId) fail('Само одјавен и нефактуриран престој.');
  await tx.update(hotelReservations).set({ folioAt: new Date() }).where(eq(hotelReservations.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'htFisc', entityType: 'hotel_reservation', entityId: id, data: { number: r.number } });
}

async function payer(tx: Tx, a: IndActor, r: HotelReservation, cfg: HotelConfig): Promise<string> {
  if (r.partnerId) return r.partnerId;
  return cfg.payer === 'guest'
    ? findOrCreatePartner(tx, a.firmId, r.guestName, { phone: r.phone, email: r.email })
    : findOrCreatePartner(tx, a.firmId, 'Гости – физички лица (хотел)');
}

/** FIX (10.4 item 11): advance of the reservation → Phase 3 advance invoice at the accommodation VAT rate. */
export async function issueReservationAdvance(tx: Tx, a: IndActor, id: string, date: string): Promise<{ id: string; number: string }> {
  const f = await loadIndustryFirm(tx, a.firmId, MOD);
  const r = await own(tx, a.firmId, id);
  const cfg = firmHotelConfig(f);
  if (!(n(r.advance) > 0)) fail('Резервацијата нема аванс.');
  if (r.advanceInvoiceId) fail('Авансната фактура е веќе издадена.');
  const partnerId = await payer(tx, a, r, cfg);
  const inv = await issueModuleInvoice(tx, a, {
    partnerId, date, advance: true, note: `Аванс за сместување – резервација ${r.number} (${r.guestName}, ${dmy(r.from)}–${dmy(r.to)})`,
    data: { source: { type: 'hotel_reservation', id: r.id } },
    lines: [{ name: `Аванс за сместување – резервација ${r.number}`, unit: 'ком', qty: 1, price: hotelAdvanceNet(n(r.advance), cfg), rate: cfg.rate, account: cfg.revK || null }],
  });
  await tx.update(hotelReservations).set({ advanceInvoiceId: inv.id, partnerId: r.partnerId ?? partnerId }).where(eq(hotelReservations.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'htAdv', entityType: 'hotel_reservation', entityId: id, data: { invoice: inv.number } });
  return inv;
}

/** Legacy `htInv`: final invoice of a checked-out stay (with the advance invoice deducted). */
export async function invoiceReservation(tx: Tx, a: IndActor, id: string, date: string): Promise<{ id: string; number: string; warnings: string[] }> {
  const f = await loadIndustryFirm(tx, a.firmId, MOD);
  const r = await own(tx, a.firmId, id);
  if (r.status !== 'out') fail('Фактура се издава по одјавата.');
  if (r.invoiceId || r.folioAt) fail('Престојот е веќе фактуриран / платен на каса.');
  const cfg = firmHotelConfig(f);
  const [room] = await tx.select().from(hotelRooms).where(eq(hotelRooms.id, r.roomId)).limit(1);
  const stay = { ...r, price: n(r.price), advance: n(r.advance) };
  const lines = hotelInvoiceLines(stay, cfg, room?.no ?? '', dmy);
  const partnerId = r.advanceInvoiceId
    ? (await tx.select({ p: invoices.partnerId }).from(invoices).where(eq(invoices.id, r.advanceInvoiceId)).limit(1))[0]?.p ?? (await payer(tx, a, r, cfg))
    : await payer(tx, a, r, cfg);
  const advances = r.advanceInvoiceId ? [{ advanceId: r.advanceInvoiceId, amount: (await tx.select({ b: invoices.base }).from(invoices).where(eq(invoices.id, r.advanceInvoiceId)).limit(1))[0]?.b ?? 0 }] : [];
  const k = htCalc(stay, cfg);
  const inv = await issueModuleInvoice(tx, a, {
    partnerId, date, lines, advances, data: { source: { type: 'hotel_reservation', id: r.id } },
    note: `Гостин: ${r.guestName} · резервација ${r.number}${k.adv ? ` · платен аванс ${k.adv.toFixed(2)}` : ''}`,
  });
  await tx.update(hotelReservations).set({ invoiceId: inv.id }).where(eq(hotelReservations.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'htInv', entityType: 'hotel_reservation', entityId: id, data: { invoice: inv.number, total: k.tot } });
  return inv;
}
