/**
 * Travel orders — legacy parity services (legacy 9283–9484): stop edits of the office editor (`pnStopRm`, `pe_add`,
 * `pnManual`, the ☑ loaded checkboxes `data-pgl`), barcode loading on the phone (`pnScanCode` / `pnScanFull`),
 * „✓ Направен сега“ (`pnSvcDone`), mailed marks (`pnMail`), the delivery confirmation of an invoice (`podFor`),
 * the Excel import of vehicles and the readers of the views.
 *
 * FIX: legacy (and the first server port) took the stops array from the editor as is; the stops now always come from
 * the stored order (or the referenced documents), so booked cash / return credits / driver data cannot be overwritten
 * from the form.
 */
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { moduleOn, num, type TravelStop } from '@wise/core/industry';
import { audit, type Tx } from '../audit';
import { firms, fleetVehicles, travelOrders, type TravelOrderRow } from '../schema/index';
import { IndustryError, loadIndustryFirm, type IndActor } from './context';
import { stopsFrom, stopsOf } from './transport';

const fail = (m: string): never => { throw new IndustryError(m); };
const MOD = 'pn';

export interface TravelStopEdits {
  /** Indexes of stops to remove (legacy ✕). */
  rm?: readonly number[];
  /** `i:k` of goods ticked as loaded; `undefined` = leave the loaded flags as they are. */
  loaded?: ReadonlySet<string>;
  /** Documents to add (legacy select „+ Додај фактура / испратница / влезна фактура…“). */
  add?: readonly { type: 'invoice' | 'dispatch' | 'purchase'; id: string }[];
  /** Legacy `pnManual`. */
  manual?: { kind: 'pick' | 'deliv'; partner: string; addr?: string; goods?: string } | null;
}

/** The stops an office save writes: stored stops (or none for a new order) with the editor's changes applied. */
export async function editedTravelStops(tx: Tx, firmId: string, id: string | null, e: TravelStopEdits): Promise<TravelStop[]> {
  await loadIndustryFirm(tx, firmId);
  let S: TravelStop[] = [];
  if (id) {
    const [x] = await tx.select().from(travelOrders).where(and(eq(travelOrders.id, id), eq(travelOrders.firmId, firmId))).limit(1);
    S = x ? stopsOf(x).map((s) => ({ ...s, goods: [...(s.goods ?? [])] })) : fail('Патниот налог не постои.');
  }
  if (e.loaded) S = S.map((s, i) => ({ ...s, goods: s.goods.map((g, k) => ({ ...g, loaded: e.loaded!.has(`${i}:${k}`) })) }));
  const rm = new Set(e.rm ?? []);
  for (const i of rm) if (S[i]?.cashVoucherId || S[i]?.returnCreditId) fail(`Застанувањето „${S[i]!.partner}“ има прокнижена готовина / повратница – не може да се отстрани.`);
  S = S.filter((_, i) => !rm.has(i));
  if (e.add?.length) {
    const used = new Set((await tx.select({ s: travelOrders.stops }).from(travelOrders).where(and(eq(travelOrders.firmId, firmId), id ? ne(travelOrders.id, id) : undefined)))
      .flatMap((r) => (r.s as unknown as TravelStop[]).map((s) => (s.ref ? `${s.ref.type}:${s.ref.id}` : ''))));
    const mine = new Set(S.map((s) => (s.ref ? `${s.ref.type}:${s.ref.id}` : '')));
    const refs = e.add.filter((r) => !used.has(`${r.type}:${r.id}`) && !mine.has(`${r.type}:${r.id}`));
    if (refs.length < e.add.length) fail('Документот е веќе во патен налог.');
    S.push(...(await stopsFrom(tx, firmId, [...refs])));
  }
  const m = e.manual;
  if (m?.partner.trim()) S.push({ ref: null, kind: m.kind, doc: 'Рачно', partner: m.partner.trim(), addr: m.addr?.trim() ?? '', goods: m.goods?.trim() ? [{ name: m.goods.trim(), qty: '', unit: '', loaded: false }] : [], status: 'open' });
  return S;
}

