/**
 * Legacy parity — hotel and rent-a-car services: the Excel imports of the legacy dig bar (`DIG.hroom` rooms,
 * `DIG.hres` reservations from Booking.com / Airbnb exports, `DIG.fleet` rent prices) and the report rows of
 * `VIEWS.rentIzv` (11776 `rcRev`: invoice base or the contract estimate, paid amounts from the open-items service).
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  FLEET_PRICE_IMPORT, fleetImportRow, HOTEL_RES_IMPORT, HOTEL_ROOM_IMPORT, hotelImportReservation, hrImportNum, hrImportRows, rcCalc, rentRevenue,
  stayOverlaps, type RentReportRow,
} from '@wise/core/industry';
import { audit, type Tx } from '../audit';
import { documentPayments } from '../bank/open-items';
import { fleetVehicles, hotelReservations, hotelRooms, invoices, partners, rentRentals } from '../schema/index';
import { IndustryError, loadIndustryFirm, type IndActor } from './context';
import { saveReservation } from './hotel';
import { firmRentConfig, saveVehicle, vehicleRates } from './rent';

const MAX_ROWS = 5000;
const parse = (aoa: unknown[][], F: Parameters<typeof hrImportRows>[1]) => {
  if (aoa.length > MAX_ROWS + 1) throw new IndustryError(`Премногу редови (најмногу ${MAX_ROWS}).`);
  try { return hrImportRows(aoa, F); } catch (e) { throw new IndustryError((e as Error).message); }
};
const summary = (n: number, skip: string[], what: string) =>
  `Внесени ${n} ${what}.${skip.length ? ` Прескокнати ${skip.length}: ${skip.slice(0, 15).join(', ')}${skip.length > 15 ? '…' : ''}` : ''}`;

/** Legacy `digApply` `hroom`: new rooms only (an existing number is skipped). */
export async function importHotelRooms(tx: Tx, a: IndActor, aoa: unknown[][]): Promise<string> {
  await loadIndustryFirm(tx, a.firmId, 'hotel', a);
  const R = parse(aoa, HOTEL_ROOM_IMPORT);
  const have = new Set((await tx.select({ no: hotelRooms.no }).from(hotelRooms).where(eq(hotelRooms.firmId, a.firmId))).map((x) => x.no));
  let n = 0;
  const skip: string[] = [];
  for (const r of R) {
    const no = String(r.no ?? '').trim();
    if (!no || have.has(no)) { skip.push(no || '?'); continue; }
    const beds = Math.max(1, Math.round(hrImportNum(r.beds)) || 2);
    await tx.insert(hotelRooms).values({ firmId: a.firmId, no, kind: r.kind || null, beds, floor: r.floor || null, price: hrImportNum(r.price).toFixed(2), active: true });
    have.add(no);
    n++;
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'htRoomImport', entityType: 'hotel_room', data: { added: n, skipped: skip.length } });
  return summary(n, skip, 'соби');
}

/** Legacy `digApply` `hres`: room by number / type, skipped when the room is taken in the period. */
export async function importHotelReservations(tx: Tx, a: IndActor, aoa: unknown[][]): Promise<string> {
  await loadIndustryFirm(tx, a.firmId, 'hotel', a);
  const R = parse(aoa, HOTEL_RES_IMPORT);
  const rooms = await tx.select().from(hotelRooms).where(and(eq(hotelRooms.firmId, a.firmId), eq(hotelRooms.active, true)));
  const live = await tx.select({ roomId: hotelReservations.roomId, from: hotelReservations.from, to: hotelReservations.to }).from(hotelReservations)
    .where(and(eq(hotelReservations.firmId, a.firmId), sql`${hotelReservations.status} not in ('cancel','noshow')`));
  let n = 0;
  const skip: string[] = [];
  for (const r of R) {
    const x = hotelImportReservation(r, rooms);
    if ('skip' in x) { skip.push(x.skip!); continue; }
    const v = x.res;
    if (live.some((y) => y.roomId === v.roomId && stayOverlaps(v, y))) { skip.push(`${v.guestName} (зафатено)`); continue; }
    await saveReservation(tx, a, { ...v, children: 0, board: 'BB', partnerId: null, advance: null, note: null, noTax: false });
    live.push({ roomId: v.roomId, from: v.from, to: v.to });
    n++;
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'htResImport', entityType: 'hotel_reservation', data: { added: n, skipped: skip.length } });
  return summary(n, skip, 'резервации');
}

