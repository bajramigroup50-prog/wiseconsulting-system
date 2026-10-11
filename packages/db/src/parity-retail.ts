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
import { cogsAccount, fkIssuePlan, postOut, priceAt, schemeValue, stockAt, type StockMove } from '@wise/core';
import { fkNormDate, type FiskRead } from '@wise/core/ai/fisk';
import {
  FK_SC, couponCheck, findCard, fkGrossByRate, fkMetgDays, fkRows2, pointsEarned, posDiscount, posDiscountLines, posSaldo, type Coupon, type LoyaltyCard,
} from '@wise/core/retail';
import { r2, r4 } from '@wise/core/stock/num';
const fq = (x: number) => String(Math.round(x * 1000) / 1000).replace('.', ',');
import { audit, type Tx } from './audit';
import { coupons, firmDocs, firms, journalLines, journals, loyaltyCards, partners, salesDaily, storeOuts, type StoreOutLine } from './schema/index';
import { assertOpenPeriod, postJournal } from './posting';
import { StockDocError, ensurePosPartner, loadStockContext, removeSourceMoves, replaceSourceMoves, requireLocation, requireTracked, whId } from './stock-service';
import { deleteSalesDay, posSell, retailDocNumber, saveSalesDay, type Actor } from './stock-docs';
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
  if (!X.rows.length || !X.rows.some((r) => r.total > 0)) throw new StockDocError('Прометот е 0,00 – нема што да се книжи. Прочитајте го извештајот повторно или внесете рачно.');
  const nonVat = x.sc === 'trgNoVat' ? true : x.nonVat;
  const rev = x.rev?.trim() || FK_SC[x.sc][1] || null;
  const cardK = x.cardK?.trim() || L.settings.fiskOpt.cardK || null;
  const cashK = x.cashK?.trim() || L.settings.fiskOpt.cashK || '1009';
  const meth = x.meth ?? 'fifo';
  const plan = x.issue && x.sc === 'trg' ? fkIssuePlan(L.ctx, X.rows.map((r) => ({ date: r.date, z: r.z, total: r.total, gross: r.gross })), X.G, whId(loc), meth, X.nonVat) : null;
  if (plan && !plan.some((d) => d.lines.length)) throw new StockDocError('Нема ставки за излез.');
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

/* ================================================================== m_izlez: store sale (парагон) / supplier return */

export interface StoreOutInput {
  id?: string | null;
  kind: 'sale' | 'ret';
  date: string;
  wh?: string | null;
  number?: string | null;
  partnerId?: string | null;
  ref?: string | null;
  /** Sale: cash account („Наплата“, 10..). */
  account?: string | null;
  note?: string | null;
  lines: readonly { itemId: string; qty: number; price?: number | null }[];
}

const SO_PREFIX = { sale: 'ПР', ret: 'ПВ' } as const;

/**
 * Legacy `moSaveDoc` 5766 for kinds `sale` / `ret`: stock checked per item at the date (own lines excluded on edit);
 * sale → a fiscal-day row with the turnover (D „Наплата“ / C revenue + VAT, КДФИ / ЕТМ) and goods issued at average
 * cost to COGS; return → goods issued with D 2200 (supplier) at cost. Number `ПР-001/26` / `ПВ-001/26`.
 */
