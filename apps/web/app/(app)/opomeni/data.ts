import 'server-only';
import { desc, eq } from 'drizzle-orm';
import { opGroups, opLetterHtml, opText, type OpGroup, type OpLetter } from '@wise/core/firms/dunning';
import { dunningLetters, type Firm, type Tx } from '@wise/db';
import { db } from '@/lib/db';
import { invoicesWithPayments, opCostOf, opFirmOf, opRateOf, partnerNames, payDaysOf } from '@/lib/firms-office';
import { today } from '@/lib/office';

export type PartnerInfo = { name: string; email: string | null; phone: string | null; address: string | null; city: string | null; edb: string | null };

/** Everything `opomeni` shows: groups by customer (legacy `opData`), the letters sent, partner data. */
export async function loadDunning(firm: Firm, tx: Tx = db()) {
  const td = today();
  const [inv, letters] = await Promise.all([
    invoicesWithPayments(firm.id, {}, tx),
    tx.select().from(dunningLetters).where(eq(dunningLetters.firmId, firm.id)).orderBy(desc(dunningLetters.createdAt)),
  ]);
  const L: OpLetter[] = letters.map((d) => ({ partnerId: d.partnerId, invoiceIds: d.invoiceIds, level: d.level, channel: d.channel, date: d.date, total: Math.round(Number(d.total) * 100) }));
  const G = opGroups(inv, L, payDaysOf(firm), td);
  const P = await partnerNames(firm.id, G.map((g) => (g.pid === '—' ? null : g.pid)), tx);
  const pOf = (pid: string): PartnerInfo => P.get(pid) ?? { name: '(без купувач)', email: null, phone: null, address: null, city: null, edb: null };
  return { td, G, pOf, rate: opRateOf(firm), cost: Math.round(opCostOf(firm) * 100), f: opFirmOf(firm) };
}

/** Text + letter for one group and level (legacy `opText` + `opPdfHTML`). */
export function letterFor(D: Awaited<ReturnType<typeof loadDunning>>, g: OpGroup, lvl: number) {
  const X = opText(g, lvl, D.f, D.rate, D.cost, D.td);
  return { X, html: opLetterHtml(X, lvl, D.f, D.pOf(g.pid), D.rate, D.td) };
}

export const lvlOk = (v: unknown): number => { const n = Number(v); return n === 1 || n === 2 ? n : 0; };
