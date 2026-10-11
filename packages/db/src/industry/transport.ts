/**
 * Transport service: travel orders (legacy `pn*` ACT 9337, 9417) and freight tours for third parties (v469 `fr*`).
 *
 * FIX (LEGACY-MAP 10.4 item 1, critical): every legacy travel-order save (`pnSaveB`, `pnDep`, `pnDeliv`, `pnRet`, the
 * scanner…) called `pnSave`, which the payroll-notes `pnSave(L)` (15239) had overwritten — orders went into
 * `firm.payNotes` and never reached `pnal/`. Here {@link saveTravelOrder} and the status actions write the
 * `travel_orders` table only; payroll notes are Phase 6's `payroll_notes`.
 *
 * FIX (LEGACY-MAP 10.4 item 4): cash collected on delivery was booked on the literal konto '1200'; it is the posting
 * scheme's customer konto now.
 */
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { schemeValue } from '@wise/core';
import { travelOrderNo, type TravelEvent, type TravelStop } from '@wise/core/industry';
import { frCountryName, frTourError } from '@wise/core/industry';
import { audit, type Tx } from '../audit';
import {
  employees, fleetVehicles, freightTours, invoiceLines, invoices, itemBarcodes, items, partners, purchaseStockLines, purchases, travelOrders,
  type FreightTour, type TravelOrderRow,
} from '../schema/index';
import { documentPayments } from '../bank/open-items';
import { firmPostingContext } from '../sales/context';
import { saveInvoice } from '../sales/invoices';
import { cashMovement, IndustryError, issueModuleInvoice, loadIndustryFirm, n, type IndActor } from './context';

const fail = (m: string): never => { throw new IndustryError(m); };
const MOD = 'pn';

export const stopsOf = (o: Pick<TravelOrderRow, 'stops'>) => o.stops as unknown as TravelStop[];
export const eventsOf = (o: Pick<TravelOrderRow, 'events'>) => o.events as unknown as TravelEvent[];

/* ================================================================== travel orders */

/** Legacy `pnUnassigned`: the day's invoices / dispatch notes with goods and stock purchases not yet on an order. */
export async function unassignedDocs(tx: Tx, firmId: string, date: string) {
  const used = new Set((await tx.select({ s: travelOrders.stops }).from(travelOrders).where(eq(travelOrders.firmId, firmId)))
    .flatMap((r) => (r.s as unknown as TravelStop[]).map((s) => (s.ref ? `${s.ref.type}:${s.ref.id}` : ''))));
  const I = await tx.select({ id: invoices.id, kind: invoices.kind, number: invoices.number, p: partners.name, addr: partners.address, dAddr: sql<string | null>`${invoices.data}->>'dAddr'` })
    .from(invoices).leftJoin(partners, eq(partners.id, invoices.partnerId))
    .where(and(eq(invoices.firmId, firmId), inArray(invoices.kind, ['invoice', 'dispatch']), ne(invoices.status, 'pending'), sql`(${invoices.date} = ${date} or ${invoices.pdate} = ${date})`,
      sql`exists (select 1 from ${invoiceLines} l join items it on it.id = l.item_id where l.invoice_id = ${invoices.id} and it.type <> 'service')`));
  const P = await tx.select({ id: purchases.id, number: purchases.number, p: partners.name, sname: purchases.supplierName, addr: partners.address }).from(purchases).leftJoin(partners, eq(partners.id, purchases.partnerId))
    .where(and(eq(purchases.firmId, firmId), eq(purchases.status, 'posted'), eq(purchases.date, date), eq(purchases.imp, false), sql`exists (select 1 from ${purchaseStockLines} s where s.purchase_id = ${purchases.id})`));
  return [
    ...I.filter((x) => !used.has(`${x.kind === 'dispatch' ? 'dispatch' : 'invoice'}:${x.id}`)).map((x) => ({ type: x.kind === 'dispatch' ? 'dispatch' as const : 'invoice' as const, id: x.id, no: x.number, p: x.p ?? '', addr: x.dAddr || x.addr || '' })),
    ...P.filter((x) => !used.has(`purchase:${x.id}`)).map((x) => ({ type: 'purchase' as const, id: x.id, no: 'Влез ' + x.number, p: x.p ?? x.sname ?? '', addr: x.addr ?? '' })),
  ];
}