/**
 * Legacy `digApply` `fleet`: prices of the vehicle with the plate (legacy skipped plates not in the fixed assets);
 * here an unknown plate becomes a new fleet vehicle (master-data import), marked for rent.
 */
export async function importFleetPrices(tx: Tx, a: IndActor, aoa: unknown[][]): Promise<string> {
  await loadIndustryFirm(tx, a.firmId, 'rent', a);
  const R = parse(aoa, FLEET_PRICE_IMPORT);
  const V = await tx.select().from(fleetVehicles).where(eq(fleetVehicles.firmId, a.firmId));
  const norm = (p: string) => p.replace(/[\s-]+/g, '').toUpperCase();
  let n = 0;
  const skip: string[] = [];
  for (const r of R) {
    const x = fleetImportRow(r);
    if (!x.plate) { skip.push('?'); continue; }
    const v = V.find((y) => norm(y.plate) === x.plate);
    const p = x.prices;
    if (!(p.rDay ?? (v ? Number(v.rDay) : 0))) { skip.push(`${x.plate} (цена/ден)`); continue; }
    const num = (k: keyof typeof p, cur: unknown) => (k in p ? p[k]! : cur == null || cur === '' ? null : Number(cur));
    await saveVehicle(tx, a, {
      ...(v ? {
        id: v.id, plate: v.plate, name: x.name || v.name, trailer: v.trailer, active: v.active, assetId: v.assetId, odo: v.odo, fuelNorm: v.fuelNorm == null ? null : Number(v.fuelNorm),
        capKg: v.capKg, oilEvery: v.oilEvery, oilLastKm: v.oilLastKm, tyreEvery: v.tyreEvery, tyreLastKm: v.tyreLastKm, regExp: v.regExp, insExp: v.insExp, techExp: v.techExp,
      } : { plate: String(r.plate).trim(), name: x.name || null }),
      rent: true, rClass: x.rClass || v?.rClass || null,
      rDay: num('rDay', v?.rDay), rWeek: num('rWeek', v?.rWeek), rDep: num('rDep', v?.rDep), rKm: num('rKm', v?.rKm), rKmX: num('rKmX', v?.rKmX),
    });
    n++;
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'rcFleetImport', entityType: 'fleet_vehicle', data: { rows: n, skipped: skip.length } });
  return summary(n, skip, 'возила');
}

/** Rentals with calculation and revenue (`rcCalc` + `rcRev`) for the `rentIzv` tabs. */
export async function rentReportRows(tx: Tx, firmId: string): Promise<RentReportRow[]> {
  const f = await loadIndustryFirm(tx, firmId);
  const C = firmRentConfig(f);
  const R = await tx.select().from(rentRentals).where(and(eq(rentRentals.firmId, firmId), ne(rentRentals.status, 'cancel')));
  const V = await tx.select().from(fleetVehicles).where(eq(fleetVehicles.firmId, firmId));
  const invIds = R.map((r) => r.invoiceId).filter((x): x is string => !!x);
  const I = invIds.length ? await tx.select({ id: invoices.id, number: invoices.number, base: invoices.base, total: invoices.total }).from(invoices).where(inArray(invoices.id, invIds)) : [];
  const pay = await documentPayments(tx, firmId, { invoiceIds: invIds });
  const pIds = [...new Set(R.map((r) => r.partnerId).filter((x): x is string => !!x))];
  const P = pIds.length ? await tx.select({ id: partners.id, name: partners.name }).from(partners).where(inArray(partners.id, pIds)) : [];
  return R.map((r) => {
    const v = V.find((x) => x.id === r.vehicleId);
    const k = rcCalc(r, v ? vehicleRates(v) : {}, C);
    const inv = I.find((i) => i.id === r.invoiceId);
    const rv = rentRevenue(k.tot, C.rate, inv ? { base: Number(inv.base), total: pay.get(inv.id)?.total ?? Number(inv.total), paid: pay.get(inv.id)?.paid ?? 0, number: inv.number } : null);
    return {
      id: r.id, number: r.number, plate: r.plate, from: r.from, to: r.to, status: r.status, retAt: r.ret?.at ?? null,
      driver: { name: r.driver.name, phone: r.driver.phone, nat: r.driver.nat, docExp: r.driver.docExp, licExp: r.driver.licExp },
      partnerId: r.partnerId, partnerName: P.find((p) => p.id === r.partnerId)?.name ?? null, countries: r.countries ?? ['MK'], green: r.green,
      deposit: Number(r.deposit) || 0, depositIn: !!r.depositVoucherId, depositClosed: r.depositClosed,
      days: k.days, tot: k.tot, km: k.km, ...rv,
    };
  });
}
