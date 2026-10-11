import { PGlite } from '@electric-sql/pglite';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import {
  deleteWorkOrder, firmAutoConfig, invoiceWorkOrder, liveVehicles, markVehicleReminded, orderTrack, recordPosition, saveAutoConfig, saveCustomerVehicle,
  saveFirmModules, saveTravelOrder, saveVehicle, saveWorkOrder, stockOnHand, travelOrderEvent, IndustryError, type IndActor,
} from './industry/index';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
const tx = <T>(f: (t: DB) => Promise<T>) => db.transaction((t) => f(t as unknown as DB));
const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected an error'); };
let A: IndActor, cust = '', part = '', svc = '', emp = '';

/**
 * The tables of `schema/vehicles.ts` have no migration on this branch yet (the coordinator generates it): create
 * them from the schema diff when the migrations did not.
 */
async function ensureVehicleTables() {
  const [r] = (await db.execute(sql`select to_regclass('public.work_orders') as t`)).rows as { t: string | null }[];
  if (r?.t) return;
  const { generateDrizzleJson, generateMigration } = await import('drizzle-kit/api');
  const { customerVehicles, workOrders, travelPositions, ...rest } = schema;
  void customerVehicles; void workOrders; void travelPositions;
  const prev = generateDrizzleJson(rest as Record<string, unknown>);
  const cur = generateDrizzleJson(schema as unknown as Record<string, unknown>);
  for (const s of await generateMigration(prev, cur)) await db.execute(sql.raw(s));
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await ensureVehicleTables();
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Авто Сервис ДООЕЛ', edb: '4030000000888' }).returning();
  A = { firmId: f!.id, userId: null, role: 'acc' };
  const [p] = await db.insert(schema.partners).values({ firmId: A.firmId, name: 'Петар Петров', phone: '070123456', email: 'p@example.mk' }).returning();
  cust = p!.id;
  const I = await db.insert(schema.items).values([
    { firmId: A.firmId, code: 'F-1', name: 'Филтер масло', type: 'goods', vatRate: 18, price: '500', oe: '03L115562' },
    { firmId: A.firmId, name: 'Замена масло и филтри', type: 'service', vatRate: 18, price: '800' },
  ]).returning();
  part = I[0]!.id; svc = I[1]!.id;
  const [e] = await db.insert(schema.employees).values({ firmId: A.firmId, name: 'Механичар Марко' }).returning();
  emp = e!.id;
}, 120_000);

