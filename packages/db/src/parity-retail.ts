/**
 * Retail parity (legacy `VIEWS.kasa` + loyalty wrapper 9937–9942, `roPay` 9986): one POS sale with loyalty card,
 * coupon and redeemed points, in one transaction — discount lines per VAT rate (`Retail.posDiscountLines`), the POS
 * day (`posSell`), the card's points / spend / visits and the coupon use (`loyaltyApplySale`), and — when the bill
 * comes from a restaurant table — the table bill marked paid.
 *
 * FIX vs legacy: the restaurant bill is marked paid in the same transaction as the sale (legacy `roPay` marked it paid
 * before the till was even opened).
 */
import { and, eq } from 'drizzle-orm';
import { couponCheck, findCard, pointsEarned, posDiscount, posDiscountLines, type Coupon, type LoyaltyCard } from '@wise/core/retail';
import { r2 } from '@wise/core/stock/num';
import { audit, type Tx } from './audit';
import { coupons, firmDocs, firms, loyaltyCards } from './schema/index';
import { StockDocError } from './stock-service';
import { posSell, type Actor } from './stock-docs';
import { loyaltyApplySale, loyaltyRulesOf } from './retail';

export interface PosSaleInput {
  date: string;
  wh?: string | null;
  cart: readonly { itemId: string; qty: number; price: number; rate?: number | null }[];
  /** Paid by card (part of the amount to pay). */
  card?: number | null;
  /** Loyalty card number or phone (legacy `lcFind`). */
  cardNo?: string | null;
  coupon?: string | null;
  usePts?: boolean;
  /** Restaurant bill (`firm_docs` `rord`) paid through the till. */
  orderId?: string | null;
}

export interface PosSaleResult { id: string; total: number; pay: number; disc: number; card?: { name: string; earn: number; red: number; points: number } }

export async function posSaleWithLoyalty(tx: Tx, a: Actor, x: PosSaleInput): Promise<PosSaleResult> {
  const [f] = await tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, a.firmId)).limit(1);
  if (!f) throw new StockDocError('Фирмата не постои.');
  const rules = loyaltyRulesOf((f.settings ?? {}) as Record<string, unknown>);
  const cart = x.cart.map((c) => ({ itemId: c.itemId, qty: c.qty, price: c.price, rate: Number(c.rate ?? 18) }));
  const tot = r2(cart.reduce((s, c) => s + c.qty * c.price, 0));
  let card: (LoyaltyCard & { dbId: string }) | null = null;
  if (x.cardNo?.trim()) {
    const C = await tx.select().from(loyaltyCards).where(eq(loyaltyCards.firmId, a.firmId));
    const c = findCard(C.map((r) => ({ id: r.id, dbId: r.id, no: r.number, name: r.name, phone: r.phone, disc: Number(r.discount), points: Number(r.points) })), x.cardNo);
    if (!c) throw new StockDocError('Картичката не е пронајдена.');
    card = c;
  }
  let cp: ReturnType<typeof couponCheck<Coupon>> | null = null;
  if (x.coupon?.trim()) {
    const P = await tx.select().from(coupons).where(eq(coupons.firmId, a.firmId));
    const cardDisc = card && Number(card.disc) ? r2((tot * Number(card.disc)) / 100) : 0;
    cp = couponCheck(P.map((r) => ({ id: r.id, code: r.code, kind: r.kind, val: Number(r.value), from: r.validFrom, to: r.validTo, max: r.maxUses, used: r.used, minTotal: Number(r.minTotal) })), x.coupon, tot - cardDisc, x.date);
    if ('err' in cp) throw new StockDocError(cp.err);
  }
  const D = posDiscount(tot, { card, coupon: cp, usePts: !!x.usePts, rules });
  const lines = [...cart, ...posDiscountLines(cart, D.disc, D.parts)];
  const day = await posSell(tx, a, { date: x.date, wh: x.wh ?? null, cart: lines, card: x.card ? Math.min(D.pay, x.card) : null });
  const earn = card ? pointsEarned(D.pay, rules) : 0;
  const couponId = cp && 'c' in cp ? cp.c.id : null;
  if (card || couponId) await loyaltyApplySale(tx, a, { cardId: card?.dbId ?? null, couponId, pay: D.pay, redPts: D.redPts, earn, date: x.date });
  if (x.orderId) {
    const [o] = await tx.select().from(firmDocs).where(and(eq(firmDocs.id, x.orderId), eq(firmDocs.firmId, a.firmId), eq(firmDocs.type, 'rord'))).for('update').limit(1);
    if (!o) throw new StockDocError('Сметката на масата не постои.');
    if (o.status !== 'open') throw new StockDocError('Сметката на масата е веќе затворена.');
    const now = new Date().toISOString().slice(0, 16);
    await tx.update(firmDocs).set({ status: 'paid', data: { ...(o.data as Record<string, unknown>), paidAt: now, salesDayId: day.id } }).where(eq(firmDocs.id, o.id));
    await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'roPay', entityType: 'firm_doc', entityId: o.id, data: { salesDayId: day.id, pay: D.pay } });
  }
  return {
    id: day.id, total: tot, pay: D.pay, disc: D.disc,
    ...(card ? { card: { name: card.name, earn, red: D.redPts, points: r2(Number(card.points) - D.redPts + earn) } } : {}),
  };
}
