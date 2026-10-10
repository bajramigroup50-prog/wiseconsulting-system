import 'server-only';
/** Shared loaders of the auto-service pages (`servis`, `vozila`, `delovi`, `potsetnici`). */
import { and, asc, eq } from 'drizzle-orm';
import { customerVehicles, itemBarcodes, items, stockOnHand } from '@wise/db';
import { db } from './db';

export interface CatalogItem {
  id: string; code: string | null; name: string; type: string; unit: string | null; price: number; rate: number;
  oe: string | null; crossRefs: string | null; fits: string | null; barcodes: string[]; stock: number;
}

/** Active items of the firm with barcodes and on-hand stock (legacy `S.data.items` + `stock(id).qty`). */
export async function partsCatalog(firmId: string): Promise<CatalogItem[]> {
  const [I, B, S] = await Promise.all([
    db().select().from(items).where(and(eq(items.firmId, firmId), eq(items.active, true))).orderBy(asc(items.name)),
    db().select({ itemId: itemBarcodes.itemId, barcode: itemBarcodes.barcode }).from(itemBarcodes).where(eq(itemBarcodes.firmId, firmId)),
    stockOnHand(db(), firmId),
  ]);
  return I.map((i) => ({
    id: i.id, code: i.code, name: i.name, type: i.type, unit: i.unit, price: Number(i.price ?? 0), rate: i.vatRate, oe: i.oe, crossRefs: i.crossRefs, fits: i.fits,
    barcodes: B.filter((b) => b.itemId === i.id).map((b) => b.barcode), stock: S.get(i.id) ?? 0,
  }));
}

export const customerVehicleList = (firmId: string) =>
  db().select().from(customerVehicles).where(eq(customerVehicles.firmId, firmId)).orderBy(asc(customerVehicles.plate));
