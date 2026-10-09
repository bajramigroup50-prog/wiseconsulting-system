/**
 * VAT due for the last finished VAT period (legacy autopilot step 4 `ddvFor(prevPeriod(cur))` 16269, ПП50 VAT
 * template `ppTaxNew('ddv')` 15772, `periodDue` 3747). Used by the office autopilot and the payment-order screen.
 *
 * A closed (filed) period returns the filed field 31 from its frozen snapshot; an open one is computed from
 * `defaultVatSource` (documents + manual VAT journals) with the period's saved corrections (field 30).
 */
import { and, eq } from 'drizzle-orm';
import { periodDue, periodOf, perRange } from '@wise/core';
import type { Tx } from './audit';
import { firms, vatPeriods } from './schema/index';
import { computeVatPeriod, firmVatPeriodKind } from './vat-service';
import { defaultVatSource } from './vat-source';

export interface VatDueEstimate {
  period: string;
  from: string;
  to: string;
  /** ISO due date (25th of the month after the period, legacy periodDue) */
  due: string;
  /** denars, positive = payable, negative = refund */
  amount: number;
  closed: boolean;
}

/** The VAT period before the one containing `date` (legacy `prevPeriod`). */
export function previousVatPeriod(date: string, kind: 'month' | 'quarter'): string {
  const [a] = perRange(periodOf(date, kind));
  const d = new Date(a + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return periodOf(d.toISOString().slice(0, 10), kind);
}

/** VAT estimate for the last finished VAT period before `today` (legacy autopilot step 4 / `ddvFor(prevPeriod)`); null when the firm is not VAT-registered. */
export async function vatDueEstimate(tx: Tx, firmId: string, today: string): Promise<VatDueEstimate | null> {
  const [firm] = await tx.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!firm?.vatRegistered) return null;
  const period = previousVatPeriod(today, firmVatPeriodKind(firm));
  const [from, to] = perRange(period);
  const due = periodDue(period);
  const [row] = await tx.select().from(vatPeriods).where(and(eq(vatPeriods.firmId, firmId), eq(vatPeriods.period, period))).limit(1);
  if (row?.status === 'closed' && row.ddv04) {
    return { period, from, to, due, amount: row.ddv04.fields['31'] ?? 0, closed: true };
  }
  const C = await computeVatPeriod(tx, firm, period, defaultVatSource, row?.corrections ?? {});
  return { period, from, to, due, amount: C.fields['31'] ?? 0, closed: false };
}
