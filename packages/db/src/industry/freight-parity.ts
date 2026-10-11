/**
 * Freight for third parties — legacy parity services (legacy 14498–14706): invoice from tours with the legacy texts and
 * `pdate` (`ACT.frInv` + `saveInv` patch 14549), quick add of a vehicle / trailer / driver from the tour editor
 * (`ACT.frQuickSave` 14697), licences and documents (`ACT.frDocSave` 14618 + an Excel import), per-diem amounts
 * (`ACT.frCfgSave` 14598). Every service checks the `frt` module and writes `audit_log` in the caller's transaction.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { schemeValue } from '@wise/core';
import {
  FR_DOC_DRIVER, FR_DOC_VEHICLE, frDocError, frDocImport, frInvoicePlan, frNextEmployeeNo, frParseRates, frQuickDriverError, frQuickVehicleError, frQuickVehicleName,
  type FrDocLike,
} from '@wise/core/industry';
import { audit, type Tx } from '../audit';
import { employees, firmDocs, fleetVehicles, freightTours } from '../schema/index';
import { firmPostingContext } from '../sales/context';
import { saveInvoice } from '../sales/invoices';
import { IndustryError, loadIndustryFirm, saveIndustryConfig, type IndActor } from './context';

const MOD = 'frt';
const fail = (m: string): never => { throw new IndustryError(m); };

/**
 * Legacy `ACT.frInv` → one Phase 3 invoice for the selected tours (one client, one currency), legacy line / note texts,
 * `pdate` = the latest unloading date, `revService` konto. The tours become `inv` with the invoice id (legacy `saveInv`
 * patch). As legacy (`S.draft` → „Нацрт-фактура од N тури – проверете и зачувајте.“) the invoice is an unbooked DRAFT
 * that the caller opens in the invoice editor; it is booked when the user saves it there.
 */
export async function invoiceFreightToursParity(tx: Tx, a: IndActor, ids: readonly string[], date: string, fx: (cur: string, d: string) => number) {
  const f = await loadIndustryFirm(tx, a.firmId, MOD, a);
  if (!ids.length) fail('Изберете тури.');
  const T = await tx.select().from(freightTours).where(and(eq(freightTours.firmId, a.firmId), inArray(freightTours.id, [...ids]), isNull(freightTours.invoiceId))).for('update');
  const plates = new Map((await tx.select({ id: fleetVehicles.id, plate: fleetVehicles.plate }).from(fleetVehicles).where(eq(fleetVehicles.firmId, a.firmId))).map((v) => [v.id, v.plate]));
  const plan = frInvoicePlan(T, { plate: (id) => plates.get(id), fx, date });
  if ('error' in plan) return fail(plan.error);
  const ctx = await firmPostingContext(tx, f);
  const rev = schemeValue(ctx, 'revService') || schemeValue(ctx, 'revDefault') || '7400';
  const inv = await saveInvoice(tx, a.firmId, {
    kind: 'invoice', draft: true, date, pdate: plan.pdate, partnerId: plan.partnerId, currency: plan.cur, fx: plan.cur === 'MKD' ? null : plan.fx, note: plan.note,
    data: { source: { type: 'freight_tour', id: T.map((t) => t.id).join(',') } },
    lines: plan.lines.map((l) => ({ ...l, account: rev })),
  }, a);
  await tx.update(freightTours).set({ invoiceId: inv.id, status: 'inv' }).where(inArray(freightTours.id, T.map((t) => t.id)));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'frInv', entityType: 'freight_tour', entityId: inv.id, data: { tours: T.length, invoice: inv.number } });
  return { id: inv.id, number: inv.number, tours: T.length };
}

/** Legacy `frQuickSave` (vehicle / trailer): a fleet vehicle with the plate (legacy wrote an `assets` row in ОС → Регистар). */
export async function quickFreightVehicle(tx: Tx, a: IndActor, o: { trailer: boolean; plate: string; name: string }): Promise<{ id: string; plate: string; name: string }> {
  await loadIndustryFirm(tx, a.firmId, MOD, a);
  const plate = o.plate.trim().toUpperCase();
  const all = await tx.select({ plate: fleetVehicles.plate }).from(fleetVehicles).where(eq(fleetVehicles.firmId, a.firmId));
  const e = frQuickVehicleError(plate, all.map((x) => x.plate));
  if (e) fail(e);
  const name = frQuickVehicleName(o.trailer, o.name, plate);
  const [r] = await tx.insert(fleetVehicles).values({ firmId: a.firmId, plate, name, trailer: o.trailer, active: true }).returning({ id: fleetVehicles.id });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'frQuickSave', entityType: 'fleet_vehicle', entityId: r!.id, data: { plate, trailer: o.trailer } });
  return { id: r!.id, plate, name };
}

