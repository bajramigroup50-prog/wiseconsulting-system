import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { createDefaultRegisters } from './bank/cash';
import { savePurchase } from './sales/purchases';
import { saveBom } from './stock-docs';
import {
  addBookingPayment, checkIn, checkOut, invoiceAppointment, invoiceBooking, invoiceFreightTours, invoiceRental, invoiceReservation, invoiceSituation,
  issueReservationAdvance, payOrder, postTravelCash, postTravelVat, receiveDeposit, returnVehicle, handOut, saveAppointment, saveArrangement, saveBooking,
  saveFirmModules, saveFreightTour, saveOrder, saveProject, saveRental, saveReservation, saveRoom, saveSituation, saveTable, saveTravelOrder, saveVehicle,
  settleBookingAdvance, settleDeposit, travelMarginInputs, travelOrderEvent, IndustryError, type IndActor,
} from './industry/index';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
const tx = <T>(f: (t: DB) => Promise<T>) => db.transaction((t) => f(t as unknown as DB));
const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected an error'); };
let A: IndActor, cust = '', sup = '', emp = '', goods = '', dish = '', flour = '', svc = '';

async function journal(sourceType: string, sourceId: string) {
  const [j] = await db.select().from(schema.journals).where(and(eq(schema.journals.sourceType, sourceType), eq(schema.journals.sourceId, sourceId)));
  if (!j) return null;
  const L = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j.id));
  const by: Record<string, number> = {};
  for (const l of L) by[l.account] = Math.round(((by[l.account] ?? 0) + Number(l.debit) - Number(l.credit)) * 100) / 100;
  return { j, by };
}
const invoice = async (id: string) => (await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)))[0]!;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Дејности ДООЕЛ', edb: '4030000000777' }).returning();
  A = { firmId: f!.id, userId: null, role: 'acc' };
  const P = await db.insert(schema.partners).values([{ firmId: A.firmId, name: 'Фирма купувач' }, { firmId: A.firmId, name: 'Хотел Алпи', edb: '4030999000222' }]).returning();
  cust = P[0]!.id; sup = P[1]!.id;
  const [e] = await db.insert(schema.employees).values({ firmId: A.firmId, name: 'Возач Петров' }).returning();
  emp = e!.id;
  const I = await db.insert(schema.items).values([
    { firmId: A.firmId, name: 'Брашно', type: 'material', unit: 'кг', vatRate: 5 },
    { firmId: A.firmId, name: 'Пица', type: 'product', vatRate: 10, data: { sp: { main: 450 } } },
    { firmId: A.firmId, name: 'Масажа', type: 'service', vatRate: 18 },
    { firmId: A.firmId, name: 'Стока', type: 'goods', vatRate: 18 },
  ]).returning();
  flour = I[0]!.id; dish = I[1]!.id; svc = I[2]!.id; goods = I[3]!.id;
  await tx((t) => createDefaultRegisters(t, { firmId: A.firmId, userId: null }));
}, 60_000);

describe('module toggle', () => {
  it('services refuse a switched-off module', async () => {
    const e = await err(tx((t) => saveRoom(t, A, { no: '101', price: 3150 })));
    expect(e).toBeInstanceOf(IndustryError);
    await tx((t) => saveFirmModules(t, A, ['hotel', 'rent', 'tour', 'cons', 'appt', 'rest', 'pn', 'frt']));
  });
});

