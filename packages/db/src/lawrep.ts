/**
 * Inputs of the preliminary tax review (`@wise/core/law` `lrCtx`, legacy `lrCtx` 16603 / `lrCheck` 16645) from the
 * firm's books: ledger of the year without the closing journal, account names, purchases with VAT groups, fixed
 * assets, unfiled VAT periods with the VAT payable, stock-count shortages, cash withdrawals and the pre-close profit.
 * Read-only.
 */
import { and, between, eq, inArray, lt, ne } from 'drizzle-orm';
import { lrCheck, lrCtx, lrPartnerLegal, lrVatPeriods, type LrInput, type LrResult } from '@wise/core/law';
import { simpleStatements, yeBalancesFromLines } from '@wise/core/yearend';
import { loanFlows, loanKontoDir, loanMovesFromLedger, loanState } from '@wise/core/finance';
import type { Tx } from './audit';
import { effectiveChart, loadLedgerLines } from './ledger-queries';
import { bankLines, employees, firms, fixedAssets, loans, partners, purchases, purchaseVatGroups, stockMoves, vatPeriods, type Firm } from './schema/index';
import { computeVatPeriod } from './vat-service';
import { defaultVatSource } from './vat-source';

export async function loadLawReviewInput(tx: Tx, firm: Firm, year: number, today: string): Promise<LrInput> {
  const y = String(year), from = `${y}-01-01`, to = `${y}-12-31`;
  const st = (firm.settings ?? {}) as { nkd?: string; nkdOther?: string[]; kasaCash?: string; inspProf?: { kasaMax?: number }; kasaMax?: number };
  const [L0, prev0, chart, P, Pu, A, E, popis, bank] = await Promise.all([
    loadLedgerLines(tx, firm.id, from, to),
    loadLedgerLines(tx, firm.id, `${year - 1}-01-01`, `${year - 1}-12-31`),
    effectiveChart(tx, firm.id),
    tx.select({ id: partners.id, name: partners.name, data: partners.data }).from(partners).where(eq(partners.firmId, firm.id)),
    tx.select({ id: purchases.id, date: purchases.date, number: purchases.number, partnerId: purchases.partnerId, supplierName: purchases.supplierName, art32: purchases.art32, status: purchases.status, noDed: purchases.noDed })
      .from(purchases).where(and(eq(purchases.firmId, firm.id), between(purchases.date, from, to))),
    tx.select({ konto: fixedAssets.konto, name: fixedAssets.name }).from(fixedAssets).where(eq(fixedAssets.firmId, firm.id)),
    tx.select({ id: employees.id }).from(employees).where(and(eq(employees.firmId, firm.id), eq(employees.active, true))),
    tx.select({ value: stockMoves.value }).from(stockMoves).where(and(eq(stockMoves.firmId, firm.id), eq(stockMoves.kind, 'popis'), lt(stockMoves.qty, '0'), between(stockMoves.date, from, to))),
    tx.select({ amount: bankLines.amount, konto: bankLines.konto }).from(bankLines).where(and(eq(bankLines.firmId, firm.id), between(bankLines.date, from, to), lt(bankLines.amount, '0'))),
  ]);
  const lines = L0.filter((l) => l.kind !== 'close');
  const prevRev74 = Math.round(prev0.filter((l) => l.kind !== 'close' && l.account.startsWith('74')).reduce((s, l) => s + l.credit - l.debit, 0) * 100) / 100;
  const G = Pu.length ? await tx.select({ purchaseId: purchaseVatGroups.purchaseId, account: purchaseVatGroups.account, vat: purchaseVatGroups.vat })
    .from(purchaseVatGroups).where(inArray(purchaseVatGroups.purchaseId, Pu.map((p) => p.id))) : [];
  const pname = new Map(P.map((p) => [p.id, p.name]));
  const cashAccounts = [...new Set(['1020', st.kasaCash ?? '1020'])];

  // VAT periods due and not filed (legacy: no `ddv` journal for the period)
  const per = firm.vatPeriod === 'month' ? 'month' : 'quarter';
  const vatMissing: { p: string; due: string; net: number }[] = [];
  if (firm.vatRegistered) {
    const due = lrVatPeriods(y, today, per);
    const closed = due.length ? new Set((await tx.select({ p: vatPeriods.period }).from(vatPeriods)
      .where(and(eq(vatPeriods.firmId, firm.id), eq(vatPeriods.status, 'closed'), inArray(vatPeriods.period, due.map((d) => d.p))))).map((r) => r.p)) : new Set<string>();
    for (const d of due.filter((d) => !closed.has(d.p))) {
      let net = 0;
      try { net = (await computeVatPeriod(tx, firm, d.p, defaultVatSource)).fields['31'] ?? 0; } catch { net = 0; }
      vatMissing.push({ ...d, net });
    }
  }

  let profit: number | null = null;
  try {
    const B = yeBalancesFromLines(lines);
    profit = simpleStatements(B, B, null).profit;
  } catch { profit = null; }

  return {
    firm: { name: firm.name, vat: firm.vatRegistered, per, nkd: [st.nkd ?? firm.activity, ...(st.nkdOther ?? [])], kasaMax: Number(st.inspProf?.kasaMax ?? st.kasaMax ?? 0) || 0 },
    year: y, today,
    lines: lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, date: l.date, partnerId: l.partnerId ?? null })),
    prevRev74,
    accName: Object.fromEntries(chart.map((c) => [c.code, c.name])),
    partners: Object.fromEntries(P.map((p) => [p.id, { name: p.name, legal: lrPartnerLegal(p.name, p.data as Record<string, unknown>), legalX: lrPartnerLegal(p.name, p.data as Record<string, unknown>, true) }])),
    purchases: Pu.map((p) => ({
      date: p.date, number: p.number, partnerName: (p.partnerId ? pname.get(p.partnerId) : null) ?? p.supplierName ?? '', art32: p.art32,
      // no input-VAT deduction claimed → nothing to correct
      pending: p.status !== 'posted' || p.noDed,
      groups: G.filter((g) => g.purchaseId === p.id).map((g) => ({ konto: g.account, vat: Number(g.vat) })),
    })),
    assets: A,
    vatMissing,
    employees: E.length,
    popisLoss: Math.round(popis.reduce((s, m) => s + Math.abs(Number(m.value)), 0) * 100) / 100,
    cashWithdrawals: Math.round(bank.filter((b) => b.konto && cashAccounts.includes(b.konto)).reduce((s, b) => s + Math.abs(Number(b.amount)), 0) * 100) / 100,
    cashAccounts,
    profit,
    loans: await loanRows(tx, firm, L0, P, Object.fromEntries(chart.map((c) => [c.code, c.name])), today),
  };
}

