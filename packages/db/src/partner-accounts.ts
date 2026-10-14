/**
 * Partner bank accounts (`partners.data.accounts`, default mirrored into `bank_account` / `bank_name`): learning from
 * read purchase invoices and bank statements, and editing on the partner card. Every change is audited.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  accountsFromStatementLines, addPartnerAccount, parseAccount, partnerAccountPatch, partnerAccounts,
  type PartnerAccount, type PartnerAccountSource,
} from '@wise/core';
import { audit, type Tx } from './audit';
import { bankAccounts, bankLines, partners } from './schema/index';

/**
 * Remember one account of a partner. Returns true when it was new. Invalid accounts are ignored (a read can
 * misread a digit — the control digits catch it), so learning never blocks the save of the document.
 */
export async function learnPartnerAccount(tx: Tx, a: { firmId: string; userId: string | null; partnerId: string; account: string | null | undefined; bank?: string | null; src: PartnerAccountSource; at?: string }): Promise<boolean> {
  if (!a.account || !parseAccount(a.account)) return false;
  const [p] = await tx.select().from(partners).where(and(eq(partners.id, a.partnerId), eq(partners.firmId, a.firmId))).limit(1);
  if (!p) return false;
  const before = partnerAccounts(p);
  const r = addPartnerAccount(before, a.account, { bank: a.bank, src: a.src, ...(a.at ? { at: a.at } : {}) });
  if (r.error) return false;
  const stored = Array.isArray((p.data as Record<string, unknown>)?.accounts);
  if (!r.added && stored && JSON.stringify(r.accounts) === JSON.stringify(before)) return false;
  await tx.update(partners).set(partnerAccountPatch(p.data, r.accounts)).where(eq(partners.id, p.id));
  if (r.added) {
    const acc = r.accounts.find((x) => x.acc === (parseAccount(a.account)!.acc || parseAccount(a.account)!.iban));
    await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'partnerAccLearn', entityType: 'partner', entityId: p.id, data: { account: acc?.acc, bank: acc?.bank, src: a.src } });
  }
  return r.added;
}

/**
 * Learn the counterparty accounts of statement lines booked to a partner (all lines of the firm, or only `lineIds`).
 * Own accounts and the treasury are skipped. Returns the number of accounts added.
 */
export async function learnAccountsFromStatements(tx: Tx, a: { firmId: string; userId: string | null; lineIds?: string[] }): Promise<number> {
  if (a.lineIds && !a.lineIds.length) return 0;
  const L = await tx.select({ partnerId: bankLines.partnerId, counterAccount: bankLines.counterAccount, date: bankLines.date }).from(bankLines)
    .where(and(eq(bankLines.firmId, a.firmId), isNotNull(bankLines.partnerId), isNotNull(bankLines.counterAccount), a.lineIds ? inArray(bankLines.id, a.lineIds) : undefined));
  if (!L.length) return 0;
  const own = (await tx.select({ a: bankAccounts.account, i: bankAccounts.iban }).from(bankAccounts).where(eq(bankAccounts.firmId, a.firmId)))
    .flatMap((b) => [b.a, b.i]).filter((x): x is string => !!x);
  const M = accountsFromStatementLines(L.map((l) => ({ partnerId: l.partnerId, counterAccount: l.counterAccount, date: String(l.date) })), own);
  let n = 0;
  for (const [partnerId, accs] of M) {
    for (const x of accs) if (await learnPartnerAccount(tx, { firmId: a.firmId, userId: a.userId, partnerId, account: x.acc, src: 'statement', at: x.at })) n++;
  }
  return n;
}

export class PartnerAccountError extends Error {
  constructor(m: string) { super(m); this.name = 'PartnerAccountError'; }
}

/**
 * Replace a partner's accounts with the list typed on the partner card (validated; the first ticked default wins, else
 * the first). Throws `PartnerAccountError` naming the wrong account.
 */
export async function savePartnerAccounts(tx: Tx, a: { firmId: string; userId: string | null; partnerId: string; accounts: { acc: string; bank?: string | null; def?: boolean }[] }): Promise<PartnerAccount[]> {
  const [p] = await tx.select().from(partners).where(and(eq(partners.id, a.partnerId), eq(partners.firmId, a.firmId))).limit(1);
  if (!p) throw new PartnerAccountError('Комитентот не постои.');
  const prev = new Map(partnerAccounts(p).map((x) => [x.acc, x]));
  let L: PartnerAccount[] = [];
  let ticked = false;
  for (const x of a.accounts) {
    if (!String(x.acc ?? '').trim()) continue;
    const r = addPartnerAccount(L, x.acc, { bank: x.bank, src: 'manual', makeDefault: !!x.def && !ticked });
    if (x.def) ticked = true;
    if (r.error) throw new PartnerAccountError(`Сметка „${x.acc}“: ${r.error}`);
    L = r.accounts;
  }
  // keep where an account came from (invoice / statement) and when it was seen
  L = L.map((x) => { const o = prev.get(x.acc); return o ? { ...x, ...(o.src ? { src: o.src } : {}), ...(o.at ? { at: o.at } : {}) } : x; });
  if (L.length && !L.some((x) => x.def)) L[0] = { ...L[0]!, def: true };
  await tx.update(partners).set(partnerAccountPatch(p.data, L)).where(eq(partners.id, p.id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'partnerAccSave', entityType: 'partner', entityId: p.id, data: { before: [...prev.keys()], after: L.map((x) => x.acc), def: L.find((x) => x.def)?.acc ?? null } });
  return L;
}