/** Weight, unit, type and barcodes (+ item code) of items (legacy `pnGood` reads `item.weight`, `barcode`, `barcodes`, `code`). */
export async function travelItemInfo(tx: Tx, firmId: string, ids: readonly (string | null | undefined)[]) {
  const I = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, { kg: number; unit: string | null; type: string; bc: string[] }>();
  if (!I.length) return out;
  const R = await tx.select({ id: items.id, weight: items.weight, unit: items.unit, type: items.type, code: items.code }).from(items).where(and(eq(items.firmId, firmId), inArray(items.id, I)));
  const B = await tx.select({ itemId: itemBarcodes.itemId, bc: itemBarcodes.barcode }).from(itemBarcodes).where(and(eq(itemBarcodes.firmId, firmId), inArray(itemBarcodes.itemId, I)));
  for (const r of R) out.set(r.id, { kg: n(r.weight), unit: r.unit, type: r.type, bc: [...B.filter((b) => b.itemId === r.id).map((b) => b.bc), ...(r.code ? [r.code] : [])] });
  return out;
}

/**
 * Legacy `pnStopsFrom`: stops (pick-ups first) with goods from the referenced documents — weight per unit and barcodes
 * of the item (`pnGood`), service lines left out, `open` = invoice total less what is already paid (`paidFor`).
 */
export async function stopsFrom(tx: Tx, firmId: string, refs: { type: 'invoice' | 'dispatch' | 'purchase'; id: string }[]): Promise<TravelStop[]> {
  const out: TravelStop[] = [];
  const good = (info: Awaited<ReturnType<typeof travelItemInfo>>, itemId: string | null, ix: number, name: string, qty: number, unit: string | null) => {
    const it = itemId ? info.get(itemId) : undefined;
    return { itemId, ix, name: name || '', qty, unit: unit || it?.unit || 'ком', kg: it?.kg || 0, bc: it?.bc ?? [], loaded: false, lq: 0 };
  };
  const pay = await documentPayments(tx, firmId, { invoiceIds: refs.filter((r) => r.type === 'invoice').map((r) => r.id) });
  for (const r of refs) {
    if (r.type === 'purchase') {
      const [d] = await tx.select().from(purchases).where(and(eq(purchases.id, r.id), eq(purchases.firmId, firmId))).limit(1);
      if (!d) continue;
      const [p] = d.partnerId ? await tx.select().from(partners).where(eq(partners.id, d.partnerId)).limit(1) : [];
      const G = await tx.select().from(purchaseStockLines).where(eq(purchaseStockLines.purchaseId, d.id));
      const info = await travelItemInfo(tx, firmId, G.map((g) => g.itemId));
      out.push({ ref: r, kind: 'pick', doc: 'Влезна ф-ра ' + d.number, partner: p?.name ?? d.supplierName ?? '', partnerId: d.partnerId, addr: [p?.address, p?.city].filter(Boolean).join(', '),
        goods: G.map((g, ix) => ({ g, ix })).filter((o) => n(o.g.qty)).map((o) => good(info, o.g.itemId, o.ix, o.g.name ?? '', n(o.g.qty), null)), status: 'open' });
      continue;
    }
    const [d] = await tx.select().from(invoices).where(and(eq(invoices.id, r.id), eq(invoices.firmId, firmId))).limit(1);
    if (!d) continue;
    const [p] = d.partnerId ? await tx.select().from(partners).where(eq(partners.id, d.partnerId)).limit(1) : [];
    const G = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, d.id));
    const info = await travelItemInfo(tx, firmId, G.map((l) => l.itemId));
    const tot = r.type === 'invoice' ? n(d.total) : 0;
    out.push({
      ref: r, kind: 'deliv', doc: (r.type === 'invoice' ? 'Фактура ' : 'Испратница ') + d.number, partner: p?.name ?? '', partnerId: d.partnerId, email: p?.email ?? null,
      addr: d.data.dAddr || [p?.address, p?.city].filter(Boolean).join(', '), status: 'open', amt: tot, open: r.type === 'invoice' ? (pay.get(d.id)?.remaining ?? tot) : 0,
      goods: G.filter((l) => n(l.qty) && (!l.itemId || info.get(l.itemId)?.type !== 'service')).map((l) => good(info, l.itemId, l.lineNo, l.name, n(l.qty), l.unit)),
    });
  }
  return out.sort((a, b) => (a.kind === 'pick' ? 0 : 1) - (b.kind === 'pick' ? 0 : 1));
}