describe('hotel', () => {
  it('reservation → advance invoice → check-in/out → final invoice deducts the advance (FIX 10.4 item 11)', async () => {
    const room = await tx((t) => saveRoom(t, A, { no: '101', price: 3150, beds: 2 }));
    const r = await tx((t) => saveReservation(t, A, { roomId: room, from: '2026-07-01', to: '2026-07-04', guestName: 'Марко', adults: 2, advance: 2100, partnerId: cust }));
    expect(r.number).toBe('Р-001/2026');
    const clash = await err(tx((t) => saveReservation(t, A, { roomId: room, from: '2026-07-03', to: '2026-07-05', guestName: 'Друг' })));
    expect(clash.message).toMatch(/зафатена/);
    const adv = await tx((t) => issueReservationAdvance(t, A, r.id, '2026-06-20'));
    expect((await invoice(adv.id)).advance).toBe(true);
    await expect(tx((t) => checkIn(t, A, r.id, '2026-07-01'))).rejects.toThrow(/гостите/);
    await tx((t) => saveReservation(t, A, { id: r.id, roomId: room, from: '2026-07-01', to: '2026-07-04', guestName: 'Марко', adults: 2, advance: 2100, partnerId: cust, guests: [{ name: 'Марко', birth: '1990-01-01', nat: 'DE', docNo: 'X1' }, { name: 'Ана', birth: '1992-01-01', nat: 'MK', docNo: 'Y2' }] }));
    expect((await tx((t) => checkIn(t, A, r.id, '2026-07-01'))).foreigners).toBe(1);
    await tx((t) => checkOut(t, A, r.id, '2026-07-04'));
    const inv = await tx((t) => invoiceReservation(t, A, r.id, '2026-07-04'));
    const I = await invoice(inv.id);
    // 3 nights × 3150 + tourist tax 2 × 3 × 40 = 9690 gross
    expect(Number(I.total)).toBeCloseTo(9690, 1);
    const J = (await journal('invoice', inv.id))!;
    expect(J.by['2399']).toBe(-240);
    expect(J.by['2220']).toBe(2000); // advance base reversed
    const [rm] = await db.select().from(schema.hotelRooms).where(eq(schema.hotelRooms.id, room));
    expect(rm!.hk).toBe('dirty');
  });
});

describe('rent-a-car', () => {
  it('deposit receipt → handover → return → invoice → deposit offset + refund', async () => {
    const v = await tx((t) => saveVehicle(t, A, { plate: 'sk-1234-ab', name: 'Golf', rent: true, rDay: 2360, rDep: 10000, rKm: 200, rKmX: 10 }));
    const r = await tx((t) => saveRental(t, A, { vehicleId: v, from: '2026-07-01T09:00', to: '2026-07-04T09:00', driver: { name: 'Јован', birth: '1990-01-01', doc: 'A1', lic: 'L1', phone: '070111222' } }));
    await tx((t) => receiveDeposit(t, A, r.id, '2026-07-01'));
    await tx((t) => handOut(t, A, r.id, { km: 1000, fuel: 8 }, '2026-07-01T09:10', '2026-07-01'));
    const due = await tx((t) => returnVehicle(t, A, r.id, { km: 1700, fuel: 8 }, '2026-07-04T10:00'));
    expect(due).toBe(3 * 2360 + 100 * 10);
    const inv = await tx((t) => invoiceRental(t, A, r.id, '2026-07-04'));
    expect(Number((await invoice(inv.id)).total)).toBeCloseTo(due, 1);
    const s = await tx((t) => settleDeposit(t, A, r.id, due, '2026-07-04'));
    expect(s).toEqual({ kept: due, back: 10000 - due });
    const J = (await journal('rent_deposit', r.id))!;
    expect(J.j.kind).toBe('kauc');
    expect(J.by['2222']).toBe(due);
    const [veh] = await db.select().from(schema.fleetVehicles).where(eq(schema.fleetVehicles.id, v));
    expect(veh!.odo).toBe(1700);
  });
});