/** Order + firm check for the phone (assignee) or an office user with `write` (`mayWrite`). */
async function phoneOrder(tx: Tx, user: { id: string }, id: string, mayWrite: (firmId: string) => boolean): Promise<TravelOrderRow> {
  const [o] = await tx.select({ o: travelOrders, mods: firms.mods }).from(travelOrders).innerJoin(firms, eq(firms.id, travelOrders.firmId)).where(eq(travelOrders.id, id)).for('update', { of: travelOrders }).limit(1);
  if (!o) fail('Патниот налог не постои.');
  if (!moduleOn(o!.mods, MOD)) fail('Модулот за патни налози не е вклучен за фирмата.');
  if (o!.o.assigneeId !== user.id && !mayWrite(o!.o.firmId)) fail('Немате дозвола за овој налог.');
  return o!.o;
}

/**
 * Legacy `pnScanCode` / `pnScanFull` auto-save: scanned quantities and loaded flags of the goods of open stops.
 * Quantities are capped at the good's quantity; done stops are not changed.
 */
export async function saveTravelLoading(tx: Tx, user: { id: string; role?: string | null }, id: string, L: readonly { i: number; k: number; lq: number }[], mayWrite: (firmId: string) => boolean): Promise<number> {
  const x = await phoneOrder(tx, user, id, mayWrite);
  if (x.status === 'done') fail('Налогот е завршен.');
  const S = stopsOf(x);
  let k = 0;
  for (const r of L) {
    const s = S[r.i];
    const g = s?.goods?.[r.k];
    if (!s || !g || s.status === 'done') continue;
    const q = num(g.qty);
    const lq = Math.max(0, Math.min(q || Infinity, Math.round(num(r.lq) * 1000) / 1000));
    s.goods[r.k] = { ...g, lq, loaded: q > 0 && lq >= q };
    k++;
  }
  await tx.update(travelOrders).set({ stops: S as unknown as Record<string, unknown>[] }).where(eq(travelOrders.id, id));
  await audit(tx, { userId: user.id, firmId: x.firmId, action: 'pnScan', entityType: 'travel_order', entityId: id, data: { goods: k } });
  return k;
}

/** Legacy `pnSvcDone`: service / tyres done at `km` — last service km, and the odometer when higher. */
export async function travelServiceDone(tx: Tx, a: IndActor, vehicleId: string, t: 'oil' | 'tyre', km: number, date: string): Promise<void> {
  await loadIndustryFirm(tx, a.firmId, MOD, a);
  if (!(km > 0)) fail('Внесете километража.');
  const [v] = await tx.select().from(fleetVehicles).where(and(eq(fleetVehicles.id, vehicleId), eq(fleetVehicles.firmId, a.firmId))).limit(1);
  if (!v) fail('Возилото не постои.');
  const k = Math.round(km);
  await tx.update(fleetVehicles).set({
    ...(t === 'oil' ? { oilLastKm: k } : { tyreLastKm: k }),
    odo: sql`greatest(coalesce(${fleetVehicles.odo}, 0), ${k})`,
  }).where(eq(fleetVehicles.id, vehicleId));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'pnSvcDone', entityType: 'fleet_vehicle', entityId: vehicleId, data: { t, km: k, date, plate: v!.plate } });
}

/** Legacy `pnMail`: stops notified by e-mail (`mailed` = time queued). */
export async function markStopsMailed(tx: Tx, a: IndActor, id: string, idx: readonly number[], at: string): Promise<void> {
  const [x] = await tx.select().from(travelOrders).where(and(eq(travelOrders.id, id), eq(travelOrders.firmId, a.firmId))).for('update').limit(1);
  if (!x) fail('Патниот налог не постои.');
  const S = stopsOf(x!);
  for (const i of idx) if (S[i]) S[i] = { ...S[i]!, mailed: at };
  await tx.update(travelOrders).set({ stops: S as unknown as Record<string, unknown>[] }).where(eq(travelOrders.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'pnMail', entityType: 'travel_order', entityId: id, data: { stops: idx.length } });
}

/** Legacy `podFor`: the delivered stop of an invoice on a travel order. */
export async function podOfInvoice(tx: Tx, firmId: string, invoiceId: string): Promise<{ x: TravelOrderRow; i: number } | null> {
  const O = await tx.select().from(travelOrders).where(and(eq(travelOrders.firmId, firmId), sql`${travelOrders.stops} @> ${JSON.stringify([{ ref: { type: 'invoice', id: invoiceId } }])}::jsonb`));
  for (const x of O) {
    const i = stopsOf(x).findIndex((s) => s.ref?.type === 'invoice' && s.ref.id === invoiceId && s.status === 'done');
    if (i >= 0) return { x, i };
  }
  return null;
}