export interface TravelOrderInput {
  id?: string | null; date: string; number?: string | null; vehicleId?: string | null; driverId?: string | null; codriver?: string | null;
  from?: string | null; purpose?: string | null; stops: TravelStop[]; depKm?: number | null; retKm?: number | null; fuelL?: number | null; fuelAmt?: number | null;
  assigneeId?: string | null; dnev?: boolean;
}

async function ownOrder(tx: Tx, firmId: string, id: string): Promise<TravelOrderRow> {
  const [x] = await tx.select().from(travelOrders).where(and(eq(travelOrders.id, id), eq(travelOrders.firmId, firmId))).for('update').limit(1);
  return x ?? fail('Патниот налог не постои.');
}

/** Legacy `pnSaveB` (FIX item 1: it now really persists). Taken number in the year → next free one. */
export async function saveTravelOrder(tx: Tx, a: IndActor, x: TravelOrderInput): Promise<{ id: string; number: string }> {
  await loadIndustryFirm(tx, a.firmId, MOD, a);
  const prev = x.id ? await ownOrder(tx, a.firmId, x.id) : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date)) fail('Внесете датум.');
  const [v] = x.vehicleId ? await tx.select().from(fleetVehicles).where(and(eq(fleetVehicles.id, x.vehicleId), eq(fleetVehicles.firmId, a.firmId))).limit(1) : [];
  if (!v) fail('Изберете возило.');
  const [d] = x.driverId ? await tx.select().from(employees).where(and(eq(employees.id, x.driverId), eq(employees.firmId, a.firmId))).limit(1) : [];
  if (!d) fail('Изберете возач.');
  if (!x.stops.length) fail('Додајте барем едно застанување.');
  if (x.retKm != null && x.depKm != null && x.retKm < x.depKm) fail('Км при враќање е помал од км при тргнување.');
  const y = x.date.slice(0, 4);
  const used = (await tx.select({ n: travelOrders.number }).from(travelOrders).where(and(eq(travelOrders.firmId, a.firmId), sql`extract(year from ${travelOrders.date}) = ${Number(y)}`, prev ? ne(travelOrders.id, prev.id) : undefined))).map((r) => r.n);
  let number = x.number?.trim() || prev?.number || '';
  if (!number || used.includes(number)) number = travelOrderNo(used, y);
  const row = {
    number, date: x.date, vehicleId: v!.id, plate: v!.plate, vname: v!.name, driverId: d!.id, driver: d!.name, codriver: x.codriver?.trim() || null,
    from: x.from?.trim() || null, purpose: x.purpose?.trim() || null, stops: x.stops as unknown as Record<string, unknown>[],
    depKm: x.depKm ?? null, retKm: x.retKm ?? null, fuelL: x.fuelL == null ? null : String(x.fuelL), fuelAmt: x.fuelAmt == null ? null : x.fuelAmt.toFixed(2),
    assigneeId: x.assigneeId || null, dnev: !!x.dnev,
  };
  let id = prev?.id ?? '';
  if (prev) await tx.update(travelOrders).set(row).where(eq(travelOrders.id, id));
  else id = (await tx.insert(travelOrders).values({ ...row, firmId: a.firmId, createdBy: a.userId }).returning({ id: travelOrders.id }))[0]!.id;
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: prev ? 'pnSaveB' : 'pnNew', entityType: 'travel_order', entityId: id, data: { number, stops: x.stops.length } });
  return { id, number };
}

