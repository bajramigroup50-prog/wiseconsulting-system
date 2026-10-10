import 'server-only';
/** Data loader for „Анализи и извештаи“ (legacy `VIEWS.analizi` 5297): documents, stock and ledger of one firm. */
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { AnDoc, AnInvoice, AnPosMove } from '@wise/core/analysis';
import { priceAt, trackedItems } from '@wise/core/stock';
import {
  bankAccounts, documentPayments, invoiceLines, invoices, loadLedgerLines, loadStockContext, partners, payrollRuns, purchases,
  stockMoves, vatDueEstimate, type Firm, type LoadedStock,
} from '@wise/db';
import { db } from './db';

export interface AnalysisData {
  invoices: AnInvoice[];
  pos: AnPosMove[];
  costOf: (invoiceId: string, itemId: string) => number;
  invDocs: AnDoc[];
  purDocs: AnDoc[];
  partnerName: (id: string) => string;
  stock: LoadedStock;
  tracked: ReturnType<typeof trackedItems>;
  lastSale: Map<string, string>;
}

/** Documents and stock (tabs sales / prod / part / time). */
export async function loadAnalysis(firm: Firm): Promise<AnalysisData> {
  const [IV, PU, PA, L] = await Promise.all([
    db().select().from(invoices).where(and(eq(invoices.firmId, firm.id), eq(invoices.status, 'posted'), inArray(invoices.kind, ['invoice', 'credit']))),
    db().select().from(purchases).where(and(eq(purchases.firmId, firm.id), eq(purchases.status, 'posted'))),
    db().select({ id: partners.id, name: partners.name }).from(partners).where(eq(partners.firmId, firm.id)),
    loadStockContext(db(), firm.id),
  ]);
  const ids = IV.map((i) => i.id);
  const [LN, MV, pay] = await Promise.all([
    ids.length ? db().select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, ids)) : Promise.resolve([]),
    db().select({ sourceType: stockMoves.sourceType, sourceId: stockMoves.sourceId, itemId: stockMoves.itemId, value: stockMoves.value })
      .from(stockMoves).where(and(eq(stockMoves.firmId, firm.id), inArray(stockMoves.sourceType, ['invoice', 'credit']), eq(stockMoves.pending, false))),
    documentPayments(db(), firm.id, { invoiceIds: ids, purchaseIds: PU.map((p) => p.id) }),
  ]);
  const byInv = new Map<string, typeof LN>();
  for (const l of LN) byInv.set(l.invoiceId, [...(byInv.get(l.invoiceId) ?? []), l]);
  const cost = new Map<string, number>();
  for (const m of MV) { const k = `${m.sourceId}|${m.itemId}`; cost.set(k, (cost.get(k) ?? 0) - Number(m.value)); }
  const names = new Map(PA.map((p) => [p.id, p.name]));

  const ctx = L.ctx;
  const items = new Map((ctx.items ?? []).map((i) => [i.id, i]));
  const pos: AnPosMove[] = [];
  const lastSale = new Map<string, string>();
  for (const m of ctx.moves ?? []) {
    if (m.pend) continue;
    if (m.qty < 0 && (m.type === 'sale' || String(m.src ?? '').startsWith('pos-'))) {
      if (m.date > (lastSale.get(m.item) ?? '')) lastSale.set(m.item, m.date);
    }
    if (!String(m.src ?? '').startsWith('pos-') || m.qty >= 0) continue;
    const it = items.get(m.item);
    if (!it) continue;
    pos.push({ date: m.date, item: m.item, name: it.name ?? '', qty: m.qty, value: m.value, wh: m.wh || 'main', rate: Number(it.rate ?? 18), retail: priceAt(ctx, it, m.wh || 'main', m.date) });
  }
  const doc = (p: { id: string; partnerId: string | null; date: string; due: string | null; total: string }): AnDoc => {
    const P = pay.get(p.id);
    return { id: p.id, partner: p.partnerId ?? '', date: p.date, due: p.due, total: P?.total ?? Number(p.total), paid: P?.paid ?? 0 };
  };
  return {
    invoices: IV.map((i) => ({
      id: i.id, date: i.date, credit: i.kind === 'credit', partner: i.partnerId ?? '', wh: i.warehouseId ?? 'main', fx: Number(i.fx) || 1,
      lines: (byInv.get(i.id) ?? []).sort((a, b) => a.lineNo - b.lineNo).map((l) => ({ item: l.itemId, name: l.name, qty: Math.abs(Number(l.qty)), price: Number(l.price), disc: Number(l.disc) })),
    })),
    pos,
    costOf: (inv, item) => cost.get(`${inv}|${item}`) ?? 0,
    invDocs: IV.filter((i) => i.kind === 'invoice').map(doc),
    purDocs: PU.map(doc),
    partnerName: (id) => (id === '__kasa' ? 'Каса (малопродажба)' : names.get(id) ?? (id || '—')),
    stock: L,
    tracked: trackedItems(ctx),
    lastSale,
  };
}

/** Ledger, bank accounts, VAT and payroll (tabs cash / kpi). */
export async function loadFinance(firm: Firm, year: number, today: string) {
  const [lines, banks, vat, [run]] = await Promise.all([
    loadLedgerLines(db(), firm.id, `${year}-01-01`, `${year}-12-31`),
    db().select({ konto: bankAccounts.konto }).from(bankAccounts).where(eq(bankAccounts.firmId, firm.id)),
    vatDueEstimate(db(), firm.id, today).catch(() => null),
    db().select({ totals: payrollRuns.totals }).from(payrollRuns).where(and(eq(payrollRuns.firmId, firm.id), eq(payrollRuns.status, 'posted'))).orderBy(desc(payrollRuns.month)).limit(1),
  ]);
  const L = lines.filter((l) => l.kind !== 'close');
  const balance: Record<string, number> = {};
  for (const l of L) balance[l.account] = (balance[l.account] ?? 0) + l.debit - l.credit;
  const ck = new Set([...banks.map((b) => b.konto), '1020']);
  const start = Math.round(Object.entries(balance).filter(([k]) => ck.has(k)).reduce((a, [, v]) => a + v, 0) * 100) / 100;
  const T = (run?.totals ?? {}) as Record<string, number>;
  return { lines: L, balance, start, vat, payroll: run ? (Number(T.gross) || 0) + (Number(T.dopl) || 0) : null };
}
