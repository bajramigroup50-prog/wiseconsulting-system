/**
 * Workflow 8 — industry modules through their screen actions: hotel reservation → check-in/out → invoice; rent-a-car
 * contract → handover / return → draft invoice in the editor; travel order whose stops come from the day's invoices;
 * production through the invoice editor („Производство = Да“).
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { todaySkopje } from '@wise/core/office/dates';
import { savePurchase, schema } from '@wise/db';
import { act, form, pg, r2, setupDb, signIn, useFirm } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));

const hotel = await import('@/app/(app)/hotel/actions');
const rent = await import('@/app/(app)/rent/actions');
const pn = await import('@/app/(app)/pnalozi/actions');
const { saveInvoiceAction } = await import('@/app/(app)/izlez/actions');

const today = todaySkopje(); // the actions date documents in Skopje time
const plus = (d: number) => new Date(Date.parse(today + 'T12:00:00Z') + d * 864e5).toISOString().slice(0, 10);
let firmId = '', cust = '', wood = '', table = '', coffee = '';
const inv = async (id: string) => (await pg.select().from(schema.invoices).where(eq(schema.invoices.id, id)))[0]!;
const journalBy = async (sourceType: string, sourceId: string) => {
  const [j] = await pg.select().from(schema.journals).where(and(eq(schema.journals.sourceType, sourceType), eq(schema.journals.sourceId, sourceId)));
  if (!j) return null;
  const L = await pg.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j.id));
  const by: Record<string, number> = {};
  for (const l of L) by[l.account] = r2((by[l.account] ?? 0) + Number(l.debit) - Number(l.credit));
  return by;
};
/** Invoice payload of the editor (`izlez` form → `saveInvoiceAction`). */
const payload = (o: Record<string, unknown>) => ({
  id: null, kind: 'invoice', number: '', date: today, pdate: '', due: '', partnerId: cust, warehouseId: '', art32: false, advance: false, export: false, svc: false,
  currency: 'MKD', fx: '1', refInvoiceId: '', creditKind: 'price', creditGross: '', fromDocId: '', note: '', data: {}, lines: [], advances: [], ...o,
});

beforeAll(async () => {
  await setupDb();
  const [f] = await pg.insert(schema.firms).values({ name: 'ДЕЈНОСТИ ДООЕЛ', edb: '4030026000777', city: 'Охрид', address: 'Кеј 1', mods: ['hotel', 'rent', 'pn', 'prod'] }).returning();
  firmId = f!.id;
  const [c] = await pg.insert(schema.partners).values({ firmId, name: 'Туроператор ДОО', edb: '4030026000555', address: 'ул. 1', city: 'Скопје' }).returning();
  cust = c!.id;
  const I = await pg.insert(schema.items).values([
    { firmId, name: 'Штица', code: '100', type: 'material', vatRate: 18 },
    { firmId, name: 'Маса', code: '200', type: 'product', vatRate: 18, price: '5000' },
    { firmId, name: 'Кафе 1кг', code: '300', type: 'goods', vatRate: 18, price: '1000', weight: '1' },
  ]).returning();
  wood = I[0]!.id; table = I[1]!.id; coffee = I[2]!.id;
  await pg.insert(schema.employees).values({ firmId, name: 'Возач Петров', no: '1' });
  await pg.transaction((tx) => savePurchase(tx as never, firmId, { number: 'P-1', date: '2026-01-05', partnerId: cust, ptype: 'stock', groups: [{ account: '3100', rate: 18, base: 1000, vat: 180 }, { account: '6600', rate: 18, base: 6000, vat: 1080 }], stock: [{ itemId: wood, qty: 10, price: 100, type: 'material' }, { itemId: coffee, qty: 10, price: 600 }] }, { userId: null, role: 'acc' }));
  await signIn('admin');
  useFirm(firmId);
}, 120_000);