describe('auto service', () => {
  let veh = '', wo = '';
  it('is gated by the module for client users (the office works every module, legacy viewOn)', async () => {
    expect(await err(tx((t) => saveCustomerVehicle(t, { ...A, role: 'klient' }, { plate: 'SK-1234-AB' })))).toBeInstanceOf(IndustryError);
    await tx((t) => saveFirmModules(t, A, ['auto', 'pn']));
  });
  it('customer vehicles: plate or VIN, no duplicates', async () => {
    veh = await tx((t) => saveCustomerVehicle(t, A, { plate: 'sk-1234-ab', vin: 'wvwzzz1kz8w000001', make: 'Volkswagen', model: 'Golf', year: 2008, partnerId: cust, km: 150000 }));
    const [v] = await db.select().from(schema.customerVehicles).where(eq(schema.customerVehicles.id, veh));
    expect(v!.plate).toBe('SK-1234-AB');
    expect(v!.vin).toBe('WVWZZZ1KZ8W000001');
    expect((await err(tx((t) => saveCustomerVehicle(t, A, { plate: 'SK 1234 AB' })))).message).toMatch(/веќе постои/);
    expect((await err(tx((t) => saveCustomerVehicle(t, A, {})))).message).toMatch(/таблица или VIN/);
  });
  it('work order: numbering, vehicle km raised, frozen after the invoice', async () => {
    await db.insert(schema.stockMoves).values({ firmId: A.firmId, itemId: part, date: '2026-01-01', qty: '1', value: '300', direction: 'in', kind: 'opening' as never, sourceType: 'opening', sourceId: 'o1' });
    expect((await stockOnHand(db as never, A.firmId, [part])).get(part)).toBe(1);
    const x = await tx((t) => saveWorkOrder(t, A, {
      date: '2026-10-01', vehicleId: veh, partnerId: cust, km: 152000, complaint: 'Сервис', mechanicId: emp, status: 'work',
      parts: [{ itemId: part, name: 'Филтер масло', qty: 2, price: 500, disc: 10, rate: 18 }], labour: [{ itemId: svc, name: 'Замена масло и филтри', hrs: 1, price: 1000, rate: 18 }],
      nextKm: 167000, nextNote: 'Редовен сервис',
    }));
    wo = x.id;
    expect(x.number).toBe('РН-001/2026');
    const [v] = await db.select().from(schema.customerVehicles).where(eq(schema.customerVehicles.id, veh));
    expect(v!.km).toBe(152000);
    expect((await err(tx((t) => invoiceWorkOrder(t, A, wo, '2026-10-02')))).message).toMatch(/Нема доволно залиха за: Филтер масло/);
    const inv = await tx((t) => invoiceWorkOrder(t, A, wo, '2026-10-02', true));
    const [i] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, inv.id));
    // parts 2·500·0.9 = 900 + labour 1000 = 1900 + 18 % VAT
    expect(Number(i!.base)).toBe(1900);
    expect(Number(i!.total)).toBe(2242);
    expect(i!.data.source).toEqual({ type: 'work_order', id: wo });
    const L = await db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, inv.id));
    expect(L.map((l) => [l.name, Number(l.qty), Number(l.disc)])).toEqual([['Филтер масло', 2, 10], ['Работа: Замена масло и филтри', 1, 0]]);
    expect((await stockOnHand(db as never, A.firmId, [part])).get(part)).toBe(-1);
    const [w] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.id, wo));
    expect([w!.status, w!.invoiceId]).toEqual(['done', inv.id]);
    expect((await err(tx((t) => saveWorkOrder(t, A, { id: wo, date: '2026-10-01', vehicleId: veh, partnerId: cust, parts: [], labour: [] })))).message).toMatch(/фактуриран/);
    expect((await err(tx((t) => deleteWorkOrder(t, A, wo)))).message).toMatch(/фактуриран/);
  });
  it('taken number → next free; empty order cannot be invoiced; delete', async () => {
    const y = await tx((t) => saveWorkOrder(t, A, { number: 'РН-001/2026', date: '2026-10-05', vehicleId: veh, partnerId: cust, parts: [], labour: [] }));
    expect(y.number).toBe('РН-002/2026');
    expect((await err(tx((t) => invoiceWorkOrder(t, A, y.id, '2026-10-05')))).message).toMatch(/Нема делови/);
    await tx((t) => deleteWorkOrder(t, A, y.id));
    expect(await db.select().from(schema.workOrders).where(eq(schema.workOrders.id, y.id))).toHaveLength(0);
  });
  it('config and reminder contact', async () => {
    await tx((t) => saveAutoConfig(t, A, { hr: 1200, km: 10000, mon: 6 }));
    const [f] = await db.select().from(schema.firms).where(eq(schema.firms.id, A.firmId));
    expect(firmAutoConfig(f!)).toEqual({ hr: 1200, km: 10000, mon: 6 });
    await tx((t) => markVehicleReminded(t, A, veh, '2026-10-10'));
    const [v] = await db.select().from(schema.customerVehicles).where(eq(schema.customerVehicles.id, veh));
    expect(v!.remindAt).toBe('2026-10-10');
    const au = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.firmId, A.firmId), eq(schema.auditLog.action, 'potDone')));
    expect(au).toHaveLength(1);
  });
});

describe('vehicles live and the driver flow', () => {
  it('stores positions of orders on the road, signature and photo on the stop', async () => {
    const [u] = await db.insert(schema.users).values({ username: 'vozac1', name: 'Возач', role: 'teren', passwordHash: 'x' }).returning();
    const fv = await tx((t) => saveVehicle(t, A, { plate: 'SK-5555-AA', name: 'Iveco' }));
    const o = await tx((t) => saveTravelOrder(t, A, { date: '2026-10-10', vehicleId: fv, driverId: emp, assigneeId: u!.id, stops: [{ kind: 'deliv', doc: 'Рачно', partner: 'Купувач', goods: [], status: 'open' }] }));
    const pos = { lat: 41.9981, lon: 21.4254, acc: 8, spd: 50, at: new Date().toISOString() };
    expect(await tx((t) => recordPosition(t, u!, [o.id], pos, () => false))).toBe(0); // still `open`
    await tx((t) => travelOrderEvent(t, A, o.id, { k: 'dep', km: 1000 }, new Date().toISOString(), 'Возач', { lat: 41.99, lon: 21.42 }));
    expect(await tx((t) => recordPosition(t, u!, [o.id], pos, () => false))).toBe(1);
    expect(await tx((t) => recordPosition(t, { id: 'x' }, [o.id], pos, () => false))).toBe(0); // not the assignee
    expect((await err(tx((t) => recordPosition(t, u!, [o.id], { ...pos, lat: 200 }, () => true)))).message).toMatch(/локација/);
    const L = await liveVehicles(db as never, A.firmId);
    expect(L.map((x) => [x.o.plate, x.pos?.spd])).toEqual([['SK-5555-AA', 50]]);
    expect(await orderTrack(db as never, A.firmId, o.id)).toHaveLength(1);
    await tx((t) => travelOrderEvent(t, A, o.id, { k: 'deliv', i: 0, recv: 'Ана', sig: 'file-sig', photo: 'file-ph' }, new Date().toISOString(), 'Возач', { lat: 41.5, lon: 21.5 }));
    const [x] = await db.select().from(schema.travelOrders).where(eq(schema.travelOrders.id, o.id));
    const s = (x!.stops as unknown as { sig: string; photo: string; geo: unknown }[])[0]!;
    expect([s.sig, s.photo, s.geo]).toEqual(['file-sig', 'file-ph', { lat: 41.5, lon: 21.5 }]);
  });
});
