/**
 * Fleet and rent-a-car service (legacy ACT `rcNewB … rcCancel` 9809, `rcOut` → 11718, `rcFleetSave` 9840,
 * `rcCfgSave` 9841).
 *
 * Deposit: received with a cash receipt on the deposits konto (Phase 4 voucher); settled by offsetting against the
 * invoice (journal `kauc`: D deposits / P customer) and paying back the rest with a cash payment.
 */
import { and, eq, ne, sql } from 'drizzle-orm';
import { schemeValue } from '@wise/core';
import { nextModuleNumber, rcCalc, rentalInvoiceLines, rentalsOverlap, rentConfig, handoverProblems, type RentConfig } from '@wise/core/industry';
import { audit, type Tx } from '../audit';
import { postJournal } from '../posting';
import { fixedAssets, fleetVehicles, invoices, rentRentals, type FleetVehicle, type RentRental } from '../schema/index';
import type { RentDriver, RentHandover } from '../schema/industry';
import { firmPostingContext } from '../sales/context';
import {
  assertPartner, cashMovement, dec2, findOrCreatePartner, IndustryError, industryConfigOf, issueModuleInvoice, loadIndustryFirm, n, type IndActor,
} from './context';

const MOD = 'rent';
const fail = (m: string): never => { throw new IndustryError(m); };
const DT = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

export const firmRentConfig = (f: Parameters<typeof industryConfigOf>[0]): RentConfig => rentConfig(industryConfigOf<RentConfig>(f, 'rent'));

/* ---------------- fleet ---------------- */

export interface VehicleInput {
  id?: string | null; plate: string; name?: string | null; trailer?: boolean; active?: boolean; assetId?: string | null;
  rent?: boolean; rClass?: string | null; rDay?: number | null; rWeek?: number | null; rDep?: number | null; rKm?: number | null; rKmX?: number | null;
  odo?: number | null; fuelNorm?: number | null; capKg?: number | null; oilEvery?: number | null; oilLastKm?: number | null; tyreEvery?: number | null; tyreLastKm?: number | null;
  regExp?: string | null; insExp?: string | null; techExp?: string | null;
}
const int = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? null : Math.round(v));
const day = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Save a fleet vehicle (legacy: vehicle fields on `assets`, `rcFleetSave`). */
export async function saveVehicle(tx: Tx, a: IndActor, v: VehicleInput): Promise<string> {
  const plate = v.plate.trim().toUpperCase() || fail('Внесете регистарска ознака.');
  if (v.rent && !(n(v.rDay) > 0)) fail('Внесете цена по ден.');
  const [dup] = await tx.select({ id: fleetVehicles.id }).from(fleetVehicles).where(and(eq(fleetVehicles.firmId, a.firmId), sql`upper(${fleetVehicles.plate}) = ${plate}`, v.id ? ne(fleetVehicles.id, v.id) : undefined)).limit(1);
  if (dup) fail(`Возилото ${plate} веќе постои.`);
  if (v.assetId) {
    const [x] = await tx.select({ id: fixedAssets.id }).from(fixedAssets).where(and(eq(fixedAssets.id, v.assetId), eq(fixedAssets.firmId, a.firmId))).limit(1);
    if (!x) fail('Основното средство не постои.');
  }
  const row = {
    plate, name: v.name?.trim() || null, trailer: !!v.trailer, active: v.active !== false, assetId: v.assetId || null, rent: !!v.rent,
    rClass: v.rClass?.trim() || null, rDay: dec2(v.rDay ?? null), rWeek: dec2(v.rWeek ?? null), rDep: dec2(v.rDep ?? null), rKm: int(v.rKm), rKmX: dec2(v.rKmX ?? null),
    odo: int(v.odo), fuelNorm: v.fuelNorm == null ? null : String(v.fuelNorm), capKg: int(v.capKg), oilEvery: int(v.oilEvery), oilLastKm: int(v.oilLastKm),
    tyreEvery: int(v.tyreEvery), tyreLastKm: int(v.tyreLastKm), regExp: day(v.regExp), insExp: day(v.insExp), techExp: day(v.techExp),
  };
  let id = v.id ?? '';
  if (id) {
    const [u] = await tx.update(fleetVehicles).set(row).where(and(eq(fleetVehicles.id, id), eq(fleetVehicles.firmId, a.firmId))).returning({ id: fleetVehicles.id });
    if (!u) fail('Возилото не постои.');
  } else id = (await tx.insert(fleetVehicles).values({ ...row, firmId: a.firmId }).returning({ id: fleetVehicles.id }))[0]!.id;
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'fleetSave', entityType: 'fleet_vehicle', entityId: id, data: { plate, rent: row.rent } });
  return id;
}

