/**
 * Appointments (legacy ACT `apNewB … apInv` 10136, client cards `kc*` 10166) and restaurant (legacy ACT `rtNew …
 * roClose` 9976, `kjReady` 9991). Restaurant tables / bills and client notes are `firm_docs` rows
 * (`rtable`, `rord`, `cnote`).
 *
 * FIX (LEGACY-MAP 10.4 item 10): legacy `roPay` marked the bill paid and only then opened the till, so a cancelled
 * till left a "paid" bill with no sale. `payOrder` books the Phase 7 POS sale (`posSell` → `sales_daily`, stock and
 * BOM components issued) and marks the bill paid in the same transaction.
 */
import { and, eq, sql } from 'drizzle-orm';
import { apptClash, apptConfig, netOfGross, orderTotal, type ApptConfig, type OrderLine } from '@wise/core/industry';
import { audit, type Tx } from '../audit';
import { appointments, firmDocs, items, type AppointmentRow, type Firm } from '../schema/index';
import { posSell } from '../stock-docs';
import { assertPartner, findOrCreatePartner, IndustryError, industryConfigOf, issueModuleInvoice, loadIndustryFirm, n, type IndActor } from './context';

const fail = (m: string): never => { throw new IndustryError(m); };
export const firmApptConfig = (f: Pick<Firm, 'settings'>): ApptConfig => apptConfig(industryConfigOf<ApptConfig>(f, 'appt'));

/* ================================================================== firm_docs helpers */

export interface RestaurantTable { no: string; area: string; seats: number }
export interface RestaurantOrder { tableId: string; opened: string; waiter: string; lines: OrderLine[]; paidAt?: string | null; salesDayId?: string | null }
export interface ClientNote { partnerId: string; title: string; text: string; conf: boolean; by?: string | null }
export interface FreightDoc { who: 'veh' | 'drv'; ref: string; kind: string; no?: string; validFrom?: string | null; validTo?: string | null; note?: string }
export interface FuelImport { name: string; rows: { d: string; plate: string; ctry?: string; prod?: string; qty: number; amt: number; cur: string }[] }
export type IndustryDocType = 'rtable' | 'rord' | 'cnote' | 'frdoc' | 'frfuel';

export async function listDocs<T>(tx: Tx, firmId: string, type: IndustryDocType, status?: string) {
  const R = await tx.select().from(firmDocs).where(and(eq(firmDocs.firmId, firmId), eq(firmDocs.type, type), status ? eq(firmDocs.status, status) : undefined));
  return R.map((r) => ({ id: r.id, number: r.number, date: r.date, status: r.status, data: r.data as unknown as T }));
}
async function getDoc<T>(tx: Tx, firmId: string, type: IndustryDocType, id: string) {
  const [r] = await tx.select().from(firmDocs).where(and(eq(firmDocs.id, id), eq(firmDocs.firmId, firmId), eq(firmDocs.type, type))).for('update').limit(1);
  return r ? { ...r, data: r.data as unknown as T } : fail('Записот не постои.');
}
export async function saveDoc<T extends object>(tx: Tx, a: IndActor, type: IndustryDocType, o: { id?: string | null; number?: string | null; date?: string | null; status?: string; data: T }): Promise<string> {
  const row = { number: o.number ?? null, date: o.date ?? null, data: o.data as unknown as Record<string, unknown>, ...(o.status ? { status: o.status } : {}) };
  let id = o.id ?? '';
  if (id) {
    const [u] = await tx.update(firmDocs).set(row).where(and(eq(firmDocs.id, id), eq(firmDocs.firmId, a.firmId), eq(firmDocs.type, type))).returning({ id: firmDocs.id });
    if (!u) fail('Записот не постои.');
  } else id = (await tx.insert(firmDocs).values({ ...row, firmId: a.firmId, type, createdBy: a.userId }).returning({ id: firmDocs.id }))[0]!.id;
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: `${type}Save`, entityType: 'firm_doc', entityId: id, data: { type } });
  return id;
}
export async function deleteDoc(tx: Tx, a: IndActor, type: IndustryDocType, id: string): Promise<void> {
  await tx.delete(firmDocs).where(and(eq(firmDocs.id, id), eq(firmDocs.firmId, a.firmId), eq(firmDocs.type, type)));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: `${type}Del`, entityType: 'firm_doc', entityId: id });
}

/* ================================================================== restaurant */

export async function saveTable(tx: Tx, a: IndActor, id: string | null, t: RestaurantTable): Promise<string> {
  await loadIndustryFirm(tx, a.firmId, 'rest');
  const no = t.no.trim() || fail('Внесете број.');
  const T = await listDocs<RestaurantTable>(tx, a.firmId, 'rtable');
  if (T.some((x) => x.id !== id && x.data.no === no)) fail('Масата постои.');
  return saveDoc(tx, a, 'rtable', { id, data: { no, area: t.area.trim() || 'Сала', seats: Math.max(1, Math.round(n(t.seats)) || 4) } });
}

