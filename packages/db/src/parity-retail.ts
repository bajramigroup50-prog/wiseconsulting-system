/**
 * Retail parity (legacy `VIEWS.kasa` + loyalty wrapper 9937–9942, `roPay` 9986): one POS sale with loyalty card,
 * coupon and redeemed points, in one transaction — discount lines per VAT rate (`Retail.posDiscountLines`), the POS
 * day (`posSell`), the card's points / spend / visits and the coupon use (`loyaltyApplySale`), and — when the bill
 * comes from a restaurant table — the table bill marked paid.
 *
 * FIX vs legacy: the restaurant bill is marked paid in the same transaction as the sale (legacy `roPay` marked it paid
 * before the till was even opened).
 */
import { and, eq, sql } from 'drizzle-orm';
import { fkIssuePlan, schemeValue } from '@wise/core';
import { fkNormDate, type FiskRead } from '@wise/core/ai/fisk';
import {
  FK_SC, couponCheck, findCard, fkGrossByRate, fkMetgDays, fkRows2, pointsEarned, posDiscount, posDiscountLines, posSaldo, type Coupon, type LoyaltyCard,
} from '@wise/core/retail';
import { r2 } from '@wise/core/stock/num';
import { audit, type Tx } from './audit';
import { coupons, firmDocs, firms, journalLines, journals, loyaltyCards, salesDaily } from './schema/index';
import { postJournal } from './posting';
import { StockDocError, ensurePosPartner, loadStockContext, requireLocation, whId } from './stock-service';
import { posSell, saveSalesDay, type Actor } from './stock-docs';
import { loyaltyApplySale, loyaltyRulesOf, patchFirmSettings } from './retail';

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

/* ================================================================== fiscal report read → posting */

export interface FiskReadPostInput {
  /** The normalised read (worker `fisk`, `fiskAfterRead` + FK_SIMPLE + `fiskFinish`). */
  read: FiskRead;
  today: string;
  wh?: string | null;
  nonVat: boolean;
  /** Post the daily rows as one row (legacy `fk_sum`, default on). */
  sum: boolean;
  /** Posting date of a single row (legacy `fk_dt`). */
  date?: string | null;
  /** МЕТГ days of a periodic report: spread evenly (default) or one row (legacy `fk_mg`). */
  mg?: 'spread' | 'one';
  sc: 'trg' | 'usl' | 'trgNoVat';
  rev?: string | null;
  cashK?: string | null;
  cardK?: string | null;
  /** Issue goods for the turnover (legacy step 2 „Излез на стока“, `fkIssue`). */
  issue?: boolean;
  meth?: 'fifo' | 'lifo' | 'prop';
  fileId?: string | null;
}

/**
 * Legacy `fkPost` (11448 + wrappers 13071, 13101) with `fkIssue` (11454): every row of the read (each day, or the
 * period as one row) becomes a fiscal `sales_daily` posted with the chosen scheme; a day already entered for the
 * location is replaced (legacy id `zf-<wh>-<date>`); a single posting of several days keeps the days for МЕТГ / КДФИ
 * (`fkMetgDays`); goods are issued per row with the FIFO / LIFO / proportional plan; the firm's fiscal options are kept.
 */
export async function postFiskRead(tx: Tx, a: Actor, x: FiskReadPostInput): Promise<{ ids: string[]; total: number; issued: number }> {
  const L = await loadStockContext(tx, a.firmId);
  const loc = requireLocation(L, x.wh);
  const X = fkRows2(x.read, { nonVat: x.nonVat, sum: x.sum, date: x.date, today: x.today });
  if (!X.rows.length || !X.rows.some((r) => r.total > 0)) throw new StockDocError('Нема промет за книжење.');
  const nonVat = x.sc === 'trgNoVat' ? true : x.nonVat;
  const rev = x.rev?.trim() || FK_SC[x.sc][1] || null;
  const cardK = x.cardK?.trim() || L.settings.fiskOpt.cardK || null;
  const cashK = x.cashK?.trim() || L.settings.fiskOpt.cashK || '1009';
  const meth = x.meth ?? 'fifo';
  const plan = x.issue && x.sc === 'trg' ? fkIssuePlan(L.ctx, X.rows.map((r) => ({ date: r.date, z: r.z, total: r.total, gross: r.gross })), X.G, whId(loc), meth, X.nonVat) : null;
  const ids: string[] = [];
  let total = 0, issued = 0;
  for (const [i, r] of X.rows.entries()) {
    if (!(r.total > 0)) continue;
    const [ex] = await tx.select({ id: salesDaily.id }).from(salesDaily)
      .where(and(eq(salesDaily.firmId, a.firmId), eq(salesDaily.kind, 'fisk'), eq(salesDaily.date, r.date), sql`coalesce(${salesDaily.locationId}::text, 'main') = ${loc ?? 'main'}`)).limit(1);
    const days = X.rows.length === 1 ? fkMetgDays(x.read, r, { nonVat: X.nonVat, mg: x.mg, today: x.today }) : null;
    const lines = plan?.[i]?.lines.map((l) => ({ itemId: l.item, qty: l.qty, price: l.price, rate: l.rate })) ?? [];
    const d = await saveSalesDay(tx, a, {
      id: ex?.id ?? null, kind: 'fisk', date: r.date, wh: loc, number: r.z || null, gross: fkGrossByRate(r, X.G, X.nonVat), total: r.total,
      card: r.card, cardAccount: cardK, count: r.receipts || 0, days, issue: lines.length > 0, lines,
      fisk: {
        sc: x.sc, cashK, ...(rev ? { rev } : {}), nonVat, device: x.read.device || '', storno: r.storno, cash: r.cash, receipts: r.receipts,
        from: fkNormDate(x.read.from) || undefined, to: fkNormDate(x.read.to) || undefined, periodic: x.sum, fileId: x.fileId ?? null, ...(lines.length ? { meth } : {}),
      },
      note: 'Фискален извештај' + (x.read.device ? ' · ФМ ' + x.read.device : ''),
    });
    ids.push(d.id);
    total = r2(total + d.total);
    issued += lines.length;
  }
  await patchFirmSettings(tx, a, { fiskOpt: { ...L.settings.fiskOpt, wh: loc ?? 'main', ...(rev ? { konto: rev } : {}), ...(cardK ? { cardK } : {}), sc: x.sc, cashK, ...(plan ? { meth } : {}) } }, 'fkPost');
  return { ids, total, issued };
}

