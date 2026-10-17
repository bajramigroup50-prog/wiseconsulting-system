import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { opLetterHtml, opText, type OpGroup } from '@wise/core/firms/dunning';
import { dunningGroups, invoices, type Firm, type PartnerInfo, type Tx } from '@wise/db';
import { db } from '@/lib/db';
import { opCostOf, opFirmOf, opRateOf } from '@/lib/firms-office';
import { today } from '@/lib/office';

export type { PartnerInfo };

/**
 * Everything `opomeni` shows: groups by customer (legacy `opData`), the letters sent, partner data. `only` = legacy
 * `opOnly` (v406): just the invoices ticked in Излезни фактури.
 */
export async function loadDunning(firm: Firm, tx: Tx = db(), only: readonly string[] | null = null) {
  const td = today();
  // the grouping is shared with the weekly prepared list (`@wise/db` automation/dunning.ts)
  const { G, pOf } = await dunningGroups(tx, firm, td, only);
  return { td, G, pOf, rate: opRateOf(firm), cost: Math.round(opCostOf(firm) * 100), f: opFirmOf(firm) };
}

/** Text + letter for one group and level (legacy `opText` + `opPdfHTML`). */
export function letterFor(D: Awaited<ReturnType<typeof loadDunning>>, g: OpGroup, lvl: number) {
  const X = opText(g, lvl, D.f, D.rate, D.cost, D.td);
  return { X, html: opLetterHtml(X, lvl, D.f, D.pOf(g.pid), D.rate, D.td) };
}

/** Numbers of the ticked invoices (legacy `opSel` callout lists every selected one, paid ones included). */
export async function invoiceNumbers(firmId: string, ids: readonly string[]): Promise<string[]> {
  const R = await db().select({ n: invoices.number }).from(invoices).where(and(eq(invoices.firmId, firmId), inArray(invoices.id, [...ids])));
  return R.map((r) => r.n ?? '');
}

export const lvlOk = (v: unknown): number => { const n = Number(v); return n === 1 || n === 2 ? n : 0; };