/** Open bill of a table (one per table). */
export async function openOrderOf(tx: Tx, firmId: string, tableId: string) {
  return (await listDocs<RestaurantOrder>(tx, firmId, 'rord', 'open')).find((o) => o.data.tableId === tableId) ?? null;
}

/** Save the open bill's lines (legacy `roSave`); a bill with no lines is not created. */
export async function saveOrder(tx: Tx, a: IndActor, tableId: string, lines: OrderLine[], waiter: string, now: string): Promise<string | null> {
  await loadIndustryFirm(tx, a.firmId, 'rest');
  const o = await openOrderOf(tx, a.firmId, tableId);
  if (!o && !lines.length) return null;
  const old = o?.data.lines ?? [];
  // keep the kitchen's "ready" marks (legacy roEditor 9968)
  const L = lines.map((l, i) => (old[i] && old[i]!.itemId === l.itemId && old[i]!.ready ? { ...l, ready: old[i]!.ready } : l));
  return saveDoc(tx, a, 'rord', { id: o?.id ?? null, date: now.slice(0, 10), status: 'open', data: { tableId, opened: o?.data.opened ?? now, waiter: waiter || o?.data.waiter || '', lines: L } });
}

/** Legacy `kjReady`. */
export async function markLineReady(tx: Tx, a: IndActor, orderId: string, i: number, now: string): Promise<void> {
  const o = await getDoc<RestaurantOrder>(tx, a.firmId, 'rord', orderId);
  const L = o.data.lines.map((l, k) => (k === i ? { ...l, ready: now } : l));
  await saveDoc(tx, a, 'rord', { id: orderId, data: { ...o.data, lines: L } });
}

/** FIX 10.4 item 10: pay = POS sale (Phase 7) + bill closed, in one transaction. `wh` = store / warehouse id or null. */
export async function payOrder(tx: Tx, a: IndActor, orderId: string, o2: { date: string; wh?: string | null; card?: number | null; now: string }): Promise<{ salesDayId: string; total: number }> {
  await loadIndustryFirm(tx, a.firmId, 'rest');
  const o = await getDoc<RestaurantOrder>(tx, a.firmId, 'rord', orderId);
  if (o.status !== 'open') fail('Сметката е веќе затворена.');
  if (!o.data.lines.length) fail('Сметката е празна.');
  const total = orderTotal(o.data.lines);
  const day = await posSell(tx, { firmId: a.firmId, userId: a.userId }, { date: o2.date, wh: o2.wh ?? null, card: o2.card ? Math.min(total, o2.card) : null, cart: o.data.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, price: l.price, rate: l.rate })) });
  await saveDoc(tx, a, 'rord', { id: orderId, status: 'paid', data: { ...o.data, paidAt: o2.now, salesDayId: day.id } });
  return { salesDayId: day.id, total };
}

/** Legacy `roClose`: void an empty / cancelled bill. */
export async function voidOrder(tx: Tx, a: IndActor, orderId: string): Promise<void> {
  const o = await getDoc<RestaurantOrder>(tx, a.firmId, 'rord', orderId);
  if (o.data.lines.some((l) => l.sent) && o.data.lines.length) fail('Сметката има ставки испратени во кујна – намалете ги пред затворање.');
  await saveDoc(tx, a, 'rord', { id: orderId, status: 'void', data: o.data });
}

/* ================================================================== appointments */

export interface ApptInput {
  id?: string | null; date: string; time: string; dur?: number | null; res: string; partnerId?: string | null; client?: string | null;
  phone?: string | null; email?: string | null; svc?: string | null; itemId?: string | null; price?: number | null; status?: AppointmentRow['status']; note?: string | null;
}

async function ownAppt(tx: Tx, firmId: string, id: string): Promise<AppointmentRow> {
  const [r] = await tx.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.firmId, firmId))).for('update').limit(1);
  return r ?? fail('Терминот не постои.');
}

