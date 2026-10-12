/**
 * Fiscal device flow of the till through the real server actions, with the desktop SIMULATOR driver behind a fake
 * `window.wiseFiscal`: detection, POS sale → pending receipt → printed → device number recorded; paper out → failed →
 * printed again (sale not booked twice); device printed but the save failed → „Зачувај го бројот“; storno; Z report.
 */
import { createRequire } from 'node:module';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { todaySkopje } from '@wise/core/office/dates';
import { savePurchase, schema } from '@wise/db';
import { fiscalBridge, type WiseFiscal } from '@/lib/fiscal-bridge';
import { pg, setupDb, signIn, useFirm } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));

const F = await import('@/app/(app)/kasa/fiscal-actions');
const { printFiscal, saveAgain } = await import('@/app/(app)/kasa/fiscal-flow');
const { SimulatorDriver } = createRequire(import.meta.url)('../../../../desktop/fiscal/drivers/simulator.js');

const today = todaySkopje();
let firmId = '', coffee = '', bread = '';

/** `window.wiseFiscal` as the desktop preload exposes it, backed by the desktop simulator driver. */
function fakeBridge(fault = ''): WiseFiscal & { sim: { s: { receipt: number } } } {
  const sim = new SimulatorDriver({ fault, now: () => new Date(2026, 9, 12, 10, 0, 0) });
  const dev = { vendor: 'sim', model: 'SIM', driver: 'sim' };
  const ok = <T extends object>(p: Promise<T>) => p.then((r) => ({ ...r, device: dev })).catch((e: { code: string; message: string }) => ({ ok: false, code: e.code, error: e.message }));
  const w = { wiseFiscal: {
    version: 1, sim,
    status: () => sim.status(), printReceipt: (r: unknown) => ok(sim.printReceipt(r)), printStorno: (r: unknown) => ok(sim.printReceipt(r, { storno: true })),
    xReport: () => ok(sim.report('X')), zReport: () => ok(sim.report('Z')), cash: (a: number) => ok(sim.cash(a)), lastReceipt: () => sim.lastReceipt(), test: () => sim.testPrint(),
  } };
  return fiscalBridge(w) as never;
}
const row = async (id: string) => (await pg.select().from(schema.firmDocs).where(eq(schema.firmDocs.id, id)))[0]!;
const sale = (cart: { itemId: string; qty: number; price: number; rate: number }[], extra: Record<string, unknown> = {}) =>
  F.posSellFiscalAction({ date: today, wh: 'main', card: null, cart, cardNo: null, coupon: null, usePts: false, ...extra });

beforeAll(async () => {
  await setupDb();
  const [f] = await pg.insert(schema.firms).values({ name: 'МАРКЕТ ФИСКАЛ ДООЕЛ', edb: '4030026000888', city: 'Скопје', address: 'ул. 1', vatRegistered: true }).returning();
  firmId = f!.id;
  const [p] = await pg.insert(schema.partners).values({ firmId, name: 'Добавувач ДОО', edb: '4030026000999', address: 'ул. 2', city: 'Скопје' }).returning();
  const I = await pg.insert(schema.items).values([
    { firmId, name: 'Кафе 200г', code: '1', type: 'goods', vatRate: 18, price: '59' },
    { firmId, name: 'Леб бел', code: '2', type: 'goods', vatRate: 5, price: '35' },
  ]).returning();
  coffee = I[0]!.id; bread = I[1]!.id;
  await pg.transaction((tx) => savePurchase(tx as never, firmId, { number: 'P-1', date: `${today.slice(0, 4)}-01-05`, partnerId: p!.id, ptype: 'stock', groups: [{ account: '6600', rate: 18, base: 1000, vat: 180 }], stock: [{ itemId: coffee, qty: 50, price: 30 }, { itemId: bread, qty: 50, price: 20 }] }, { userId: null, role: 'acc' }));
  await signIn('admin');
  useFirm(firmId);
}, 120_000);