/** Legacy `pnlDel`: only an order that has not left yet (unless the user may delete). */
export async function deleteTravelOrder(tx: Tx, a: IndActor, id: string, canDelete: boolean): Promise<void> {
  const x = await ownOrder(tx, a.firmId, id);
  if (x.status !== 'open' && !canDelete) fail('Налогот е веќе тргнат – само администраторот може да го избрише.');
  if (stopsOf(x).some((s) => s.cashVoucherId || s.returnCreditId)) fail('Од налогот има прокнижена готовина / повратница.');
  await tx.delete(travelOrders).where(eq(travelOrders.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'pnlDel', entityType: 'travel_order', entityId: id, data: { number: x.number } });
}

/**
 * Driver / office status actions (legacy `pnDep`, `pnDeliv`, `pnRet`): each appends an event (time, optional GPS) and
 * saves the order.
 */
export async function travelOrderEvent(tx: Tx, a: IndActor, id: string, ev:
  | { k: 'dep'; km?: number | null }
  | { k: 'deliv'; i: number; recv?: string; cash?: number; ret?: { k: number; qty: number }[]; sig?: string | null; photo?: string | null }
  | { k: 'ret'; km?: number | null; fuelL?: number | null; fuelAmt?: number | null },
  at: string, by: string | null, geo?: { lat: number; lon: number; acc?: number | null } | null): Promise<void> {
  const x = await ownOrder(tx, a.firmId, id);
  const S = stopsOf(x), E = eventsOf(x);
  const patch: Partial<typeof travelOrders.$inferInsert> = {};
  let txt = '';
  if (ev.k === 'dep') {
    if (x.status !== 'open') fail('Налогот е веќе тргнат.');
    patch.status = 'onroad';
    if (ev.km != null) patch.depKm = Math.round(ev.km);
    txt = 'Тргнување' + (ev.km != null ? ' · км ' + ev.km : '');
  } else if (ev.k === 'deliv') {
    const s = S[ev.i] ?? fail('Застанувањето не постои.');
    if (s.status === 'done') fail('Застанувањето е веќе завршено.');
    if ((ev.cash ?? 0) < 0) fail('Износот не може да биде негативен.');
    const ret = (ev.ret ?? []).map((r) => ({ k: r.k, qty: Math.min(n(r.qty), n(s.goods[r.k]?.qty)) })).filter((r) => r.qty > 0);
    S[ev.i] = { ...s, status: 'done', at, recv: ev.recv?.trim() || null, cash: ev.cash || 0, ret: ret.length ? ret : null, geo: geo ?? null, sig: ev.sig ?? null, photo: ev.photo ?? null };
    patch.stops = S as unknown as Record<string, unknown>[];
    txt = (s.kind === 'pick' ? 'Преземено од: ' : 'Испорачано: ') + s.partner + (ev.recv ? (s.kind === 'pick' ? ' · предал ' : ' · примил ') + ev.recv : '') + (ev.sig ? ' · потпис' : '') + (ev.photo ? ' · фото' : '') + (ev.cash ? ' · готовина ' + ev.cash : '') + (ret.length ? ` · поврат ${ret.length} ставки` : '');
  } else {
    if (x.status === 'done') fail('Налогот е завршен.');
    if (ev.km != null && x.depKm != null && ev.km < x.depKm) fail(`Км при враќање е помал од км при тргнување (${x.depKm}).`);
    patch.status = 'done';
    if (ev.km != null) patch.retKm = Math.round(ev.km);
    if (ev.fuelL != null) patch.fuelL = String(ev.fuelL);
    if (ev.fuelAmt != null) patch.fuelAmt = ev.fuelAmt.toFixed(2);
    txt = 'Враќање' + (ev.km != null ? ' · км ' + ev.km : '');
    if (ev.km && x.vehicleId) await tx.update(fleetVehicles).set({ odo: sql`greatest(coalesce(${fleetVehicles.odo}, 0), ${Math.round(ev.km)})` }).where(eq(fleetVehicles.id, x.vehicleId));
  }
  patch.events = [...E, { k: ev.k === 'deliv' && S[ev.i]?.kind === 'pick' ? 'pick' : ev.k, txt, at, by, geo: geo ?? null }] as unknown as Record<string, unknown>[];
  await tx.update(travelOrders).set(patch).where(eq(travelOrders.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: ev.k === 'dep' ? 'pnDep' : ev.k === 'deliv' ? 'pnDeliv' : 'pnRet', entityType: 'travel_order', entityId: id, data: { txt } });
}

