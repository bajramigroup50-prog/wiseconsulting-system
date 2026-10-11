/**
 * Auto service — legacy-parity services: the „Возила од Excel“ import (legacy `DIG.cveh` 10276, `digApply` 10312).
 * Rows are parsed and checked by `@wise/core` `vehicleImportPlan` (header recognised by name, duplicates by plate /
 * VIN skipped); the owner is found by name or created (legacy `digPartner` / `bzPartner`).
 */
import { eq } from 'drizzle-orm';
import { vehicleImportPlan } from '@wise/core/industry';
import { audit, type Tx } from '../audit';
import { customerVehicles } from '../schema/index';
import { findOrCreatePartner, IndustryError, loadIndustryFirm, type IndActor } from './context';

export async function importCustomerVehicles(tx: Tx, a: IndActor, aoa: readonly (readonly unknown[])[]): Promise<{ added: number; skipped: string[] }> {
  await loadIndustryFirm(tx, a.firmId, 'auto');
  const ex = await tx.select({ plate: customerVehicles.plate, vin: customerVehicles.vin }).from(customerVehicles).where(eq(customerVehicles.firmId, a.firmId));
  let plan: ReturnType<typeof vehicleImportPlan>;
  try { plan = vehicleImportPlan(aoa, ex); } catch (e) { throw new IndustryError(e instanceof Error ? e.message : String(e)); }
  const { add, skip } = plan;
  for (const r of add) {
    const partnerId = r.owner ? await findOrCreatePartner(tx, a.firmId, r.owner) : null;
    await tx.insert(customerVehicles).values({
      firmId: a.firmId, plate: r.plate || null, vin: r.vin || null, make: r.make || null, model: r.model || null, year: r.year, engine: r.engine || null, partnerId, km: r.km,
    });
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'cvImport', entityType: 'customer_vehicle', data: { added: add.length, skipped: skip.length } });
  return { added: add.length, skipped: skip };
}
