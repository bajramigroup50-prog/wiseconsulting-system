import 'server-only';
/**
 * Facts per firm for `mojIzv` with one aggregated query per kind for all firms (legacy loaded every firm's collections
 * in the browser). Revenue / costs are read from the ledger (74–76, class 4 without 47/48), purchases from the base.
 */
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { miCalc, type MiFacts, type MiRange, type MiRow } from '@wise/core/firms/mojizv';
import { aiUsage, appSettings, bankLines, bankStatements, invoices, journalLines, journals, payrollEmp, payrollRuns, purchases, salesDaily, serviceContracts, type Firm } from '@wise/db';
import { db } from '@/lib/db';

export const OWNER_KEY = 'mojIzvOwner';
export const USD_MKD = 57;

export async function reportOwner(): Promise<{ id: string; name: string; at: string } | null> {
  const [r] = await db().select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, OWNER_KEY)).limit(1);
  const v = r?.v as { id?: string; name?: string; at?: string } | undefined;
  return v?.id ? { id: v.id, name: v.name ?? '', at: v.at ?? '' } : null;
}

export async function miRows(F: readonly Firm[], R: MiRange): Promise<(MiRow & { F: Firm; aiDocs: number })[]> {
  const ids = F.map((f) => f.id);
  if (!ids.length) return [];
  const between = (c: Parameters<typeof sql>[1]) => sql`${c} between ${R.from} and ${R.to}`;
  const by = <T extends { f: string }>(L: T[]) => new Map(L.map((r) => [r.f, r]));
  const [INV, PUR, BL, STM, SAL, JR, PAY, LED, CON, AI] = await Promise.all([
    db().select({ f: invoices.firmId, n: sql<number>`count(*)::int` }).from(invoices).where(and(inArray(invoices.firmId, ids), inArray(invoices.kind, ['invoice', 'credit']), ne(invoices.status, 'draft'), between(invoices.date))).groupBy(invoices.firmId),
    db().select({ f: purchases.firmId, n: sql<number>`count(*)::int`, ai: sql<number>`count(*) filter (where ${purchases.scanned})::int`, b: sql<string>`coalesce(sum(${purchases.base} * ${purchases.fx}), 0)` })
      .from(purchases).where(and(inArray(purchases.firmId, ids), ne(purchases.status, 'draft'), between(purchases.date))).groupBy(purchases.firmId),
    db().select({ f: bankLines.firmId, n: sql<number>`count(*)::int` }).from(bankLines).where(and(inArray(bankLines.firmId, ids), between(bankLines.date))).groupBy(bankLines.firmId),
    db().select({ f: bankStatements.firmId, n: sql<number>`count(*)::int` }).from(bankStatements).where(and(inArray(bankStatements.firmId, ids), between(bankStatements.date))).groupBy(bankStatements.firmId),
    db().select({ f: salesDaily.firmId, n: sql<number>`count(*)::int` }).from(salesDaily).where(and(inArray(salesDaily.firmId, ids), between(salesDaily.date))).groupBy(salesDaily.firmId),
    db().select({ f: journals.firmId, n: sql<number>`count(*)::int` }).from(journals).where(and(inArray(journals.firmId, ids), eq(journals.kind, 'manual'), between(journals.date))).groupBy(journals.firmId),
    db().select({ f: payrollRuns.firmId, run: payrollRuns.id, n: sql<number>`count(${payrollEmp.id})::int` })
      .from(payrollRuns).leftJoin(payrollEmp, eq(payrollEmp.runId, payrollRuns.id))
      .where(and(inArray(payrollRuns.firmId, ids), sql`${payrollRuns.month} between ${R.m0} and ${R.m1}`)).groupBy(payrollRuns.firmId, payrollRuns.id)
      .then((L) => { const M = new Map<string, { f: string; n: number; mx: number }>(); for (const r of L) { const o = M.get(r.f) ?? { f: r.f, n: 0, mx: 0 }; o.n += r.n; o.mx = Math.max(o.mx, r.n); M.set(r.f, o); } return [...M.values()]; }),
    db().select({
      f: journalLines.firmId,
      prih: sql<string>`coalesce(sum(case when ${journalLines.account} ~ '^7[4-6]' then ${journalLines.credit} - ${journalLines.debit} else 0 end), 0)`,
      tro: sql<string>`coalesce(sum(case when ${journalLines.account} ~ '^4' and ${journalLines.account} !~ '^4[78]' then ${journalLines.debit} - ${journalLines.credit} else 0 end), 0)`,
    }).from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
      .where(and(inArray(journalLines.firmId, ids), ne(journals.kind, 'close'), between(journals.date))).groupBy(journalLines.firmId),
    db().select({ f: serviceContracts.firmId, fee: serviceContracts.fee, start: serviceContracts.start, status: serviceContracts.status, date: serviceContracts.date })
      .from(serviceContracts).where(and(inArray(serviceContracts.firmId, ids), ne(serviceContracts.status, 'ended'))).orderBy(desc(serviceContracts.date)),
    db().select({ f: aiUsage.firmId, n: sql<number>`count(*)::int`, c: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)` }).from(aiUsage)
      .where(and(inArray(aiUsage.firmId, ids), sql`${aiUsage.at} >= ${R.from}::date and ${aiUsage.at} < (${R.to}::date + 1)`)).groupBy(aiUsage.firmId),
  ]);
  const inv = by(INV), pur = by(PUR), bl = by(BL), stm = by(STM), sal = by(SAL), jr = by(JR), pay = by(PAY), led = by(LED), ai = by(AI as { f: string; n: number; c: string }[]);
  const con = new Map<string, (typeof CON)[number]>();
  for (const c of CON) if (!con.has(c.f)) con.set(c.f, c);
  return F.map((F1) => {
    const s = (F1.settings ?? {}) as { accFee?: unknown; accFrom?: string };
    const c = con.get(F1.id);
    const fee = Number(s.accFee) || Number(c?.fee) || 0;
    const feeFrom = String(s.accFrom || c?.start || '').slice(0, 7) || null;
    const facts: MiFacts = {
      inv: inv.get(F1.id)?.n ?? 0, pur: pur.get(F1.id)?.n ?? 0, ai: pur.get(F1.id)?.ai ?? 0, stm: stm.get(F1.id)?.n ?? 0, bl: bl.get(F1.id)?.n ?? 0,
      sal: sal.get(F1.id)?.n ?? 0, jr: jr.get(F1.id)?.n ?? 0, emp: pay.get(F1.id)?.mx ?? 0, payEmp: pay.get(F1.id)?.n ?? 0,
      prih: Number(led.get(F1.id)?.prih) || 0, nab: Number(pur.get(F1.id)?.b) || 0, tro: Number(led.get(F1.id)?.tro) || 0,
      fee, feeFrom, aiUsd: Number(ai.get(F1.id)?.c) || 0,
    };
    return { ...miCalc(facts, R, USD_MKD), aiDocs: ai.get(F1.id)?.n ?? 0, F: F1 };
  });
}
