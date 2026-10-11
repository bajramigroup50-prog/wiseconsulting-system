/**
 * Auto service and parts (legacy ACT `woNewB … woPdf` 9681, `cvNew … cvSave` 9704, `dlToWo` 9729, `potDone`,
 * `potMail`, `autoCfgSave` 9741).
 *
 * The work-order invoice goes through the Phase 3 invoice service as in legacy `woInv` → `bzInvDraft`: the order is
 * set `done` and an unbooked DRAFT invoice (status `draft`, no journal, no stock move) is created for the owner; the
 * user reviews it in the invoice editor (`/izlez?edit=…`) and saving there books it and issues the parts from stock.
 * While the invoice is a draft the order stays editable and „Фактура“ refreshes the same draft; once the invoice is
 * booked the order is frozen. Legacy asked for confirmation when a part was short on stock; here the caller passes
 * `force`.
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { schemeValue } from '@wise/core';
import { autoConfig, nextModuleNumber, vehicleProblems, woState, workOrderInvoiceLines, type AutoConfig } from '@wise/core/industry';
import { audit, type Tx } from '../audit';
import { customerVehicles, employees, firms, invoices, items, stockMoves, workOrders, type CustomerVehicle, type Firm, type WorkOrder } from '../schema/index';
import type { WorkOrderLabour, WorkOrderPart } from '../schema/vehicles';
import { firmPostingContext } from '../sales/context';
import { deleteInvoice, saveInvoice } from '../sales/invoices';
import { assertPartner, IndustryError, industrySettings, loadIndustryFirm, n, type IndActor } from './context';

const MOD = 'auto';
const fail = (m: string): never => { throw new IndustryError(m); };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const int = (v: number | null | undefined) => (v == null || !Number.isFinite(v) || v === 0 ? null : Math.round(v));

export const firmAutoConfig = (f: Pick<Firm, 'settings'>): AutoConfig => autoConfig(industrySettings(f).auto as Partial<AutoConfig> | undefined);

/** Legacy `autoCfgSave` (`firm.auto` → `firms.settings.industry.auto`). */
export async function saveAutoConfig(tx: Tx, a: IndActor, c: Partial<AutoConfig>): Promise<void> {
  await loadIndustryFirm(tx, a.firmId, MOD, a);
  const v = { hr: n(c.hr), km: n(c.km) || 15000, mon: n(c.mon) || 12 };
  await tx.update(firms).set({
    settings: sql`jsonb_set(coalesce(${firms.settings}, '{}'::jsonb), '{industry}', coalesce(${firms.settings}->'industry', '{}'::jsonb) || jsonb_build_object('auto', ${JSON.stringify(v)}::jsonb))`,
  }).where(eq(firms.id, a.firmId));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'autoCfgSave', entityType: 'firm', entityId: a.firmId, data: v });
}

/* ---------------- customers' vehicles ---------------- */

export interface CustomerVehicleInput {
  id?: string | null; plate?: string | null; vin?: string | null; make?: string | null; model?: string | null; year?: number | null; engine?: string | null;
  fuel?: string | null; partnerId?: string | null; km?: number | null; note?: string | null;
}