/** Vehicles registered as fixed assets (legacy: assets with `vehicle`/`plate`) that are not yet in the fleet. */
export async function importFleetFromAssets(tx: Tx, a: IndActor): Promise<number> {
  const A = await tx.select().from(fixedAssets).where(and(eq(fixedAssets.firmId, a.firmId), sql`${fixedAssets.disposed} is null`));
  const have = new Set((await tx.select({ p: fleetVehicles.plate, a: fleetVehicles.assetId }).from(fleetVehicles).where(eq(fleetVehicles.firmId, a.firmId))).flatMap((x) => [x.p.toUpperCase(), x.a ?? '']));
  let k = 0;
  for (const x of A) {
    const d = x.data as Record<string, unknown>;
    const plate = String(d.plate ?? '').trim().toUpperCase();
    if (!plate || have.has(plate) || have.has(x.id)) continue;
    await tx.insert(fleetVehicles).values({
      firmId: a.firmId, assetId: x.id, plate, name: x.name, odo: int(Number(d.odo) || null), fuelNorm: d.fuelNorm ? String(d.fuelNorm) : null,
      capKg: int(Number(d.capKg) || null), regExp: day(d.regExp as string), insExp: day(d.insExp as string), techExp: day(d.techExp as string),
    });
    have.add(plate);
    k++;
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'fleetImport', entityType: 'fleet_vehicle', data: { added: k } });
  return k;
}

/* ---------------- rentals ---------------- */

export interface RentalInput {
  id?: string | null; vehicleId: string; from: string; to: string; driver: RentDriver; driver2?: string | null; partnerId?: string | null;
  deposit?: number | null; extras?: { name: string; qty: number; price: number }[]; note?: string | null; out?: RentHandover; ret?: RentHandover;
  pDay?: number | null; priceTot?: number | null; countries?: string[]; green?: boolean;
}

async function own(tx: Tx, firmId: string, id: string): Promise<RentRental> {
  const [r] = await tx.select().from(rentRentals).where(and(eq(rentRentals.id, id), eq(rentRentals.firmId, firmId))).for('update').limit(1);
  return r ?? fail('Договорот не постои.');
}
async function vehicle(tx: Tx, firmId: string, id: string): Promise<FleetVehicle> {
  const [v] = await tx.select().from(fleetVehicles).where(and(eq(fleetVehicles.id, id), eq(fleetVehicles.firmId, firmId))).limit(1);
  return v ?? fail('Возилото не постои.');
}
const asRental = (r: Pick<RentRental, 'from' | 'to' | 'pDay' | 'priceTot' | 'deposit' | 'out' | 'ret' | 'extras'>) => ({
  from: r.from, to: r.to, pDay: r.pDay, priceTot: r.priceTot, deposit: r.deposit, out: r.out, ret: r.ret, extras: r.extras,
});
export const vehicleRates = (v: Pick<FleetVehicle, 'rDay' | 'rWeek' | 'rKm' | 'rKmX'>) => ({ rDay: v.rDay, rWeek: v.rWeek, rKm: v.rKm, rKmX: v.rKmX });