/** Legacy `pnCashPost`: cash handed over by the driver → one receipt per stop, D register / P customer (FIX item 4). */
export async function postTravelCash(tx: Tx, a: IndActor, id: string): Promise<number> {
  const f = await loadIndustryFirm(tx, a.firmId, MOD, a);
  const x = await ownOrder(tx, a.firmId, id);
  const ctx = await firmPostingContext(tx, f);
  const S = stopsOf(x);
  let k = 0;
  for (const [i, s] of S.entries()) {
    if (!(n(s.cash) > 0) || s.cashVoucherId) continue;
    const [inv] = s.ref?.type === 'invoice' ? await tx.select().from(invoices).where(eq(invoices.id, s.ref.id)).limit(1) : [];
    const pid = inv?.partnerId ?? s.partnerId ?? null;
    if (!pid) fail(`Застанувањето „${s.partner}“ нема комитент.`);
    const v = await cashMovement(tx, a, {
      kind: 'in', date: String(s.at || x.date).slice(0, 10), amount: n(s.cash), konto: schemeValue(ctx, 'customer'), partnerId: pid, merchant: s.partner,
      note: `Наплата при испорака – ${s.doc} · пат. налог ${x.number}${x.driver ? ' · возач ' + x.driver : ''}`,
    });
    S[i] = { ...s, cashVoucherId: v.id };
    k++;
  }
  if (!k) fail('Нема непрокнижена готовина.');
  await tx.update(travelOrders).set({ stops: S as unknown as Record<string, unknown>[] }).where(eq(travelOrders.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'pnCashPost', entityType: 'travel_order', entityId: id, data: { vouchers: k } });
  return k;
}

/** Legacy `pnRetCr`: goods returned at delivery → Phase 3 return credit note (goods back to stock) for the invoice. */
export async function travelReturnCredit(tx: Tx, a: IndActor, id: string, i: number, date: string): Promise<string> {
  await loadIndustryFirm(tx, a.firmId, MOD, a);
  const x = await ownOrder(tx, a.firmId, id);
  const S = stopsOf(x);
  const s = S[i] ?? fail('Застанувањето не постои.');
  if (s.returnCreditId) fail('Повратницата е веќе креирана.');
  if (s.ref?.type !== 'invoice') fail('Поврат се прави само за фактура.');
  const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, s.ref!.id), eq(invoices.firmId, a.firmId))).limit(1);
  if (!inv) fail('Фактурата не постои.');
  const L = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv!.id));
  const lines = (s.ret ?? []).map((r) => {
    const g = s.goods[r.k];
    const l = L.find((y) => y.lineNo === g?.ix) ?? L.find((y) => y.itemId && y.itemId === g?.itemId);
    return l ? { itemId: l.itemId, name: l.name, unit: l.unit, qty: Math.min(r.qty, n(l.qty)), price: n(l.price), disc: n(l.disc), rate: l.rate, account: l.account } : null;
  }).filter((l): l is NonNullable<typeof l> => !!l);
  if (!lines.length) fail('Не се најдоа ставките во фактурата.');
  const r = await saveInvoice(tx, a.firmId, {
    kind: 'credit', creditKind: 'ret', refInvoiceId: inv!.id, date, partnerId: inv!.partnerId, art32: inv!.art32, currency: inv!.currency, fx: inv!.fx, lines,
    note: `Поврат при испорака – патен налог ${x.number}`, data: { source: { type: 'travel_order', id: x.id } },
  }, a);
  S[i] = { ...s, returnCreditId: r.id };
  await tx.update(travelOrders).set({ stops: S as unknown as Record<string, unknown>[] }).where(eq(travelOrders.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'pnRetCr', entityType: 'travel_order', entityId: id, data: { credit: r.number } });
  return r.number;
}

