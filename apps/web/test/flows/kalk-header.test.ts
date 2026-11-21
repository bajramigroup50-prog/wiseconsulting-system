/**
 * „Податоци за малопродажна калкулација“ (Helix) → Тип „Фактура влезна“: the header's calculation number is the one the
 * purchase gets, the header fills the new purchase (partner, По документ, датуми, објект) and its extra fields (ОЕ, Терк,
 * испратница, архивски број, поврзани калкулации…) are kept in the purchase's `data`; the next number follows (PGlite).
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@wise/db';
import { act, form, pg, setupDb, signIn, useFirm, useYear } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

const A = await import('@/app/(app)/vlez/actions');
const { blankHeader, decodeHeader, encodeHeader, headerIntoPurchase } = await import('@/lib/kalk-header');
const { newPurchase } = await import('@/components/sales/model');
let firmId = '', partnerId = '';

beforeAll(async () => {
  await setupDb();
  const [f] = await pg.insert(schema.firms).values({ name: 'Калкулација Хеликс ДООЕЛ', vatRegistered: true }).returning();
  firmId = f!.id;
  const [p] = await pg.insert(schema.partners).values({ firmId, name: 'Добавувач Алфа', edb: '4030000000001' }).returning();
  partnerId = p!.id;
  await signIn('admin');
  useFirm(firmId); useYear(2026);
});

describe('Helix header → влезна калкулација', () => {
  it('the suggested number, the header in the purchase and its data; the next number follows', async () => {
    const s = await A.nextCalcNoAction('main', '2026-11-21');
    expect(s.no).toBe('0001 01');
    const h = blankHeader('2026-11-21', {
      calcNo: s.no!, wh: 'main', partnerId, doc: 'Ф-200', docDate: '2026-11-20', due: '2026-12-20', oe: '01', terk: 'Т1', dispNo: 'И-5', archNo: '77', note: 'прва', links: ['c-earlier'],
    });
    // the dialog's `hx` decodes back the same
    const hx = decodeHeader(encodeHeader(h))!;
    expect(hx).toEqual(h);
    const init = headerIntoPurchase(newPurchase('2026-11-21', false, { supplierFx: '2210', stock: '6600', purDefault: '4100' }, '1'), hx);
    const payload = {
      ...init,
      groups: [{ account: '', rate: '18', base: '200', vat: '36' }],
      stock: [{ itemId: '', name: 'Брашно 1кг', code: '', barcode: '', unit: 'ком', qty: '2', price: '100', rab: '', amount: '', cn: '', dep: '', sp: '', type: 'goods', rate: '18' }],
    };
    const r = await act(A.savePurchaseAction({}, form({ payload: JSON.stringify(payload) })));
    expect(r).toMatchObject({ redirect: expect.stringMatching(/saved=/) });
    const [pu] = await pg.select().from(schema.purchases).where(and(eq(schema.purchases.firmId, firmId), eq(schema.purchases.number, 'Ф-200')));
    expect(pu).toMatchObject({ calcNo: '0001 01', partnerId, date: '2026-11-21', docDate: '2026-11-20', due: '2026-12-20', ptype: 'stock', warehouseId: null });
    expect(pu!.data).toMatchObject({ oe: '01', terk: 'Т1', hxDispNo: 'И-5', hxArchNo: '77', hxLinks: 'c-earlier', hxTip: 'in', memo: expect.stringContaining('прва') });
    expect((await A.nextCalcNoAction('', '2026-11-22')).no).toBe('0002 01');
  });

  it('a wrong date is refused', async () => {
    expect((await A.nextCalcNoAction('main', '21.11.2026')).error).toMatch(/датум/);
  });
});