/** Legacy `rcSaveB`: vehicle, driver name, dates, vehicle free (legacy `rcClash`). */
export async function saveRental(tx: Tx, a: IndActor, r: RentalInput): Promise<{ id: string; number: string }> {
  await loadIndustryFirm(tx, a.firmId, MOD);
  const prev = r.id ? await own(tx, a.firmId, r.id) : null;
  if (prev?.invoiceId) fail('Договорот е фактуриран.');
  const v = await vehicle(tx, a.firmId, r.vehicleId);
  if (!r.driver?.name?.trim()) fail('Внесете име на корисникот.');
  if (!DT.test(r.from) || !DT.test(r.to) || !(r.to > r.from)) fail('Проверете ги датумите.');
  const others = await tx.select().from(rentRentals).where(and(eq(rentRentals.firmId, a.firmId), eq(rentRentals.vehicleId, v.id), ne(rentRentals.status, 'cancel'), prev ? ne(rentRentals.id, prev.id) : undefined));
  const c = others.find((x) => !x.invoiceId && rentalsOverlap({ from: r.from, to: r.to }, asRental(x)));
  if (c) fail(`Возилото е зафатено: ${c.number}.`);
  const partnerId = await assertPartner(tx, a.firmId, r.partnerId);
  const head = {
    vehicleId: v.id, plate: v.plate, from: r.from, to: r.to, driver: { ...r.driver, name: r.driver.name.trim() }, driver2: r.driver2?.trim() || null, partnerId,
    deposit: dec2(r.deposit ?? (prev ? null : n(v.rDep) || null)), extras: (r.extras ?? prev?.extras ?? []).filter((x) => x.name && n(x.price)),
    note: r.note?.trim() || null, pDay: dec2(r.pDay ?? null), priceTot: dec2(r.priceTot ?? null), countries: r.countries?.length ? r.countries : ['MK'], green: !!r.green,
    ...(r.out ? { out: r.out } : {}), ...(r.ret ? { ret: r.ret } : {}),
  };
  let id: string, number: string;
  if (prev) {
    await tx.update(rentRentals).set(head).where(eq(rentRentals.id, prev.id));
    id = prev.id; number = prev.number;
  } else {
    const y = r.from.slice(0, 4);
    const used = (await tx.select({ n: rentRentals.number }).from(rentRentals).where(and(eq(rentRentals.firmId, a.firmId), sql`${rentRentals.number} like ${'%/' + y}`))).map((x) => x.n);
    number = nextModuleNumber('RC-', used, y);
    id = (await tx.insert(rentRentals).values({ ...head, firmId: a.firmId, number, date: new Date().toISOString().slice(0, 10), createdBy: a.userId, out: r.out ?? { fuel: 8 } }).returning({ id: rentRentals.id }))[0]!.id;
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: prev ? 'rcSave' : 'rcNew', entityType: 'rent_rental', entityId: id, data: { number, plate: v.plate, from: r.from, to: r.to } });
  return { id, number };
}

/** Legacy `rcOut` (+ 11718 checks): driver documents, phone, km/fuel at handover, minimum age warning. */
export async function handOut(tx: Tx, a: IndActor, id: string, out: RentHandover, now: string, today: string): Promise<{ ageWarning: string | null }> {
  const f = await loadIndustryFirm(tx, a.firmId, MOD);
  const r = await own(tx, a.firmId, id);
  if (r.status !== 'resv') fail('Возилото е веќе предадено.');
  const P = handoverProblems(r.driver, out, today);
  if (P.length) fail(P[0]!);
  const cfg = firmRentConfig(f);
  const b = r.driver.birth ? Math.floor((Date.parse(r.from.slice(0, 10)) - Date.parse(r.driver.birth)) / (365.2425 * 864e5)) : null;
  await tx.update(rentRentals).set({ status: 'out', out: { ...out, at: now } }).where(eq(rentRentals.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'rcOut', entityType: 'rent_rental', entityId: id, data: { number: r.number, km: out.km } });
  return { ageWarning: b != null && b < n(cfg.minAge) ? `Возачот има ${b} години (минимум ${cfg.minAge}).` : null };
}