/** Orders assigned to a field user (legacy `mojpn`), newest first. */
export const ordersOfAssignee = (tx: Tx, userId: string) =>
  tx.select().from(travelOrders).where(and(eq(travelOrders.assigneeId, userId), ne(travelOrders.status, 'done'))).orderBy(desc(travelOrders.date));

/* ================================================================== freight tours */

export interface FreightInput extends Partial<Omit<FreightTour, 'id' | 'firmId' | 'createdAt' | 'updatedAt' | 'invoiceId' | 'price' | 'fx' | 'tolls' | 'otherCost' | 'kg' | 'm3'>> {
  id?: string | null; number: string; date: string; price?: number | null; fx?: number | null; tolls?: number | null; otherCost?: number | null; kg?: number | null; m3?: number | null;
}

async function ownTour(tx: Tx, firmId: string, id: string): Promise<FreightTour> {
  const [t] = await tx.select().from(freightTours).where(and(eq(freightTours.id, id), eq(freightTours.firmId, firmId))).for('update').limit(1);
  return t ?? fail('Турата не постои.');
}

/** Legacy `frSave`: number unique, client needed for a priced / finished tour, segment exits after entries, invoiced tours frozen. */
export async function saveFreightTour(tx: Tx, a: IndActor, t: FreightInput): Promise<string> {
  await loadIndustryFirm(tx, a.firmId, 'frt', a);
  const prev = t.id ? await ownTour(tx, a.firmId, t.id) : null;
  const number = t.number.trim();
  // Legacy `ACT.frSave` 14533–14536 checks, in the legacy order and wording (core `frTourError`).
  const [dup] = number ? await tx.select({ id: freightTours.id }).from(freightTours).where(and(eq(freightTours.firmId, a.firmId), eq(freightTours.number, number), prev ? ne(freightTours.id, prev.id) : undefined)).limit(1) : [];
  const [pinv] = prev?.invoiceId ? await tx.select({ n: invoices.number }).from(invoices).where(eq(invoices.id, prev.invoiceId)).limit(1) : [];
  const err = frTourError({ ...t, cur: (t.cur || 'EUR').toUpperCase(), vat: t.vat === 'dom' ? 'dom' : 'intl', segs: t.segs ?? [] },
    { dupNumber: !!dup, prev: prev ? { ...prev, invNumber: pinv?.n ?? null } : null, countryName: frCountryName });
  if (err) fail(err);
  const m = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? null : v.toFixed(2));
  const row = {
    number, date: t.date, status: t.status ?? 'plan', partnerId: t.partnerId || null, orderNo: t.orderNo || null, km: t.km ?? null, vehicleId: t.vehicleId || null, trailer: t.trailer || null,
    driverId: t.driverId || null, driver2Id: t.driver2Id || null, loadPlace: t.loadPlace || null, loadC: t.loadC || null, sender: t.sender || null, unloadDate: t.unloadDate || null,
    unloadPlace: t.unloadPlace || null, unloadC: t.unloadC || null, consignee: t.consignee || null, retDate: t.retDate || null, goods: t.goods || null, packages: t.packages || null,
    kg: t.kg == null ? null : String(t.kg), m3: t.m3 == null ? null : String(t.m3), adr: t.adr || null, docsAtt: t.docsAtt || null, price: m(t.price), cur: (t.cur || 'EUR').toUpperCase(),
    fx: t.fx ? String(t.fx) : null, vat: t.vat === 'dom' ? 'dom' as const : 'intl' as const, red: [100, 50, 20].includes(Number(t.red)) ? Number(t.red) : 100,
    tolls: m(t.tolls), tollCur: t.tollCur || null, otherCost: m(t.otherCost), note: t.note || null, segs: (t.segs ?? []).filter((g) => g.c),
  };
  if (prev?.invoiceId) row.status = prev.status === 'inv' ? 'inv' : row.status;
  let id = prev?.id ?? '';
  if (prev) await tx.update(freightTours).set(row).where(eq(freightTours.id, id));
  else id = (await tx.insert(freightTours).values({ ...row, firmId: a.firmId }).returning({ id: freightTours.id }))[0]!.id;
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: prev ? 'frSave' : 'frNew', entityType: 'freight_tour', entityId: id, data: { number } });
  return id;
}