/** The firm's latest order (legacy `pnNew` „last“). */
export async function lastTravelOrder(tx: Tx, firmId: string): Promise<TravelOrderRow | null> {
  const [x] = await tx.select().from(travelOrders).where(eq(travelOrders.firmId, firmId)).orderBy(desc(travelOrders.date), desc(travelOrders.createdAt)).limit(1);
  return x ?? null;
}

/** Legacy mojpn „Завршени“: the last 5 finished orders of the field user. */
export const doneOrdersOfAssignee = (tx: Tx, userId: string) =>
  tx.select().from(travelOrders).where(and(eq(travelOrders.assigneeId, userId), eq(travelOrders.status, 'done'))).orderBy(desc(travelOrders.date), desc(travelOrders.updatedAt)).limit(5);

/** Columns of the vehicle import / export (transport fields of the fleet). */
export const TRAVEL_VEHICLE_COLUMNS = ['Регистарска ознака', 'Назив / модел', 'Километража', 'Норма гориво л/100км', 'Носивост кг', 'Сервис на секои км', 'Последен сервис на км', 'Гуми на секои км', 'Последни гуми на км', 'Регистрација до', 'Осигурување до', 'Технички до'] as const;

const xDate = (v: string): string | null => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  const n = Number(s);
  if (Number.isFinite(n) && n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 864e5).toISOString().slice(0, 10);
  return fail(`Неважечки датум „${s}“.`);
};
const xInt = (v: string): number | null => { const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.'); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? Math.round(n) : fail(`Неважечки број „${v}“.`); };
const xNum = (v: string): string | null => { const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.'); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? String(n) : fail(`Неважечки број „${v}“.`); };

/**
 * Excel import of vehicles (header row first, columns {@link TRAVEL_VEHICLE_COLUMNS}): a plate that exists is updated
 * (only the non-empty cells), a new plate is added. Returns [added, updated].
 */
export async function importTravelVehicles(tx: Tx, a: IndActor, rows: readonly (readonly string[])[]): Promise<[number, number]> {
  await loadIndustryFirm(tx, a.firmId, MOD, a);
  const H = (rows[0] ?? []).map((x) => String(x ?? '').trim().toLowerCase());
  const col = (name: string, i: number) => { const j = H.indexOf(name.toLowerCase()); return j >= 0 ? j : i; };
  const C = TRAVEL_VEHICLE_COLUMNS.map((c, i) => col(c, i));
  let add = 0, upd = 0;
  for (const [ri, r] of rows.slice(1).entries()) {
    const g = (i: number) => String(r[C[i]!] ?? '').trim();
    const plate = g(0).toUpperCase();
    if (!plate) continue;
    try {
      const row = {
        name: g(1) || undefined, odo: xInt(g(2)) ?? undefined, fuelNorm: xNum(g(3)) ?? undefined, capKg: xInt(g(4)) ?? undefined,
        oilEvery: xInt(g(5)) ?? undefined, oilLastKm: xInt(g(6)) ?? undefined, tyreEvery: xInt(g(7)) ?? undefined, tyreLastKm: xInt(g(8)) ?? undefined,
        regExp: xDate(g(9)) ?? undefined, insExp: xDate(g(10)) ?? undefined, techExp: xDate(g(11)) ?? undefined,
      };
      const set = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
      const [v] = await tx.select({ id: fleetVehicles.id }).from(fleetVehicles).where(and(eq(fleetVehicles.firmId, a.firmId), sql`upper(${fleetVehicles.plate}) = ${plate}`)).limit(1);
      if (v) { if (Object.keys(set).length) await tx.update(fleetVehicles).set(set).where(eq(fleetVehicles.id, v.id)); upd++; }
      else { await tx.insert(fleetVehicles).values({ ...set, firmId: a.firmId, plate }); add++; }
    } catch (e) {
      if (e instanceof IndustryError) fail(`Ред ${ri + 2}: ${e.message}`);
      throw e;
    }
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'pnVehImport', entityType: 'fleet_vehicle', data: { add, upd } });
  return [add, upd];
}