/** Legacy `rcRet`: km / fuel at return, vehicle odometer updated; returns the amount due. */
export async function returnVehicle(tx: Tx, a: IndActor, id: string, ret: RentHandover, now: string): Promise<number> {
  const f = await loadIndustryFirm(tx, a.firmId, MOD);
  const r = await own(tx, a.firmId, id);
  if (r.status !== 'out') fail('Возилото не е кај клиент.');
  if (ret.km === '' || ret.km == null || ret.fuel === '' || ret.fuel == null) fail('Внесете км и гориво при враќањето.');
  if (n(ret.km) < n(r.out.km)) fail(`Км при враќање е помал од км при предавање (${r.out.km}).`);
  const R = { ...ret, at: now };
  await tx.update(rentRentals).set({ status: 'ret', ret: R }).where(eq(rentRentals.id, id));
  const v = await vehicle(tx, a.firmId, r.vehicleId);
  if (n(ret.km) > n(v.odo)) await tx.update(fleetVehicles).set({ odo: Math.round(n(ret.km)) }).where(eq(fleetVehicles.id, v.id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'rcRet', entityType: 'rent_rental', entityId: id, data: { number: r.number, km: ret.km } });
  return rcCalc({ ...asRental(r), ret: R }, vehicleRates(v), firmRentConfig(f)).tot;
}

export async function cancelRental(tx: Tx, a: IndActor, id: string): Promise<void> {
  const r = await own(tx, a.firmId, id);
  if (r.status !== 'resv') fail('Може да се откаже само резервација.');
  if (r.depositVoucherId && !r.depositClosed) fail('Примена е кауција – прво порамнете ја.');
  await tx.update(rentRentals).set({ status: 'cancel' }).where(eq(rentRentals.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'rcCancel', entityType: 'rent_rental', entityId: id, data: { number: r.number } });
}

async function driverPartner(tx: Tx, a: IndActor, r: RentRental) {
  return r.partnerId ?? findOrCreatePartner(tx, a.firmId, r.driver.name, { address: r.driver.addr, phone: r.driver.phone, email: r.driver.email });
}

/** Legacy `rcInv`: invoice of a returned vehicle (rent + extra km / fuel / extras). */
export async function invoiceRental(tx: Tx, a: IndActor, id: string, date: string): Promise<{ id: string; number: string; warnings: string[] }> {
  const f = await loadIndustryFirm(tx, a.firmId, MOD);
  const r = await own(tx, a.firmId, id);
  if (r.status !== 'ret') fail('Фактура се издава по враќањето на возилото.');
  if (r.invoiceId) fail('Договорот е веќе фактуриран.');
  const cfg = firmRentConfig(f);
  const v = await vehicle(tx, a.firmId, r.vehicleId);
  const k = rcCalc(asRental(r), vehicleRates(v), cfg);
  const partnerId = await driverPartner(tx, a, r);
  const inv = await issueModuleInvoice(tx, a, {
    partnerId, date, lines: rentalInvoiceLines({ ...asRental(r), plate: r.plate }, k, cfg),
    note: `Договор за изнајмување ${r.number} · ${r.driver.name}`, data: { source: { type: 'rent_rental', id: r.id } },
  });
  await tx.update(rentRentals).set({ invoiceId: inv.id, partnerId }).where(eq(rentRentals.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'rcInv', entityType: 'rent_rental', entityId: id, data: { invoice: inv.number, total: k.tot } });
  return inv;
}

/** Legacy `rcDepIn`: deposit received — cash receipt D register / P deposits konto (with the driver as partner). */
export async function receiveDeposit(tx: Tx, a: IndActor, id: string, date: string): Promise<string> {
  const f = await loadIndustryFirm(tx, a.firmId, MOD);
  const r = await own(tx, a.firmId, id);
  if (!(n(r.deposit) > 0)) fail('Договорот нема кауција.');
  if (r.depositVoucherId) fail('Кауцијата е веќе примена.');
  const cfg = firmRentConfig(f);
  const pid = await driverPartner(tx, a, r);
  const v = await cashMovement(tx, a, { kind: 'in', date, amount: n(r.deposit), konto: cfg.depK, partnerId: pid, merchant: r.driver.name, note: `Кауција – договор ${r.number} (${r.plate})` });
  await tx.update(rentRentals).set({ depositVoucherId: v.id, depositPartnerId: pid }).where(eq(rentRentals.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'rcDepIn', entityType: 'rent_rental', entityId: id, data: { voucher: v.number } });
  return v.number;
}