/** Legacy `cvSave`: plate or VIN, no duplicate plate / VIN, plate and VIN in capitals. */
export async function saveCustomerVehicle(tx: Tx, a: IndActor, v: CustomerVehicleInput): Promise<string> {
  await loadIndustryFirm(tx, a.firmId, MOD, a);
  const plate = String(v.plate ?? '').trim().toUpperCase(), vin = String(v.vin ?? '').trim().toUpperCase();
  const others = await tx.select({ id: customerVehicles.id, plate: customerVehicles.plate, vin: customerVehicles.vin, make: customerVehicles.make, model: customerVehicles.model, year: customerVehicles.year })
    .from(customerVehicles).where(eq(customerVehicles.firmId, a.firmId));
  const p = vehicleProblems({ id: v.id, plate, vin }, others);
  if (p) fail(p);
  const partnerId = await assertPartner(tx, a.firmId, v.partnerId);
  const row = {
    plate: plate || null, vin: vin || null, make: v.make?.trim() || null, model: v.model?.trim() || null, year: int(v.year), engine: v.engine?.trim() || null,
    fuel: v.fuel?.trim() || null, partnerId, km: int(v.km), note: v.note?.trim() || null,
  };
  let id = v.id ?? '';
  if (id) {
    const [u] = await tx.update(customerVehicles).set(row).where(and(eq(customerVehicles.id, id), eq(customerVehicles.firmId, a.firmId))).returning({ id: customerVehicles.id });
    if (!u) fail('Возилото не постои.');
  } else id = (await tx.insert(customerVehicles).values({ ...row, firmId: a.firmId }).returning({ id: customerVehicles.id }))[0]!.id;
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: v.id ? 'cvSave' : 'cvNew', entityType: 'customer_vehicle', entityId: id, data: { plate, vin } });
  return id;
}

async function ownVehicle(tx: Tx, firmId: string, id: string): Promise<CustomerVehicle> {
  const [v] = await tx.select().from(customerVehicles).where(and(eq(customerVehicles.id, id), eq(customerVehicles.firmId, firmId))).limit(1);
  return v ?? fail('Возилото не постои.');
}

/** Legacy `potDone` / after `potMail`: owner contacted — hidden from the reminders for 30 days. */
export async function markVehicleReminded(tx: Tx, a: IndActor, id: string, date: string, via: 'call' | 'mail' = 'call'): Promise<void> {
  await loadIndustryFirm(tx, a.firmId, MOD, a);
  const v = await ownVehicle(tx, a.firmId, id);
  await tx.update(customerVehicles).set({ remindAt: date }).where(eq(customerVehicles.id, v.id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: via === 'mail' ? 'potMail' : 'potDone', entityType: 'customer_vehicle', entityId: v.id, data: { plate: v.plate } });
}

/* ---------------- work orders ---------------- */

export interface WorkOrderInput {
  id?: string | null; number?: string | null; date: string; vehicleId: string; partnerId: string; km?: number | null; complaint?: string | null; work?: string | null;
  parts: WorkOrderPart[]; labour: WorkOrderLabour[]; status?: 'open' | 'work' | 'done'; mechanicId?: string | null;
  nextKm?: number | null; nextDate?: string | null; nextNote?: string | null;
}

async function ownOrder(tx: Tx, firmId: string, id: string): Promise<WorkOrder> {
  const [w] = await tx.select().from(workOrders).where(and(eq(workOrders.id, id), eq(workOrders.firmId, firmId))).for('update').limit(1);
  return w ?? fail('Работниот налог не постои.');
}

/** Status of the order's invoice (`draft` = legacy `bzInvDraft` not saved yet), null without an invoice. */
async function invoiceStatusOf(tx: Tx, invoiceId: string | null): Promise<string | null> {
  if (!invoiceId) return null;
  const [i] = await tx.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  return i?.status ?? null;
}

/** Next number `РН-001/2026` (legacy `bzNextNo('wo', 'РН-', date)`). */
export async function nextWorkOrderNumber(tx: Tx, firmId: string, date: string): Promise<string> {
  const y = date.slice(0, 4);
  const used = (await tx.select({ n: workOrders.number }).from(workOrders).where(and(eq(workOrders.firmId, firmId), sql`${workOrders.number} like ${'%/' + y}`))).map((x) => x.n);
  return nextModuleNumber('РН-', used, y);
}

/**
 * Legacy `woSaveB`: vehicle and owner required; invoiced orders are frozen; parts must be items of the firm; the
 * vehicle's km is raised to the order's km. A taken number becomes the next free one.
 */