describe('travel agency', () => {
  it('own arrangement: noDed purchase, payment, margin invoice with tourM, Phase 5 inputs, advance offset and margin VAT', async () => {
    const p = await tx((t) => savePurchase(t, A.firmId, { number: 'H-1', date: '2026-07-01', partnerId: sup, ptype: 'cost', groups: [{ account: '4400', rate: 5, base: 40000, vat: 2000 }] }, A));
    const x = await tx((t) => saveArrangement(t, A, { name: 'Охрид', kind: 'own', price: 30000, from: '2026-08-01', to: '2026-08-05', costs: [{ cat: 'Сместување (хотел)', purchaseId: p.id }, { cat: 'Сопствена услуга на агенцијата (не е претходна)', amt: 3000 }] }));
    const [pur] = await db.select().from(schema.purchases).where(eq(schema.purchases.id, p.id));
    expect(pur!.noDed).toBe(true);
    const b = await tx((t) => saveBooking(t, A, { arrangementId: x.id, client: { name: 'Патник', phone: '070000000' }, adults: 2 }));
    await tx((t) => addBookingPayment(t, A, b.id, { date: '2026-07-10', amt: 20000, how: 'cash' }));
    const inv = await tx((t) => invoiceBooking(t, A, b.id, '2026-08-05'));
    const I = await invoice(inv.id);
    expect(I.data).toMatchObject({ tourM: true, arrangementId: x.id });
    expect(Number(I.vat)).toBe(0);
    const f = (await db.select().from(schema.firms).where(eq(schema.firms.id, A.firmId)))[0]!;
    const M = await tx((t) => travelMarginInputs(t, f));
    expect(M.arrangements![x.id]).toEqual({ rev: 60000, cost: 42000, own: 3000 });
    expect(await tx((t) => settleBookingAdvance(t, A, b.id, '2026-08-05'))).toBe(20000);
    const vat = await tx((t) => postTravelVat(t, A, '2026-Т3'));
    // margin 60000 − 42000 − 3000 = 15000 → 2288.14; own 3000 → 457.63
    expect(vat).toBeCloseTo(2288.14 + 457.63, 1);
    expect((await journal('travel_vat', '2026-Т3'))!.by['230018']).toBeCloseTo(-vat, 2);
  });
});

describe('construction', () => {
  it('situation → invoice of this situation’s quantities (art. 32-a project)', async () => {
    const P = await tx((t) => saveProject(t, A, { name: 'Зграда', investorId: cust, art32: true, boq: [{ desc: 'Ископ', unit: 'м3', qty: 100, price: 450 }, { desc: 'Бетон', unit: 'м3', qty: 10, price: 6000 }] }));
    expect(P.code).toBe(`О-001/${new Date().getFullYear()}`);
    await tx((t) => saveSituation(t, A, { projectId: P.id, no: '1', kind: 'int', date: '2026-03-31', cum: { 0: 40 } }));
    const s2 = await tx((t) => saveSituation(t, A, { projectId: P.id, no: '2', kind: 'int', date: '2026-04-30', cum: { 0: 100, 1: 2 } }));
    const inv = await tx((t) => invoiceSituation(t, A, s2, '2026-04-30'));
    const I = await invoice(inv.id);
    expect(I.art32).toBe(true);
    expect(Number(I.base)).toBe(60 * 450 + 2 * 6000);
  });
});