describe('fiscal device flow (desktop bridge)', () => {
  it('detects the desktop bridge only when the preload exposed a valid API', () => {
    expect(fiscalBridge(undefined)).toBeNull();
    expect(fiscalBridge({})).toBeNull();
    expect(fiscalBridge({ wiseFiscal: { version: 0, printReceipt() {}, status() {} } })).toBeNull();
    expect(fiscalBridge({ wiseFiscal: { version: 1 } })).toBeNull();
    expect(fiscalBridge({ wiseFiscal: { version: 1, printReceipt() {}, status() {} } })).not.toBeNull();
  });

  it('sale → receipt printed → the device number is recorded on the sale', async () => {
    const b = fakeBridge();
    const s = await sale([{ itemId: coffee, qty: 2, price: 59, rate: 18 }, { itemId: bread, qty: 1, price: 35, rate: 5 }], { card: 100 });
    expect(s.error).toBeUndefined();
    expect(s.receipt).toEqual({ items: [{ name: 'Кафе 200г', qty: 2, price: 59, vat: 'А' }, { name: 'Леб бел', qty: 1, price: 35, vat: 'Б' }], payments: { card: 100 } });
    expect((await row(s.fiskId!)).status).toBe('pending');
    const o = await printFiscal(b, { fiskId: s.fiskId!, receipt: s.receipt! }, F.fiscalResultAction);
    expect(o).toMatchObject({ ok: true, number: '1' });
    const r = await row(s.fiskId!);
    expect([r.status, r.number, (r.data as { total: number }).total, (r.data as { device: { vendor: string } }).device.vendor]).toEqual(['ok', '1', 153, 'sim']);
    const [day] = await pg.select().from(schema.salesDaily).where(eq(schema.salesDaily.id, (r.data as { salesDayId: string }).salesDayId));
    expect(Number(day!.total)).toBe(153);
  });

  it('paper out → not fiscalised; printed again from the log without booking the sale twice', async () => {
    const s = await sale([{ itemId: bread, qty: 3, price: 35, rate: 5 }]);
    const o = await printFiscal(fakeBridge('PAPER_OUT'), { fiskId: s.fiskId!, receipt: s.receipt! }, F.fiscalResultAction);
    expect(o.ok).toBe(false);
    expect(o.msg).toMatch(/НЕ е испечатена.*хартија/);
    expect(o.unsaved).toBeUndefined();
    let r = await row(s.fiskId!);
    expect([r.status, r.number, (r.data as { code: string }).code]).toEqual(['failed', null, 'PAPER_OUT']);
    const before = (await pg.select().from(schema.salesDaily).where(eq(schema.salesDaily.firmId, firmId)))[0]!;

    const j = await F.fiscalReprintAction(s.fiskId!);
    expect(j.receipt).toEqual(s.receipt);
    const b = fakeBridge(); b.sim.s.receipt = 41;
    const o2 = await printFiscal(b, { fiskId: j.fiskId!, receipt: j.receipt! }, F.fiscalResultAction);
    expect(o2).toMatchObject({ ok: true, number: '42' });
    r = await row(s.fiskId!);
    expect([r.status, r.number]).toEqual(['ok', '42']);
    const after = (await pg.select().from(schema.salesDaily).where(eq(schema.salesDaily.id, before.id)))[0]!;
    expect(Number(after.total)).toBe(Number(before.total)); // reprint did not book anything
    expect((await F.fiscalReprintAction(s.fiskId!)).error).toMatch(/веќе фискализирана/);
  });

  it('device printed but the save failed → keep the number, save it again (never print twice)', async () => {
    const s = await sale([{ itemId: coffee, qty: 1, price: 59, rate: 18 }]);
    const b = fakeBridge(); b.sim.s.receipt = 99;
    const o = await printFiscal(b, { fiskId: s.fiskId!, receipt: s.receipt! }, async () => { throw new Error('offline'); });
    expect(o.ok).toBe(false);
    expect(o.unsaved?.result.number).toBe('100');
    expect(o.msg).toMatch(/испечати сметката бр\. 100/);
    const o2 = await saveAgain(o.unsaved!.fiskId, o.unsaved!.result, F.fiscalResultAction);
    expect(o2).toMatchObject({ ok: true, number: '100' });
    expect(b.sim.s.receipt).toBe(100); // printed once
  });

  it('storno of a fiscalised sale, once; Z report recorded with its number', async () => {
    const s = await sale([{ itemId: coffee, qty: 1, price: 59, rate: 18 }]);
    const b = fakeBridge(); b.sim.s.receipt = 200;
    await printFiscal(b, { fiskId: s.fiskId!, receipt: s.receipt! }, F.fiscalResultAction);
    const st = await F.fiscalStornoAction(s.fiskId!);
    expect(st.receipt?.ref).toBe('201');
    const o = await printFiscal(b, { fiskId: st.fiskId!, receipt: st.receipt!, storno: true }, F.fiscalResultAction);
    expect(o).toMatchObject({ ok: true, number: '202' });
    expect((await F.fiscalStornoAction(s.fiskId!)).error).toMatch(/веќе сторнирана/);

    const z = await b.zReport();
    expect((await F.fiscalReportAction({ kind: 'z', wh: 'main', result: z })).ok).toMatch(/Z дневен извештај бр\. 1/);
    expect((await F.fiscalReportAction({ kind: 'z', wh: 'main', result: { ok: false, code: 'NOT_CONNECTED', error: 'x' } })).error).toMatch(/не го потврди/);
  });

  it('refuses bad input: too many lines, a forged result', async () => {
    const many = Array.from({ length: 100 }, () => ({ itemId: bread, qty: 1, price: 35, rate: 5 }));
    expect((await sale(many)).error).toMatch(/99/);
    expect((await F.fiscalResultAction('not-a-uuid', { ok: true, number: '1' })).error).toBeTruthy();
  });
});