export async function saveWorkOrder(tx: Tx, a: IndActor, w: WorkOrderInput): Promise<{ id: string; number: string }> {
  await loadIndustryFirm(tx, a.firmId, MOD, a);
  const prev = w.id ? await ownOrder(tx, a.firmId, w.id) : null;
  if (prev?.invoiceId && (await invoiceStatusOf(tx, prev.invoiceId)) !== 'draft') fail('Работниот налог е фактуриран.');
  if (!DAY.test(w.date)) fail('Внесете датум.');
  if (!w.vehicleId) fail('Изберете возило.');
  const v = await ownVehicle(tx, a.firmId, w.vehicleId);
  if (!w.partnerId) fail('Изберете сопственик / комитент.');
  const partnerId = (await assertPartner(tx, a.firmId, w.partnerId))!;
  if (w.mechanicId) {
    const [m] = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, w.mechanicId), eq(employees.firmId, a.firmId))).limit(1);
    if (!m) fail('Механичарот не постои.');
  }
  const ids = [...new Set([...w.parts, ...w.labour].map((p) => p.itemId).filter((x): x is string => !!x))];
  if (ids.length) {
    const ok = await tx.select({ id: items.id }).from(items).where(and(eq(items.firmId, a.firmId), inArray(items.id, ids)));
    if (ok.length !== ids.length) fail('Некој од артиклите не постои во оваа фирма.');
  }
  const parts = w.parts.filter((p) => p.name && n(p.qty)).map((p) => ({ itemId: p.itemId || null, name: p.name.trim(), qty: n(p.qty), price: n(p.price), disc: n(p.disc) || 0, rate: n(p.rate) }));
  const labour = w.labour.filter((l) => l.name && n(l.hrs)).map((l) => ({ itemId: l.itemId || null, name: l.name.trim(), hrs: n(l.hrs), price: n(l.price), rate: n(l.rate) }));
  if (parts.some((p) => p.qty < 0 || p.price < 0) || labour.some((l) => l.hrs < 0 || l.price < 0)) fail('Количините и цените не може да се негативни.');
  if (w.nextDate && !DAY.test(w.nextDate)) fail('Неважечки датум за следен сервис.');
  const used = (await tx.select({ n: workOrders.number }).from(workOrders).where(and(eq(workOrders.firmId, a.firmId), prev ? ne(workOrders.id, prev.id) : undefined))).map((x) => x.n);
  let number = w.number?.trim() || prev?.number || '';
  if (!number || used.includes(number)) number = nextModuleNumber('РН-', used.filter((x) => x.endsWith('/' + w.date.slice(0, 4))), w.date.slice(0, 4));
  const row = {
    number, date: w.date, vehicleId: v.id, plate: v.plate, partnerId, km: int(w.km), complaint: w.complaint?.trim() || null, work: w.work?.trim() || null,
    parts, labour, status: w.status ?? 'open', mechanicId: w.mechanicId || null, nextKm: int(w.nextKm), nextDate: w.nextDate || null, nextNote: w.nextNote?.trim() || null,
  };
  let id = prev?.id ?? '';
  if (prev) await tx.update(workOrders).set(row).where(eq(workOrders.id, id));
  else id = (await tx.insert(workOrders).values({ ...row, firmId: a.firmId, createdBy: a.userId }).returning({ id: workOrders.id }))[0]!.id;
  if (row.km && row.km > (v.km ?? 0)) await tx.update(customerVehicles).set({ km: row.km }).where(eq(customerVehicles.id, v.id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: prev ? 'woSaveB' : 'woNew', entityType: 'work_order', entityId: id, data: { number, plate: v.plate, status: row.status } });
  return { id, number };
}

/**
 * Not in legacy (orders could not be deleted): an order that is not invoiced may be removed by a user with `del`;
 * its unbooked draft invoice goes with it.
 */