/** Loan contracts with the open balance (legacy `lnState`: repayments from the ledger, oldest contract first). */
/** Loan contracts and the ledger's loan moves of the year → `loanState` (shared with the inspection readiness). */
export async function loanStateOf(tx: Tx, firm: Pick<Firm, 'id' | 'settings'>, L0: Awaited<ReturnType<typeof loadLedgerLines>>, names: Record<string, string>, today: string) {
  const C = await tx.select().from(loans).where(eq(loans.firmId, firm.id));
  const kName = (k: string) => names[k] ?? '';
  const lines = L0.filter((l) => l.kind !== 'close' && /^[012]/.test(l.account) && loanKontoDir(l.account, kName(l.account)))
    .map((l, i) => ({ ...l, id: `${l.journalId ?? 'j'}:${l.lineNo ?? i}` }));
  const flows = loanFlows(loanMovesFromLedger(lines, kName));
  const ignored = new Set(((firm.settings ?? {}) as { lnIgnore?: string[] }).lnIgnore ?? []);
  return loanState(C.map((l) => ({ ...l, partnerId: l.partnerId, amount: Number(l.amount), rate: Number(l.rate), moveIds: l.moveIds, hasFile: false })), flows, today, ignored);
}

async function loanRows(tx: Tx, firm: Firm, L0: Awaited<ReturnType<typeof loadLedgerLines>>, P: { id: string; name: string; data: unknown }[], names: Record<string, string>, today: string) {
  const st = await loanStateOf(tx, firm, L0, names, today);
  if (!st.rows.length) return [];
  const pp = new Map(P.map((p) => [p.id, p]));
  return st.rows.map((r) => {
    const p = r.l.partnerId ? pp.get(r.l.partnerId) : undefined;
    return { dir: r.l.dir as 'given' | 'received', rate: Number(r.l.rate) || 0, bal: r.bal, legal: lrPartnerLegal(p?.name ?? '', (p?.data ?? {}) as Record<string, unknown>) };
  });
}

/** Run the review for one firm (legacy `lrCheck(f, S.year)`). */
export async function lawReview(tx: Tx, firm: Firm, year: number, today: string): Promise<LrResult> {
  return lrCheck(lrCtx(await loadLawReviewInput(tx, firm, year, today)));
}

/** Firms for the all-firms review (legacy `lrAllRun`: allowed, not the office's own firm). */
export async function lawReviewFirms(tx: Tx, ids: readonly string[]): Promise<Firm[]> {
  if (!ids.length) return [];
  return (await tx.select().from(firms).where(and(inArray(firms.id, [...ids]), eq(firms.active, true), ne(firms.name, ''))))
    .filter((f) => !(f.settings as { officeFirm?: boolean }).officeFirm);
}