/* ================================================================== POS terminal fee, fiscal devices, DFI options */

/** The POS terminal account (legacy `posKDef`: firm `posK`, else the scheme `posCard`, else 1200001). */
export function posAccountOf(L: Awaited<ReturnType<typeof loadStockContext>>): string {
  return L.settings.posting.firm.posK || schemeValue(L.settings.posting, 'posCard') || '1200001';
}

/**
 * Legacy `ACT.posFee` (13078): the open balance of the POS account (card payments from the fiscal reports not received
 * from the bank) booked as the bank's fee — D 4460 / C POS account (POS partner), at most the open balance.
 */
export async function bookPosFee(tx: Tx, a: Actor, x: { amount: number; date: string }): Promise<{ journalId: string }> {
  const L = await loadStockContext(tx, a.firmId);
  const k = posAccountOf(L);
  const lines = await tx.select({ account: journalLines.account, date: journals.date, debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId)).where(and(eq(journals.firmId, a.firmId), eq(journalLines.account, k)));
  const s = posSaldo(lines.map((l) => ({ ...l, date: String(l.date) })), k);
  const amt = r2(x.amount);
  if (!(amt > 0) || amt > s.s + 0.01) throw new StockDocError(`Внесете износ до ${s.s.toFixed(2)}.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date)) throw new StockDocError('Неважечки датум.');
  const pid = await ensurePosPartner(tx, a.firmId, a.userId);
  const j = await postJournal(tx, {
    firmId: a.firmId, date: x.date, kind: 'pos', description: 'Провизија на банка за плаќања со картички (POS)', userId: a.userId,
    lines: [{ account: '4460', debit: amt, credit: 0 }, { account: k, debit: 0, credit: amt, partnerId: pid }],
  });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'posFee', entityType: 'journal', entityId: j.id, data: { amount: amt, account: k, date: x.date } });
  return { journalId: j.id };
}

/** Legacy `fkDevices` / `devSave` (11536): fiscal devices per location, kept in the firm settings (`fiskDev`). */
export interface FiscalDevice {
  serial: string; wh?: string; brand?: string; model?: string; conn?: 'usb' | 'com' | 'lan' | 'none'; port?: string; baud?: string; ip?: string; op?: string;
  mode?: 'manual' | 'file' | 'bridge'; fisc?: string; servicer?: string; last?: string; next?: string;
}
export const fiscalDevicesOf = (settings: unknown): FiscalDevice[] => (((settings ?? {}) as Record<string, unknown>).fiskDev as FiscalDevice[] | undefined) ?? [];

export async function saveFiscalDevice(tx: Tx, a: Actor, i: number, d: FiscalDevice | null): Promise<void> {
  const [f] = await tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, a.firmId)).for('update').limit(1);
  const D = [...fiscalDevicesOf(f?.settings)];
  if (d) {
    if (!d.serial.trim()) throw new StockDocError('Внесете фискален број.');
    if (i >= 0 && i < D.length) D[i] = d; else D.push(d);
  } else if (i >= 0 && i < D.length) D.splice(i, 1);
  await patchFirmSettings(tx, a, { fiskDev: D }, d ? 'devSave' : 'devDel');
}

/** Legacy DFI control options (`dfi_off`, `dfi_max`, `dfi_dep` → `fiskOpt.offDays / cashMax / depDays`). */
export async function saveDfiOptions(tx: Tx, a: Actor, o: { offDays?: string; cashMax?: number; depDays?: number }): Promise<void> {
  const L = await loadStockContext(tx, a.firmId);
  await patchFirmSettings(tx, a, { fiskOpt: { ...L.settings.fiskOpt, ...o } }, 'dfiOpt');
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
