import 'server-only';
/** Data of the УЈП-ИДС/ПР print: the receipts of the donated goods, the meals of the period (proof of use), the decision on the public interest. */
import { inArray } from 'drizzle-orm';
import { monthSummary } from '@wise/core/meals';
import { idsFulfilled } from '@wise/core/npo';
import { items, listBeneficiaries, listDonationReceipts, mealLogsBetween, type Donation, type Firm } from '@wise/db';
import { db } from '@/lib/db';
import { todayIso } from '@/lib/fmt';
import type { IdsMeals } from './ids';

export async function idsData(firm: Firm, d: Donation) {
  const receipts = await listDonationReceipts(db(), firm.id, { donationId: d.id });
  const from = d.date, to = idsFulfilled(d) ?? todayIso();
  const B = await listBeneficiaries(db(), firm.id, true);
  let meals: IdsMeals = null;
  if (B.length && from <= to) {
    const L = await mealLogsBetween(db(), firm.id, from, to);
    const S = monthSummary(B.map((b) => ({ id: b.id, members: b.members })), L);
    if (S.tot.meals) meals = { from, to, families: S.tot.served, meals: S.tot.meals, portions: S.tot.portions, days: new Set(L.map((x) => x.date)).size };
  }
  const ids = [...new Set(receipts.flatMap((r) => r.lines.map((l) => l.itemId)))];
  const N = ids.length ? await db().select({ id: items.id, name: items.name, unit: items.unit }).from(items).where(inArray(items.id, ids)) : [];
  const nm = new Map(N.map((i) => [i.id, i.name + (i.unit ? ' ' + i.unit : '')]));
  const pi = ((firm.settings ?? {}) as { npoPI?: { no?: string | null; date?: string | null } }).npoPI ?? {};
  return { receipts, meals, pi, nameOf: (id: string) => nm.get(id) ?? '?' };
}
