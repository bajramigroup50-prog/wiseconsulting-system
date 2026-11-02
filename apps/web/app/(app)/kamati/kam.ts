/**
 * Penalty interest per invoice like the Helix „каматна листа“: the balance open at the due date (total less what is
 * settled without a date or by then), lowered by every dated bank payment from its date, at the office rate table
 * (`kamRates`) or a fixed rate. An invoice paid late (nothing open today) still shows the interest for its late days.
 */
import { eq } from 'drizzle-orm';
import { kamSchedule, type KamRate, type KamSeg } from '@wise/core/finance';
import { appSettings, documentPayments, invoiceBankPayments, type Tx } from '@wise/db';
import { db } from '@/lib/db';

export async function kamRates(): Promise<KamRate[]> {
  const [r] = await db().select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, 'kamRates')).limit(1);
  return Array.isArray(r?.v) ? (r.v as KamRate[]) : [];
}

export interface KamRow { open: number; paidLate: number; k: number; segs: KamSeg[] }

export async function kamInvoice(tx: Tx, firmId: string, I: readonly { id: string; due: string }[], asOf: string, rate: number, rates: readonly KamRate[]): Promise<Map<string, KamRow>> {
  const out = new Map<string, KamRow>();
  if (!I.length) return out;
  const ids = I.map((i) => i.id);
  const [pay, bank] = await Promise.all([documentPayments(tx, firmId, { invoiceIds: ids }), invoiceBankPayments(tx, firmId, ids)]);
  for (const i of I) {
    const p = pay.get(i.id);
    if (!p) continue;
    const B = bank.get(i.id) ?? [];
    /* payments after the due date (up to asOf) carry their date; everything else counts as settled at the due date */
    const late = B.filter((b) => b.date > i.due && b.date <= asOf);
    const lateSum = late.reduce((a, b) => a + b.amt, 0);
    const after = B.filter((b) => b.date > asOf).reduce((a, b) => a + b.amt, 0);
    const open0 = Math.round((p.remaining + lateSum + after) * 100) / 100;
    const s = kamSchedule({ open0, due: i.due, asOf, payments: late, rates: rate > 0 ? [] : rates, rate });
    out.set(i.id, { open: Math.round((p.remaining + after) * 100) / 100, paidLate: Math.round(lateSum * 100) / 100, ...s });
  }
  return out;
}