describe('flow 8 — industry', () => {
  it('hotel: reservation → check-in → check-out → invoice with the tourist tax', async () => {
    expect((await hotel.saveRoomAction({}, form({ no: '101', kind: 'двокреветна', beds: '2', price: '3000', active: true }))).error).toBeUndefined();
    const [room] = await pg.select().from(schema.hotelRooms).where(eq(schema.hotelRooms.firmId, firmId));
    const r = await act(hotel.saveReservationAction({}, form({
      room: room!.id, from: today, to: plus(2), guestName: 'Марко Марковски', adults: '2', partner: cust,
      'g.name.0': 'Марко Марковски', 'g.birth.0': '1985-05-05', 'g.nat.0': 'MK', 'g.docNo.0': 'A123', 'g.name.1': 'Ана Марковска', 'g.birth.1': '1987-06-06', 'g.nat.1': 'MK', 'g.docNo.1': 'B456',
    })));
    expect(r).toMatchObject({ redirect: expect.stringMatching(/^\/hotel\?id=/) });
    const [res] = await pg.select().from(schema.hotelReservations).where(eq(schema.hotelReservations.firmId, firmId));
    expect((await hotel.reservationStepAction(res!.id, 'in')).error).toBeUndefined();
    expect((await hotel.reservationStepAction(res!.id, 'out')).error).toBeUndefined();
    const s = await hotel.reservationStepAction(res!.id, 'inv');
    expect(s.error).toBeUndefined();
    expect(s.ok).toMatch(/Издадена е фактура/);
    const [r2row] = await pg.select().from(schema.hotelReservations).where(eq(schema.hotelReservations.id, res!.id));
    const I = await inv(r2row!.invoiceId!);
    expect(I.status).toBe('posted');
    expect(I.partnerId).toBe(cust);
    // checked out today: the stay is billed from the arrival to the check-out (one night minimum) + tourist tax per guest-night
    const by = (await journalBy('invoice', I.id))!;
    expect(by['1200']).toBe(Number(I.total));
    expect(by['2399']).toBeLessThan(0);
  });

  it('rent-a-car: contract → handover → return → the invoice opens as a draft in the editor', async () => {
    expect((await rent.saveVehicleAction({}, form({ plate: 'OH-1234-AB', name: 'Škoda Octavia', rent: true, rDay: '2360', rDep: '10000', rKm: '300', rKmX: '10', odo: '50000' }))).error).toBeUndefined();
    const [v] = await pg.select().from(schema.fleetVehicles).where(eq(schema.fleetVehicles.firmId, firmId));
    const r = await act(rent.saveRentalAction({}, form({ veh: v!.id, from: `${today}T09:00`, to: `${plus(3)}T09:00`, partner: cust, 'd_name': 'Јован Јовановски', 'd_birth': '1990-01-01', 'd_doc': 'P1', 'd_lic': 'L1', 'd_phone': '070111222' })));
    expect(r).toMatchObject({ redirect: expect.stringMatching(/^\/rent\?id=/) });
    const [ren] = await pg.select().from(schema.rentRentals).where(eq(schema.rentRentals.firmId, firmId));
    expect((await rent.handoverAction({}, form({ id: ren!.id, kind: 'out', km: '50000', fuel: '8' }))).error).toBeUndefined();
    const back = await rent.handoverAction({}, form({ id: ren!.id, kind: 'ret', km: '50500', fuel: '8' }));
    expect(back.error).toBeUndefined();
    const go = await act(rent.rentalStepAction(ren!.id, 'inv'));
    expect(go).toMatchObject({ redirect: expect.stringMatching(/^\/izlez\?edit=/) });
    const id = (go as { redirect: string }).redirect.split('edit=')[1]!;
    const I = await inv(id);
    expect(I.status).toBe('draft');
    expect(I.partnerId).toBe(cust);
    expect(Number(I.total)).toBeGreaterThan(0);
    expect(await journalBy('invoice', id)).toBeNull(); // nothing booked until the user saves it
  });

  it('travel order: the day\'s unassigned invoices become its stops', async () => {
    const a = await act(saveInvoiceAction({}, form({ payload: JSON.stringify(payload({ lines: [{ itemId: coffee, code: '300', name: 'Кафе 1кг', unit: 'ком', qty: '3', price: '1000', disc: '0', rate: '18', account: '' }] })) })));
    expect(a).toMatchObject({ redirect: expect.stringMatching(/^\/izlez\?saved=/) });
    const r = await act(pn.travelOrderFromDayAction({}, form({ date: today })));
    expect(r).toMatchObject({ redirect: expect.stringMatching(/^\/pnalozi\?id=/) });
    const [o] = await pg.select().from(schema.travelOrders).where(eq(schema.travelOrders.firmId, firmId));
    const stops = o!.stops as { ref?: { type: string; id: string }; partnerId?: string }[];
    expect(stops.length).toBeGreaterThanOrEqual(1);
    const st = stops.find((s) => s.ref?.type === 'invoice') as { partnerId?: string; goods: { itemId: string; qty: number }[]; open?: number } | undefined;
    expect(st?.partnerId).toBe(cust);
    expect(st!.goods.map((g) => [g.itemId, Number(g.qty)])).toEqual([[coffee, 3]]);
  });

  it('production from the invoice editor (Производство = Да): materials out, product in at cost, sold', async () => {
    const r = await act(saveInvoiceAction({}, form({ payload: JSON.stringify(payload({
      data: { prod: 'Д' },
      lines: [{ itemId: table, code: '200', name: 'Маса', unit: 'ком', qty: '2', price: '5000', disc: '0', rate: '18', account: '' }],
      production: { wh: null, extra: '100', saveBom: true, lines: [{ lineNo: 0, productId: table, qty: '2', materials: [{ itemId: wood, qty: '4' }] }] },
    })) })));
    expect(r).toMatchObject({ redirect: expect.stringMatching(/^\/izlez\?saved=/) });
    const id = new URLSearchParams((r as { redirect: string }).redirect.split('?')[1]).get('saved')!;
    const I = await inv(id);
    expect((I.data as { prodCost?: string }).prodCost).toBe('500.00'); // 4 × 100 + 100
    const qty = async (item: string) => (await pg.select().from(schema.stockMoves).where(eq(schema.stockMoves.itemId, item))).reduce((s, m) => s + Number(m.qty), 0);
    expect(await qty(wood)).toBe(6);
    expect(await qty(table)).toBe(0);
    const [bom] = await pg.select().from(schema.boms).where(eq(schema.boms.productId, table));
    expect(bom!.lines).toEqual([{ itemId: wood, qty: 2 }]);
    expect((await journalBy('invoice', id))!['1200']).toBe(11800);
  });
});