/** Legacy `apSaveB`: client required (a new name creates the client card), resource required; returns the clash, if any. */
export async function saveAppointment(tx: Tx, a: IndActor, x: ApptInput): Promise<{ id: string; clash: string | null }> {
  await loadIndustryFirm(tx, a.firmId, 'appt');
  const prev = x.id ? await ownAppt(tx, a.firmId, x.id) : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date) || !/^\d{1,2}:\d{2}$/.test(x.time)) fail('Внесете датум и час.');
  if (!x.res) fail('Изберете кај кого.');
  let partnerId = await assertPartner(tx, a.firmId, x.partnerId);
  if (!partnerId && !x.client?.trim()) fail('Изберете клиент или внесете име.');
  if (!partnerId) partnerId = await findOrCreatePartner(tx, a.firmId, x.client!, { phone: x.phone, email: x.email });
  if (x.itemId) {
    const [it] = await tx.select({ id: items.id }).from(items).where(and(eq(items.id, x.itemId), eq(items.firmId, a.firmId))).limit(1);
    if (!it) fail('Услугата не постои.');
  }
  const row = {
    date: x.date, time: x.time.padStart(5, '0'), dur: Math.max(5, Math.round(n(x.dur)) || 30), res: x.res, partnerId, client: x.client?.trim() || null,
    phone: x.phone?.trim() || null, email: x.email?.trim() || null, svc: x.svc?.trim() || null, itemId: x.itemId || null, price: x.price ? (Math.round(x.price * 100) / 100).toFixed(2) : null,
    status: x.status ?? prev?.status ?? 'booked', note: x.note?.trim() || null,
  };
  const day = await tx.select().from(appointments).where(and(eq(appointments.firmId, a.firmId), eq(appointments.date, x.date)));
  const c = apptClash(day, { ...row, id: prev?.id ?? null });
  let id = prev?.id ?? '';
  if (prev) await tx.update(appointments).set(row).where(eq(appointments.id, id));
  else id = (await tx.insert(appointments).values({ ...row, firmId: a.firmId }).returning({ id: appointments.id }))[0]!.id;
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: prev ? 'apSave' : 'apNew', entityType: 'appointment', entityId: id, data: { date: x.date, time: x.time, res: x.res } });
  return { id, clash: c ? `${c.time}` : null };
}

export async function setApptStatus(tx: Tx, a: IndActor, id: string, status: AppointmentRow['status'] | 'reminded'): Promise<AppointmentRow> {
  const r = await ownAppt(tx, a.firmId, id);
  if (status === 'reminded') await tx.update(appointments).set({ remindAt: new Date() }).where(eq(appointments.id, id));
  else await tx.update(appointments).set({ status }).where(eq(appointments.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: status === 'cancel' ? 'apCancel' : status === 'reminded' ? 'apRem' : 'apStatus', entityType: 'appointment', entityId: id, data: { status } });
  return r;
}

async function apptLine(tx: Tx, f: Firm, r: AppointmentRow) {
  const [it] = r.itemId ? await tx.select().from(items).where(eq(items.id, r.itemId)).limit(1) : await tx.select().from(items).where(and(eq(items.firmId, f.id), eq(items.type, 'service'), sql`${items.name} = ${r.svc ?? ''}`)).limit(1);
  const rate = it ? it.vatRate : firmApptConfig(f).rate;
  return { it, rate };
}

/** Legacy `apKasa`: the service is sold at the till (Phase 7 POS day); the appointment is done. */
export async function payApptAtTill(tx: Tx, a: IndActor, id: string, date: string, wh?: string | null): Promise<string> {
  const f = await loadIndustryFirm(tx, a.firmId, 'appt');
  const r = await ownAppt(tx, a.firmId, id);
  if (!(n(r.price) > 0)) fail('Терминот нема цена.');
  if (r.invoiceId || r.salesDayId) fail('Терминот е веќе наплатен.');
  const { it, rate } = await apptLine(tx, f, r);
  if (!it) fail('За наплата на каса услугата мора да е артикл (Шифрарник → Производи и артикли, тип „услуга“).');
  const day = await posSell(tx, { firmId: a.firmId, userId: a.userId }, { date, wh: wh ?? null, cart: [{ itemId: it!.id, qty: 1, price: n(r.price), rate }] });
  await tx.update(appointments).set({ status: 'done', salesDayId: day.id }).where(eq(appointments.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'apKasa', entityType: 'appointment', entityId: id, data: { total: n(r.price) } });
  return day.id;
}

/** Legacy `apInv`: invoice of the appointment (gross price → net at the service's rate). */
export async function invoiceAppointment(tx: Tx, a: IndActor, id: string, date: string) {
  const f = await loadIndustryFirm(tx, a.firmId, 'appt');
  const r = await ownAppt(tx, a.firmId, id);
  if (!(n(r.price) > 0)) fail('Терминот нема цена.');
  if (r.invoiceId || r.salesDayId) fail('Терминот е веќе наплатен.');
  if (!r.partnerId) fail('Терминот нема клиент.');
  const { it, rate } = await apptLine(tx, f, r);
  const inv = await issueModuleInvoice(tx, a, {
    partnerId: r.partnerId!, date, note: `Термин ${r.date.split('-').reverse().join('.')} ${r.time}`, data: { source: { type: 'appointment', id: r.id } },
    lines: [{ itemId: it?.id ?? null, name: `${r.svc || 'Услуга'} – ${r.date.split('-').reverse().join('.')}`, unit: 'ком', qty: 1, price: netOfGross(n(r.price), rate), rate, account: it?.revenueAccount || null }],
  });
  await tx.update(appointments).set({ status: 'done', invoiceId: inv.id }).where(eq(appointments.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'apInv', entityType: 'appointment', entityId: id, data: { invoice: inv.number } });
  return inv;
}