/**
 * Legacy `rcDepBack`: keep (offset against the unpaid invoice, journal `kauc`) and return the rest (cash payment).
 * `keep` must not exceed the deposit; keeping requires the invoice.
 */
export async function settleDeposit(tx: Tx, a: IndActor, id: string, keep: number, date: string): Promise<{ kept: number; back: number }> {
  const f = await loadIndustryFirm(tx, a.firmId, MOD);
  const r = await own(tx, a.firmId, id);
  if (!r.depositVoucherId) fail('Кауцијата не е примена.');
  if (r.depositClosed) fail('Кауцијата е веќе порамнета.');
  const cfg = firmRentConfig(f);
  const dep = n(r.deposit);
  const kept = Math.min(dep, Math.max(0, Math.round(keep * 100) / 100));
  const back = Math.round((dep - kept) * 100) / 100;
  const pid = r.depositPartnerId ?? (await driverPartner(tx, a, r));
  if (kept) {
    if (!r.invoiceId) fail('За задржување прво издадете фактура.');
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, r.invoiceId!)).limit(1);
    if (!inv) fail('Фактурата не постои.');
    const ctx = await firmPostingContext(tx, f);
    await postJournal(tx, {
      firmId: a.firmId, date, kind: 'kauc', sourceType: 'rent_deposit', sourceId: r.id, userId: a.userId,
      description: `Пребивање кауција – договор ${r.number} со фактура ${inv!.number}`,
      lines: [
        { account: cfg.depK, debit: kept, partnerId: pid, note: `Кауција ${r.number}` },
        { account: schemeValue(ctx, 'customer'), credit: kept, partnerId: inv!.partnerId, note: 'Пребиено со кауција', doc: inv!.number },
      ],
    });
  }
  let backId: string | null = null;
  if (back > 0) backId = (await cashMovement(tx, a, { kind: 'out', date, amount: back, konto: cfg.depK, partnerId: pid, merchant: r.driver.name, note: `Враќање кауција – договор ${r.number}` })).id;
  await tx.update(rentRentals).set({ depositKept: dec2(kept), depositReturnVoucherId: backId, depositClosed: true }).where(eq(rentRentals.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'rcDepBack', entityType: 'rent_rental', entityId: id, data: { kept, back } });
  return { kept, back };
}

/** Legacy `rentIzv`: per vehicle rentals, rented days within [a, b], utilisation, net revenue of the invoices, km. */
export async function rentReport(tx: Tx, firmId: string, from: string, to: string) {
  const V = await tx.select().from(fleetVehicles).where(and(eq(fleetVehicles.firmId, firmId), eq(fleetVehicles.rent, true)));
  const R = await tx.select().from(rentRentals).where(and(eq(rentRentals.firmId, firmId), sql`${rentRentals.status} in ('out','ret')`));
  const I = await tx.select({ id: invoices.id, base: invoices.base, date: invoices.date }).from(invoices).where(and(eq(invoices.firmId, firmId), sql`${invoices.date} between ${from} and ${to}`));
  const nd = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  return V.map((v) => {
    let days = 0, km = 0, cnt = 0, rev = 0;
    for (const r of R.filter((x) => x.vehicleId === v.id)) {
      const f0 = r.from.slice(0, 10), t0 = String(r.ret.at || r.to).slice(0, 10);
      const s = f0 < from ? from : f0, e = t0 > to ? to : t0;
      if (e < s) continue;
      days += Math.round((Date.parse(e) - Date.parse(s)) / 864e5) || 1;
      cnt++;
      if (n(r.ret.km) && n(r.out.km)) km += n(r.ret.km) - n(r.out.km);
      const inv = I.find((i) => i.id === r.invoiceId);
      if (inv) rev += n(inv.base);
    }
    days = Math.min(days, nd);
    return { v, n: cnt, days, km, rev: Math.round(rev * 100) / 100, util: nd ? Math.round((days / nd) * 100) : 0 };
  });
}
