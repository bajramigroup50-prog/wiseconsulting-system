/**
 * Travel orders made by a transport client (патни налози), read by AI (`doc_reads`, kind `travel`) → a trip with per
 * diems (`freight_tours`, status `road` – a trip of the client's own, no customer) for the per diems abroad (`frDnev`), and the booking of those per diems:
 * Д 44001 „Дневници за службени патувања во странство“ / П 2411 „Обврски за дневници … во странство“ (one journal per
 * trip, re-posted when the trip changes). Driver by ЕМБГ or name, vehicle by plate; what is not found stays empty
 * for the office to pick in the trip editor.
 */
import { and, desc, eq } from 'drizzle-orm';
import { frNextNo, type TravelRead } from '@wise/core/industry';
import { audit, type Tx } from '../audit';
import { postJournal } from '../posting';
import { docReads, employees, fleetVehicles, freightTours } from '../schema/index';
import { saveFreightTour } from './transport';
import { IndustryError, type IndActor } from './context';

export const TRAVEL_READ_JOB = 'ai.read-doc';

export class TravelReadError extends IndustryError {}

/** Reads of the firm (newest first). */
export const travelReads = (tx: Pick<Tx, 'select'>, firmId: string) =>
  tx.select().from(docReads).where(and(eq(docReads.firmId, firmId), eq(docReads.kind, 'travel'))).orderBy(desc(docReads.createdAt)).limit(60);

const norm = (s: string) => s.toLowerCase().replace(/[^a-zа-шѓќљњџѕј0-9]+/gi, ' ').trim();

/** A trip (status „завршена“) from a read travel order; returns the tour id. */
export async function tourFromTravelRead(tx: Tx, a: IndActor, readId: string): Promise<string> {
  const [r] = await tx.select().from(docReads).where(and(eq(docReads.id, readId), eq(docReads.firmId, a.firmId))).for('update').limit(1);
  if (!r) throw new TravelReadError('Читањето не постои.');
  if (r.status === 'used' && r.refId) return r.refId;
  if (r.status !== 'done') throw new TravelReadError('Налогот сè уште не е прочитан.');
  const x = r.result as unknown as TravelRead;
  const E = await tx.select({ id: employees.id, name: employees.name, embg: employees.embg }).from(employees).where(eq(employees.firmId, a.firmId));
  const last = norm(x.driver).split(' ').slice(-1)[0] ?? '';
  const drv = (x.driverEmbg ? E.find((e) => e.embg === x.driverEmbg) : undefined)
    ?? (x.driver ? E.find((e) => norm(e.name) === norm(x.driver)) ?? (last.length > 3 ? E.find((e) => norm(e.name).split(' ').includes(last)) : undefined) : undefined);
  const V = await tx.select({ id: fleetVehicles.id, plate: fleetVehicles.plate }).from(fleetVehicles).where(eq(fleetVehicles.firmId, a.firmId));
  const pl = (s: string) => s.replace(/[^A-ZА-Ш0-9]/gi, '').toUpperCase();
  const veh = x.plate ? V.find((v) => pl(v.plate) === pl(x.plate)) : undefined;
  const date = x.departure.slice(0, 10) || x.date || new Date().toISOString().slice(0, 10);
  if (!drv) throw new TravelReadError(x.driver ? `Возачот „${x.driver}“ не е најден меѓу вработените – додајте го (Вработени) или внесете го патувањето рачно.` : 'Во налогот нема возач – внесете го патувањето рачно.');
  const used = await tx.select({ number: freightTours.number, date: freightTours.date }).from(freightTours).where(eq(freightTours.firmId, a.firmId));
  const number = x.number && !used.some((u) => u.number === x.number) ? x.number : frNextNo(used, date);
  const id = await saveFreightTour(tx, a, {
    number, date, status: 'road', orderNo: x.number || null, km: x.km ?? null, vehicleId: veh?.id ?? null, trailer: x.trailer || null, driverId: drv ? drv.id : null,
    retDate: x.ret ? x.ret.slice(0, 10) : null, vat: 'intl', red: 100, segs: x.segs,
    note: [`Од патен налог ${x.number || ''}`.trim(), x.route, !drv && x.driver ? `возач: ${x.driver} (не е најден)` : '', !veh && x.plate ? `возило: ${x.plate} (не е најдено)` : '', x.unknown.length ? `непознати држави: ${x.unknown.join(', ')}` : '',
      x.advance ? `аконтација ${x.advance} ${x.advanceCur}` : ''].filter(Boolean).join(' · '),
  });
  await tx.update(docReads).set({ status: 'used', refId: id }).where(eq(docReads.id, readId));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'frFromRead', entityType: 'freight_tour', entityId: id, data: { number, driver: drv?.name ?? x.driver } });
  return id;
}

/**
 * Book the per diems of a trip (`mkd` computed by the caller with the firm's rates and the NBRM rate): Д 44001 / П 2411,
 * dated on the return (or the trip date). Re-posting replaces the same journal (source `freight_perdiem` + tour id).
 */
export async function bookTourPerDiems(tx: Tx, a: IndActor, tourId: string, mkd: number, detail: string, number?: string): Promise<string> {
  const [t] = await tx.select().from(freightTours).where(and(eq(freightTours.id, tourId), eq(freightTours.firmId, a.firmId))).limit(1);
  if (!t) throw new TravelReadError('Патувањето не постои.');
  if (!(mkd > 0)) throw new TravelReadError('Нема дневници за книжење (внесете ги државите со влез и излез).');
  const [d] = t.driverId ? await tx.select({ name: employees.name }).from(employees).where(eq(employees.id, t.driverId)).limit(1) : [];
  const amt = Math.round(mkd * 100) / 100;
  const j = await postJournal(tx, {
    firmId: a.firmId, date: t.retDate || t.date, kind: 'frdn', sourceType: 'freight_perdiem', sourceId: t.id, userId: a.userId, ...(number ? { number } : {}),
    description: `Дневници во странство – ${d?.name ?? 'возач'} – патување ${t.number}`,
    lines: [
      { account: '44001', debit: amt, note: detail.slice(0, 200) },
      { account: '2411', credit: amt, note: `${d?.name ?? ''} · ${t.number}`.trim() },
    ],
  });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'frDnBook', entityType: 'freight_tour', entityId: t.id, data: { mkd: amt, nalog: j.number } });
  return j.number ?? '';
}