/** Legacy `frQuickSave` (driver): an active employee „Возач“ with the next number, started today. */
export async function quickFreightDriver(tx: Tx, a: IndActor, o: { name: string; embg: string; license: string; start: string }): Promise<{ id: string; name: string }> {
  await loadIndustryFirm(tx, a.firmId, MOD, a);
  const name = o.name.trim(), embg = o.embg.trim();
  const E = await tx.select({ no: employees.no, embg: employees.embg }).from(employees).where(eq(employees.firmId, a.firmId));
  const e = frQuickDriverError(name, embg, E.map((x) => x.embg));
  if (e) fail(e);
  const [r] = await tx.insert(employees).values({
    firmId: a.firmId, no: frNextEmployeeNo(E.map((x) => x.no)), name, embg: embg || null, position: 'Возач', active: true, start: o.start, data: o.license.trim() ? { license: o.license.trim() } : {},
  }).returning({ id: employees.id });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'frQuickSave', entityType: 'employee', entityId: r!.id, data: { name } });
  return { id: r!.id, name };
}

async function ownRefs(tx: Tx, firmId: string) {
  const [V, D] = await Promise.all([
    tx.select({ id: fleetVehicles.id, plate: fleetVehicles.plate }).from(fleetVehicles).where(eq(fleetVehicles.firmId, firmId)),
    tx.select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.firmId, firmId)),
  ]);
  return { V, D };
}

/** Legacy `ACT.frDocSave`: the vehicle / driver must exist in the firm, `validTo` ≥ `validFrom`. */
export async function saveFreightDocParity(tx: Tx, a: IndActor, id: string | null, d: FrDocLike): Promise<string> {
  await loadIndustryFirm(tx, a.firmId, MOD, a);
  const e = frDocError(d);
  if (e) fail(e);
  const { V, D } = await ownRefs(tx, a.firmId);
  if (!(d.who === 'drv' ? D : V).some((x) => x.id === d.ref)) fail(d.who === 'drv' ? 'Возачот не постои.' : 'Возилото не постои.');
  const data = { who: d.who, ref: d.ref, kind: d.kind, no: d.no ?? '', validFrom: d.validFrom || null, validTo: d.validTo || null, note: d.note ?? '' };
  let docId = id ?? '';
  if (docId) {
    const [u] = await tx.update(firmDocs).set({ date: data.validTo, data }).where(and(eq(firmDocs.id, docId), eq(firmDocs.firmId, a.firmId), eq(firmDocs.type, 'frdoc'))).returning({ id: firmDocs.id });
    if (!u) fail('Записот не постои.');
  } else docId = (await tx.insert(firmDocs).values({ firmId: a.firmId, type: 'frdoc', date: data.validTo, data, createdBy: a.userId }).returning({ id: firmDocs.id }))[0]!.id;
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'frDocSave', entityType: 'firm_doc', entityId: docId, data: { kind: d.kind } });
  return docId;
}

export async function deleteFreightDocParity(tx: Tx, a: IndActor, id: string): Promise<void> {
  await loadIndustryFirm(tx, a.firmId, MOD, a);
  const [r] = await tx.delete(firmDocs).where(and(eq(firmDocs.id, id), eq(firmDocs.firmId, a.firmId), eq(firmDocs.type, 'frdoc'))).returning({ id: firmDocs.id });
  if (!r) fail('Записот не постои.');
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'frDocDel', entityType: 'firm_doc', entityId: id });
}

/** Excel import of licences / documents (template `FR_DOC_IMPORT_HEAD`); all rows or none. */
export async function importFreightDocs(tx: Tx, a: IndActor, rows: readonly (readonly string[])[]): Promise<number> {
  await loadIndustryFirm(tx, a.firmId, MOD, a);
  const { V, D } = await ownRefs(tx, a.firmId);
  const r = frDocImport(rows, V, D.map((x) => ({ id: x.id, name: x.name })), { veh: FR_DOC_VEHICLE, drv: FR_DOC_DRIVER });
  if (r.errors.length) fail(r.errors.slice(0, 5).join(' ') + (r.errors.length > 5 ? ` (+${r.errors.length - 5})` : ''));
  if (!r.docs.length) fail('Датотеката нема редови со податоци.');
  for (const d of r.docs) {
    const data = { who: d.who, ref: d.ref, kind: d.kind, no: d.no ?? '', validFrom: d.validFrom || null, validTo: d.validTo || null, note: d.note ?? '' };
    await tx.insert(firmDocs).values({ firmId: a.firmId, type: 'frdoc', date: data.validTo, data, createdBy: a.userId });
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'frDocImport', entityType: 'firm_doc', entityId: undefined, data: { n: r.docs.length } });
  return r.docs.length;
}

/** Legacy `ACT.frCfgSave`: per-diem amounts per country (`settings.industry.frt.rates`). */
export async function saveFreightRatesParity(tx: Tx, a: IndActor, entries: readonly (readonly [string, string])[]): Promise<void> {
  const f = await loadIndustryFirm(tx, a.firmId, MOD, a);
  const r = frParseRates(entries);
  if ('error' in r) return fail(r.error);
  const cur = ((((f.settings ?? {}) as Record<string, unknown>).industry ?? {}) as Record<string, Record<string, unknown>>).frt ?? {};
  await saveIndustryConfig(tx, a, 'frt', { ...cur, rates: r.rates });
}
