import 'server-only';
/** Loans screen data (legacy `lnLedRows` / `lnBankRows` / `lnState` 16686–16704). */
import { and, asc, eq } from 'drizzle-orm';
import { loanFlows, loanKontoDir, loanMovesFromLedger, loanState } from '@wise/core/finance';
import { effectiveChart, loans, type Firm } from '@wise/db';
import { db } from '@/lib/db';
import { finLines, today } from '@/lib/finance';

export const lnIgnored = (firm: Pick<Firm, 'settings'>) => new Set(((firm.settings ?? {}) as { lnIgnore?: string[] }).lnIgnore ?? []);

export async function loanData(firm: Firm, year: number) {
  const [L, chart, lines] = await Promise.all([
    db().select().from(loans).where(eq(loans.firmId, firm.id)).orderBy(asc(loans.date)),
    effectiveChart(db(), firm.id),
    finLines(firm.id, `${year}-01-01`, `${year}-12-31`, { accountRe: '^[012]', excludeClose: true }),
  ]);
  const name = new Map(chart.map((a) => [a.code, a.name]));
  const kName = (k: string) => name.get(k) ?? '';
  const loanLines = lines.filter((l) => loanKontoDir(l.account, kName(l.account)));
  const src = (t: string | null | undefined) => (t === 'bank_statement' ? 'Извод' : t === 'cash_voucher' ? 'Благајна' : 'Налог');
  const flows = loanFlows(loanMovesFromLedger(loanLines.map((l) => ({ ...l, src: src(l.sourceType) })), kName));
  const contracts = L.map((l) => ({ ...l, partnerId: l.partnerId, amount: Number(l.amount), rate: Number(l.rate), moveIds: l.moveIds, hasFile: false }));
  const st = loanState(contracts, flows, today(), lnIgnored(firm));
  return { loans: L, flows, ...st, kName };
}
