import 'server-only';
/**
 * Server helpers added for the legacy-parity pass of Sales & purchases (fuel VAT rule, fuel-seller banner data).
 */
import { and, eq, ne } from 'drizzle-orm';
import { fuelRule, type FuelRule } from '@wise/core/law';
import { fuelBannerData, isFuel } from '@wise/core/sales';
import { items, type Firm } from '@wise/db';
import { db } from './db';
import { loadLaw } from './law';

/** Fuel VAT rule from the law feed (legacy `fuelRule` 14353), or null. */
export async function fuelRuleNow(): Promise<FuelRule | null> {
  try { return fuelRule(await loadLaw()); } catch { return null; }
}

/** Data for the „⛽ Оваа фирма продава гориво“ banner (legacy `fuelBanner` 14368). */
export async function fuelBannerFor(firm: Firm) {
  const R = await fuelRuleNow();
  if (!R) return null;
  const I = (await db().select({ id: items.id, name: items.name, rate: items.vatRate }).from(items)
    .where(and(eq(items.firmId, firm.id), ne(items.type, 'service'), eq(items.active, true)))).filter((i) => isFuel(i.name));
  const seller = !!((firm.settings ?? {}) as Record<string, unknown>).fuelSeller;
  const b = fuelBannerData(R, new Date().toISOString().slice(0, 10), seller, I);
  return b ? { ...b, ids: I.filter((i) => i.rate !== b.rate).map((i) => i.id), names: I.filter((i) => i.rate !== b.rate).map((i) => `${i.name} (${i.rate}%)`) } : null;
}
