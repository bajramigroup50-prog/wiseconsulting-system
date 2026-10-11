import 'server-only';
/** Loans screen data (legacy `lnLedRows` / `lnBankRows` / `lnState` 16686–16704). */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { loanFlows, loanKontoDir, loanMovesFromLedger, loanState } from '@wise/core/finance';
import { loanMovesFromBank } from '@wise/core/finpar-loans';
import { bankLines, effectiveChart, fileLinks, loans, type Firm } from '@wise/db';
import { db } from '@/lib/db';
import { finLines, today } from '@/lib/finance';

export const lnIgnored = (firm: Pick<Firm, 'settings'>) => new Set(((firm.settings ?? {}) as { lnIgnore?: string[] }).lnIgnore ?? []);

export async function loanData(firm: Firm, year: number) {
  const [L, chart, lines, B] = await Promise.all([
    db().select().from(loans).where(eq(loans.firmId, firm.id)).orderBy(asc(loans.date)),
    effectiveChart(db(), firm.id),
    finLines(firm.id, `${year}-01-01`, `${year}-12-31`, { accountRe: '^[012]', excludeClose: true }),
    // legacy `lnBankRows` 16690 + `lnBankKind`: statement lines that are loans (code 468/469/568 or „заем/позајм“) on other kontos
    db().select({ id: bankLines.id, date: bankLines.date, amount: bankLines.amount, osnov: bankLines.osnov, desc: bankLines.description, name: bankLines.name, konto: bankLines.konto, partnerId: bankLines.partnerId })
      .from(bankLines).where(and(eq(bankLines.firmId, firm.id), sql`${bankLines.date} between ${year + '-01-01'} and ${year + '-12-31'}`)),
  ]);
  const name = new Map(chart.map((a) => [a.code, a.name]));
  const kName = (k: string) => name.get(k) ?? '';
  const loanLines = lines.filter((l) => loanKontoDir(l.account, kName(l.account)));
  const src = (t: string | null | undefined) => (t === 'bank_statement' ? 'Извод' : t === 'cash_voucher' ? 'Благајна' : 'Налог');
  const bankMoves = loanMovesFromBank(B.map((b) => ({ ...b, amount: Number(b.amount) })), kName);
  const flows = loanFlows([...loanMovesFromLedger(loanLines.map((l) => ({ ...l, src: src(l.sourceType) })), kName), ...bankMoves]);
  const files = L.length ? await db().select({ id: fileLinks.entityId, fileId: fileLinks.fileId }).from(fileLinks).where(and(eq(fileLinks.entityType, 'loan'), inArray(fileLinks.entityId, L.map((l) => l.id)))) : [];
  const fileOf = new Map<string, string[]>();
  for (const f of files) fileOf.set(f.id, [...(fileOf.get(f.id) ?? []), f.fileId]);
  const contracts = L.map((l) => ({ ...l, partnerId: l.partnerId, amount: Number(l.amount), rate: Number(l.rate), moveIds: l.moveIds, hasFile: fileOf.has(l.id) }));
  const st = loanState(contracts, flows, today(), lnIgnored(firm));
  // legacy `lnMisK` 16843: loans found on the statement but booked on other kontos (to rebook on 1620 / 2620)
  const linked = new Set(L.flatMap((l) => l.moveIds));
  const misK = bankMoves.filter((m) => !linked.has(m.id) && !lnIgnored(firm).has(m.id));
  return { loans: L, flows, ...st, kName, misK, fileOf };
}
