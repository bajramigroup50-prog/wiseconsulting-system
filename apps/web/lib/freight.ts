import 'server-only';
/**
 * Freight (превоз за трети лица) page context: per-diem rates (firm overrides), FX lookup, fuel-card rows, vehicles,
 * drivers and licences — what legacy `frDnev`, `frCost`, `frTourFuel`, `frExp` read from `S.data`.
 */
import { asc, eq } from 'drizzle-orm';
import { frCost, frPerDiems, frPriceMkd, tourFuel, type FreightSegment } from '@wise/core/industry';
import { employees, fleetVehicles, industryConfigOf, listDocs, type FreightDoc, type Firm } from '@wise/db';
import { db } from './db';
import { fuelImports, fuelRowsOf, fxLookup } from './fuel';

export type FrRates = Record<string, [number, string]>;
export const freightRates = (firm: Firm): FrRates => (industryConfigOf<{ rates: FrRates }>(firm, 'frt').rates ?? {}) as FrRates;

export async function freightContext(firm: Firm) {
  const [fx, I, V, E, docs] = await Promise.all([
    fxLookup(firm.id),
    fuelImports(firm.id),
    db().select().from(fleetVehicles).where(eq(fleetVehicles.firmId, firm.id)).orderBy(asc(fleetVehicles.plate)),
    db().select({ id: employees.id, name: employees.name, active: employees.active }).from(employees).where(eq(employees.firmId, firm.id)).orderBy(asc(employees.name)),
    listDocs<FreightDoc>(db(), firm.id, 'frdoc'),
  ]);
  const rates = freightRates(firm);
  const fuelRows = fuelRowsOf(I);
  const plate = (id: string | null | undefined) => (id ? V.find((v) => v.id === id)?.plate ?? '' : '');
  const driver = (id: string | null | undefined) => (id ? E.find((e) => e.id === id)?.name ?? '' : '');
  type T = { date: string; unloadDate?: string | null; retDate?: string | null; red?: number | null; segs: FreightSegment[]; vehicleId?: string | null; price?: string | number | null; cur?: string | null; fx?: string | number | null; tolls?: string | number | null; tollCur?: string | null; otherCost?: string | number | null };
  const dn = (t: Pick<T, 'red' | 'segs' | 'date'>) => frPerDiems({ red: t.red, segs: t.segs, date: t.date }, fx, rates);
  const fuel = (t: T) => tourFuel(fuelRows, plate(t.vehicleId), t, fx);
  const econ = (t: T) => {
    const rev = frPriceMkd(t, fx);
    const cost = frCost(t, fuel(t).mkd, dn(t).mkd, fx);
    return { rev, cost, diff: Math.round((rev - cost.total) * 100) / 100 };
  };
  const docLabel = (d: FreightDoc) => (d.who === 'drv' ? driver(d.ref) : plate(d.ref));
  return { fx, rates, fuelRows, imports: I, V, E, docs, plate, driver, dn, fuel, econ, docLabel };
}