describe('restaurant and appointments', () => {
  it('pay a bill = POS sale + BOM components issued, bill closed (FIX 10.4 item 10)', async () => {
    await tx((t) => savePurchase(t, A.firmId, { number: 'B-1', date: '2026-07-01', partnerId: sup, ptype: 'stock', groups: [{ account: '3100', rate: 5, base: 1000, vat: 50 }], stock: [{ itemId: flour, qty: 100, price: 10 }] }, A));
    await tx((t) => saveBom(t, { firmId: A.firmId, userId: null }, { productId: dish, labor: 0, lines: [{ itemId: flour, qty: 0.3 }] }));
    const table = await tx((t) => saveTable(t, A, null, { no: '1', area: 'Сала', seats: 4 }));
    const o = await tx((t) => saveOrder(t, A, table, [{ itemId: dish, name: 'Пица', qty: 2, price: 450, rate: 10 }], 'Келнер', '2026-07-05T20:00'));
    const r = await tx((t) => payOrder(t, A, o!, { date: '2026-07-05', now: '2026-07-05T21:00' }));
    expect(r.total).toBe(900);
    const M = await db.select().from(schema.stockMoves).where(and(eq(schema.stockMoves.sourceType, 'sales_daily'), eq(schema.stockMoves.sourceId, r.salesDayId)));
    expect(M.map((m) => [m.itemId, Number(m.qty)])).toEqual([[flour, -0.6]]);
    await expect(tx((t) => payOrder(t, A, o!, { date: '2026-07-05', now: '' }))).rejects.toThrow(/затворена/);
  });
  it('appointment → invoice at the service rate from the gross price', async () => {
    const x = await tx((t) => saveAppointment(t, A, { date: '2026-07-06', time: '10:00', dur: 60, res: 'r1', client: 'Нов клиент', svc: 'Масажа', itemId: svc, price: 1180 }));
    const c = await tx((t) => saveAppointment(t, A, { date: '2026-07-06', time: '10:30', res: 'r1', client: 'Друг' }));
    expect(c.clash).toBe('10:00');
    const inv = await tx((t) => invoiceAppointment(t, A, x.id, '2026-07-06'));
    const I = await invoice(inv.id);
    expect([Number(I.base), Number(I.total)]).toEqual([1000, 1180]);
  });
});

describe('transport', () => {
  it('travel orders persist in their own table (FIX 10.4 item 1) and cash on delivery is booked on the customer konto', async () => {
    const v = await tx((t) => saveVehicle(t, A, { plate: 'SK-5555-AA', name: 'Камион' }));
    const notes0 = await db.select().from(schema.payrollNotes);
    const o = await tx((t) => saveTravelOrder(t, A, { date: '2026-07-07', vehicleId: v, driverId: emp, stops: [{ kind: 'deliv', doc: 'Рачно', partner: 'Фирма купувач', partnerId: cust, goods: [], status: 'open' }] }));
    expect(o.number).toBe('001/2026');
    expect(await db.select().from(schema.payrollNotes)).toEqual(notes0);
    await tx((t) => travelOrderEvent(t, A, o.id, { k: 'dep', km: 500 }, '2026-07-07T08:00:00Z', null));
    await tx((t) => travelOrderEvent(t, A, o.id, { k: 'deliv', i: 0, recv: 'Примач', cash: 1500 }, '2026-07-07T10:00:00Z', null));
    await tx((t) => travelOrderEvent(t, A, o.id, { k: 'ret', km: 620, fuelL: 20 }, '2026-07-07T16:00:00Z', null));
    expect(await tx((t) => postTravelCash(t, A, o.id))).toBe(1);
    const [row] = await db.select().from(schema.travelOrders).where(eq(schema.travelOrders.id, o.id));
    expect(row!.status).toBe('done');
    const vid = (row!.stops[0] as { cashVoucherId: string }).cashVoucherId;
    expect((await journal('cash_voucher', vid))!.by['1200']).toBe(-1500);
  });
  it('freight tours → one invoice in EUR at 0%', async () => {
    const t1 = await tx((t) => saveFreightTour(t, A, { number: 'Т-001/2026', date: '2026-07-01', partnerId: cust, price: 1200, cur: 'EUR', fx: 61.5, vat: 'intl', segs: [] }));
    const t2 = await tx((t) => saveFreightTour(t, A, { number: 'Т-002/2026', date: '2026-07-03', partnerId: cust, price: 800, cur: 'EUR', fx: 61.5, vat: 'intl', segs: [] }));
    await expect(tx((t) => saveFreightTour(t, A, { number: 'Т-001/2026', date: '2026-07-03', partnerId: cust }))).rejects.toThrow(/постои/);
    const inv = await tx((t) => invoiceFreightTours(t, A, [t1, t2], '2026-07-05', async () => 61.5));
    const I = await invoice(inv.id);
    expect([I.currency, Number(I.total), Number(I.vat)]).toEqual(['EUR', 2000, 0]);
    void goods;
  });
});