export async function saveStoreOut(tx: Tx, a: Actor, x: StoreOutInput): Promise<{ id: string; number: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date)) throw new StockDocError('Неважечки датум.');
  const [prev] = x.id ? await tx.select().from(storeOuts).where(and(eq(storeOuts.id, x.id), eq(storeOuts.firmId, a.firmId))).limit(1) : [];
  if (x.id && !prev) throw new StockDocError('Документот не постои.');
  const kind = prev?.kind ?? x.kind;
  const L = await loadStockContext(tx, a.firmId, prev ? { excludeSource: { sourceType: 'store_out', sourceId: prev.id } } : {});
  assertOpenPeriod(L.firm, x.date);
  if (prev) assertOpenPeriod(L.firm, prev.date);
  const loc = requireLocation(L, x.wh);
  const W = whId(loc);
  if (kind === 'ret' && !x.partnerId) throw new StockDocError('Изберете добавувач.');
  if (x.partnerId) {
    const [p] = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.id, x.partnerId), eq(partners.firmId, a.firmId))).limit(1);
    if (!p) throw new StockDocError('Комитентот не постои.');
  }
  const acc = x.account?.trim() || null;
  if (acc && !/^\d{3,10}$/.test(acc)) throw new StockDocError('Контото мора да има само цифри.');
  const nonVat = !L.settings.vatRegistered;
  const lines: StoreOutLine[] = x.lines.filter((l) => l.itemId && r4(l.qty) > 0).map((l) => {
    const it = requireTracked(L, l.itemId);
    const sp = priceAt(L.ctx, it, W, x.date);
    const price = kind === 'sale' ? r2(l.price ?? sp) : sp;
    return { itemId: it.id, qty: r4(l.qty), price, rate: nonVat ? 0 : Number(it.rate ?? 18), val: r2(r4(l.qty) * price) };
  });
  if (!lines.length) throw new StockDocError('Додадете барем еден артикл со количина.');
  const need = new Map<string, number>();
  for (const l of lines) need.set(l.itemId, (need.get(l.itemId) ?? 0) + l.qty);
  for (const [id, q] of need) {
    const av = stockAt(L.ctx, { item: id, wh: W, date: x.date }).qty;
    if (q > av + 1e-9) throw new StockDocError(`Нема доволно залиха од „${L.items.get(id)?.name}“ во ${L.locName(loc)} (има ${fq(av)}).`);
  }
  let number = x.number?.trim() || prev?.number || '';
  if (!number || (prev && prev.date.slice(0, 4) !== x.date.slice(0, 4) && !x.number?.trim())) {
    const ex = await tx.select({ number: storeOuts.number, date: storeOuts.date }).from(storeOuts).where(and(eq(storeOuts.firmId, a.firmId), eq(storeOuts.kind, kind)));
    number = retailDocNumber(SO_PREFIX[kind], ex, x.date);
  }
  const head = { kind, number, date: x.date, locationId: loc, partnerId: x.partnerId || null, ref: x.ref?.trim() || null, account: acc, lines, note: x.note?.trim() || null };
  const id = prev
    ? (await tx.update(storeOuts).set(head).where(eq(storeOuts.id, prev.id)).returning({ id: storeOuts.id }))[0]!.id
    : (await tx.insert(storeOuts).values({ ...head, firmId: a.firmId, createdBy: a.userId }).returning({ id: storeOuts.id }))[0]!.id;
  const lab = (kind === 'sale' ? 'Продажба ' : 'Повратница ') + number;
  let salesDayId: string | null = prev?.salesDayId ?? null;
  if (kind === 'sale') {
    // the turnover as a fiscal-day row: D „Наплата“ / C revenue + VAT; no goods issue there (the moves are this document's)
    const gross: Record<string, number> = {};
    for (const l of lines) gross[String(l.rate)] = r2((gross[String(l.rate)] ?? 0) + l.val);
    const d = await saveSalesDay(tx, a, {
      id: salesDayId, kind: 'fisk', date: x.date, wh: loc, number, gross, count: 1, issue: false,
      fisk: { sc: 'trg', ...(acc ? { cashK: acc } : {}), ...(nonVat ? { nonVat: true } : {}) }, note: lab,
    });
    salesDayId = d.id;
  }
  await tx.update(storeOuts).set({ salesDayId }).where(eq(storeOuts.id, id));
  let live = L.ctx;
  const moves: StockMove[] = [];
  const pName = x.partnerId ? (await tx.select({ name: partners.name }).from(partners).where(eq(partners.id, x.partnerId)).limit(1))[0]?.name ?? '' : '';
  lines.forEach((l, ix) => {
    const it = requireTracked(L, l.itemId);
    const mv = kind === 'sale'
      ? postOut(live, { item: it, qty: l.qty, date: x.date, type: 'sale', src: `mo-${id}-${ix}`, label: `${lab} · ${L.locName(loc)}`, debitAccount: cogsAccount(L.ctx, it), wh: W }).move
      : postOut(live, { item: it, qty: l.qty, date: x.date, type: 'return', src: `mo-${id}-${ix}`, label: `${lab} · ${pName}`, debitAccount: '2200', wh: W, extra: { partner: x.partnerId! } }).move;
    moves.push(mv);
    live = { ...live, moves: [...live.moves, mv] };
  });
  await replaceSourceMoves(tx, { firmId: a.firmId, sourceType: 'store_out', sourceId: id, moves, date: x.date, description: lab + ' · ' + L.locName(loc), userId: a.userId });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'moSave', entityType: 'store_out', entityId: id, data: { kind, number, date: x.date, wh: W, lines: lines.length, edit: !!prev } });
  return { id, number };
}

export async function deleteStoreOut(tx: Tx, a: Actor, id: string): Promise<void> {
  const [row] = await tx.select().from(storeOuts).where(and(eq(storeOuts.id, id), eq(storeOuts.firmId, a.firmId))).limit(1);
  if (!row) throw new StockDocError('Документот не постои.');
  const L = await loadStockContext(tx, a.firmId);
  assertOpenPeriod(L.firm, row.date);
  await removeSourceMoves(tx, { firmId: a.firmId, sourceType: 'store_out', sourceId: id, userId: a.userId });
  if (row.salesDayId) await deleteSalesDay(tx, a, row.salesDayId);
  await tx.delete(storeOuts).where(eq(storeOuts.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'moDel', entityType: 'store_out', entityId: id, data: { kind: row.kind, number: row.number, date: row.date } });
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