export async function deleteFreightTour(tx: Tx, a: IndActor, id: string): Promise<void> {
  const t = await ownTour(tx, a.firmId, id);
  if (t.invoiceId) fail('Турата е фактурирана.');
  await tx.delete(freightTours).where(eq(freightTours.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'frDel', entityType: 'freight_tour', entityId: id, data: { number: t.number } });
}

/**
 * Legacy `frInv` + `saveInv` wrapper 14549: one invoice for the selected tours of one client and currency.
 * FIX (LEGACY-MAP 10.4 item 15): legacy built the invoice draft itself (bypassing `bzInvDraft`) and converted every line
 * to MKD; it now goes through the Phase 3 service in the tours' currency (rate from the first tour), international
 * tours at 0%, domestic at 18%.
 */
export async function invoiceFreightTours(tx: Tx, a: IndActor, ids: string[], date: string, fxLookup: (cur: string, d: string) => Promise<number>) {
  const f = await loadIndustryFirm(tx, a.firmId, 'frt', a);
  const T = await tx.select().from(freightTours).where(and(eq(freightTours.firmId, a.firmId), inArray(freightTours.id, ids), isNull(freightTours.invoiceId)));
  if (!T.length) fail('Изберете нефактурирани тури.');
  const P = [...new Set(T.map((t) => t.partnerId))];
  if (P.length > 1 || !P[0]) fail('Избраните тури се на различни клиенти (или без клиент) – една фактура е за еден клиент.');
  const C = [...new Set(T.map((t) => t.cur || 'MKD'))];
  if (C.length > 1) fail('Избраните тури се во различни валути.');
  const cur = C[0]!;
  const fx = cur === 'MKD' ? 1 : n(T[0]!.fx) || (await fxLookup(cur, T[0]!.unloadDate || T[0]!.date));
  if (!(fx > 0)) fail(`Нема курс за ${cur}.`);
  const plates = new Map((await tx.select({ id: fleetVehicles.id, plate: fleetVehicles.plate }).from(fleetVehicles).where(eq(fleetVehicles.firmId, a.firmId))).map((v) => [v.id, v.plate]));
  void f;
  const intl = T.some((t) => t.vat !== 'dom');
  const inv = await issueModuleInvoice(tx, a, {
    partnerId: P[0]!, date, currency: cur, fx,
    note: [cur !== 'MKD' ? `Вкупно за плаќање во ${cur}. Денарската противвредност е по среден курс на НБРМ.` : '', intl ? 'Меѓународен превоз на стоки – ослободено од ДДВ со право на одбивка според Законот за ДДВ.' : ''].filter(Boolean).join(' '),
    data: { source: { type: 'freight_tour', id: T.map((t) => t.id).join(',') } },
    lines: T.map((t) => ({
      name: `Превоз на стока ${t.loadPlace ?? ''}${t.loadC ? ' (' + t.loadC + ')' : ''} – ${t.unloadPlace ?? ''}${t.unloadC ? ' (' + t.unloadC + ')' : ''}, CMR ${t.number}${t.vehicleId && plates.get(t.vehicleId) ? ', ' + plates.get(t.vehicleId) : ''}${t.trailer ? '/' + t.trailer : ''}${t.orderNo ? ', нар. ' + t.orderNo : ''}`,
      unit: 'тура', qty: 1, price: n(t.price), rate: t.vat === 'dom' ? 18 : 0, account: null,
    })),
  });
  await tx.update(freightTours).set({ invoiceId: inv.id, status: 'inv' }).where(inArray(freightTours.id, T.map((t) => t.id)));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'frInv', entityType: 'freight_tour', entityId: inv.id, data: { tours: T.length, invoice: inv.number } });
  return inv;
}