export async function deleteWorkOrder(tx: Tx, a: IndActor, id: string): Promise<void> {
  await loadIndustryFirm(tx, a.firmId, MOD, a);
  const w = await ownOrder(tx, a.firmId, id);
  if (w.invoiceId && (await invoiceStatusOf(tx, w.invoiceId)) !== 'draft') fail('Работниот налог е фактуриран.');
  await tx.delete(workOrders).where(eq(workOrders.id, id));
  if (w.invoiceId) await deleteInvoice(tx, a.firmId, w.invoiceId, a);
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'woDel', entityType: 'work_order', entityId: id, data: { number: w.number } });
}

/** On-hand quantity per item (all warehouses, approved moves) — legacy `stock(id).qty`. */
export async function stockOnHand(tx: Tx, firmId: string, itemIds?: readonly string[]): Promise<Map<string, number>> {
  if (itemIds && !itemIds.length) return new Map();
  const R = await tx.select({ id: stockMoves.itemId, q: sql<string>`sum(${stockMoves.qty})` }).from(stockMoves)
    .where(and(eq(stockMoves.firmId, firmId), eq(stockMoves.pending, false), itemIds ? inArray(stockMoves.itemId, [...itemIds]) : undefined)).groupBy(stockMoves.itemId);
  return new Map(R.map((r) => [r.id, Math.round(Number(r.q) * 1000) / 1000]));
}

/**
 * Legacy `woInv` → `bzInvDraft`: status `done` and a DRAFT invoice to the owner with parts and labour, note
 * `Работен налог РН-… · возило … · … км` — nothing is booked and no part leaves stock until the user saves the
 * invoice in the invoice editor. An existing draft of the order is refreshed instead of a second one. Short stock
 * fails unless `force` (legacy confirm „Нема доволно залиха за: … Сепак да се фактурира?“).
 */
export async function invoiceWorkOrder(tx: Tx, a: IndActor, id: string, date: string, force = false): Promise<{ id: string; number: string; warnings: string[] }> {
  const f = await loadIndustryFirm(tx, a.firmId, MOD, a);
  const w = await ownOrder(tx, a.firmId, id);
  const prevStatus = await invoiceStatusOf(tx, w.invoiceId);
  if (w.invoiceId && prevStatus !== 'draft' && prevStatus !== null) fail('Работниот налог е веќе фактуриран.');
  if (!w.parts.length && !w.labour.length) fail('Нема делови ни работа.');
  const pIds = w.parts.map((p) => p.itemId).filter((x): x is string => !!x);
  const I = pIds.length ? await tx.select({ id: items.id, unit: items.unit, type: items.type }).from(items).where(and(eq(items.firmId, a.firmId), inArray(items.id, pIds))) : [];
  if (!force) {
    const S = await stockOnHand(tx, a.firmId, pIds);
    const short = w.parts.filter((p) => p.itemId && I.find((i) => i.id === p.itemId)?.type !== 'service' && (S.get(p.itemId) ?? 0) < n(p.qty));
    if (short.length) fail(`Нема доволно залиха за: ${short.map((p) => p.name).join(', ')}. Потврдете „Сепак фактурирај“.`);
  }
  const ctx = await firmPostingContext(tx, f);
  const svc = schemeValue(ctx, 'revService') || schemeValue(ctx, 'revDefault');
  const lines = workOrderInvoiceLines(w, (iid) => I.find((i) => i.id === iid)?.unit, svc);
  const r = await saveInvoice(tx, a.firmId, {
    id: prevStatus === 'draft' ? w.invoiceId : null, draft: true,
    kind: 'invoice', date, partnerId: w.partnerId, lines,
    note: `Работен налог ${w.number} · возило ${w.plate ?? ''}${w.km ? ` · ${w.km} км` : ''}`,
    data: { workOrder: w.number, source: { type: 'work_order', id: w.id } },
  }, a);
  await tx.update(workOrders).set({ invoiceId: r.id, status: 'done' }).where(eq(workOrders.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'woInv', entityType: 'work_order', entityId: id, data: { number: w.number, invoice: r.number, draft: true, force } });
  return { id: r.id, number: r.number, warnings: r.warnings };
}

export const workOrderState = woState;
