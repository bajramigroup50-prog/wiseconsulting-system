/** POS sale with loyalty card, coupon and points on PGlite (legacy `posSell` + wrapper 9940). */
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { stock } from '@wise/core';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { loadStockContext, replaceSourceMoves } from './stock-service';
import type { Actor } from './stock-docs';
import { saveCoupon, saveLoyaltyCard } from './retail';
import { posSaleWithLoyalty } from './parity-retail';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
let A: Actor;
let firmId = '';
const I: Record<string, string> = {};
const tx = <T>(f: (t: DB) => Promise<T>) => db.transaction((t) => f(t as unknown as DB));
const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected an error'); };

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Маркет ДООЕЛ', vatRegistered: true }).returning();
  firmId = f!.id;
  A = { firmId, userId: null };
  const rows = await db.insert(schema.items).values([
    { firmId, code: '001', name: 'Кафе', type: 'goods', unit: 'ком', price: '59', vatRate: 18 },
    { firmId, code: '002', name: 'Леб', type: 'goods', unit: 'ком', price: '105', vatRate: 5 },
  ]).returning();
  for (const r of rows) I[r.code!] = r.id;
  await tx((t) => replaceSourceMoves(t, {
    firmId, sourceType: 'purchase', sourceId: 'P-1', date: '2026-01-05', userId: null,
    moves: [
      { id: '', date: '2026-01-05', item: I['001']!, qty: 10, value: 300, type: 'in', wh: 'main', lines: [] },
      { id: '', date: '2026-01-05', item: I['002']!, qty: 10, value: 600, type: 'in', wh: 'main', lines: [] },
    ],
  }));
}, 120_000);

describe('posSaleWithLoyalty', () => {
  it('card discount + coupon: discount lines per rate, points, coupon use, stock issued', async () => {
    await tx((t) => saveLoyaltyCard(t, A, { number: '2800000001', name: 'Ана', phone: '070 123 456', discount: 10, points: 0 }));
    await tx((t) => saveCoupon(t, A, { code: 'JESEN', kind: 'amt', value: 20.7, maxUses: 1 }));
    const cart = [{ itemId: I['001']!, qty: 2, price: 59, rate: 18 }, { itemId: I['002']!, qty: 1, price: 105, rate: 5 }];
    const r = await tx((t) => posSaleWithLoyalty(t, A, { date: '2026-03-02', cart, cardNo: '070123456', coupon: 'jesen' }));
    expect(r.total).toBe(223);
    expect(r.disc).toBe(43); // 22.30 card 10 % + 20.70 coupon
    expect(r.pay).toBe(180);
    expect(r.card).toEqual({ name: 'Ана', earn: 1, red: 0, points: 1 });
    const [d] = await db.select().from(schema.salesDaily).where(eq(schema.salesDaily.id, r.id));
    expect(Number(d!.total)).toBe(180);
    expect(d!.lines.filter((l) => !l.itemId).map((l) => [l.rate, l.price])).toEqual([[5, -20.25], [18, -22.75]]);
    const [c] = await db.select().from(schema.loyaltyCards).where(eq(schema.loyaltyCards.number, '2800000001'));
    expect([Number(c!.points), Number(c!.spent), c!.visits]).toEqual([1, 180, 1]);
    const [cp] = await db.select().from(schema.coupons).where(eq(schema.coupons.code, 'JESEN'));
    expect(cp!.used).toBe(1);
    const L = await loadStockContext(db, firmId);
    expect(stock(L.ctx, I['001']!).qty).toBe(8);
    // a used-up coupon is refused, nothing is booked
    expect((await err(tx((t) => posSaleWithLoyalty(t, A, { date: '2026-03-02', cart, coupon: 'JESEN' })))).message).toBe('Купонот е веќе искористен.');
    expect((await err(tx((t) => posSaleWithLoyalty(t, A, { date: '2026-03-02', cart, cardNo: '999' })))).message).toMatch(/не е пронајдена/);
  });
});
