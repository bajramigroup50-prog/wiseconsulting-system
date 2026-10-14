/**
 * ПП30 autofill: recipient from a partner / employee, amount + purpose + reference from the open purchase invoices
 * picked, accounts as IBAN when the IBAN box is ticked, and one order per supplier for a batch of unpaid invoices.
 * Money is summed in whole cents (exact).
 */
import { ppNew, type PaymentOrder, type PpFirm } from './pp';
import { fromIban, mkBankName, parseAccount, toIban } from './mk-banks';
import { fixYuscii } from '../text/yuscii';

export interface PpOpenInvoice { refId: string; number: string; date: string; due?: string | null; /** open amount, denars */ open: number }
export interface PpRecipientParty { name: string; address?: string | null; city?: string | null; acc?: string | null; bank?: string | null }

const cents = (v: number) => Math.round(Number(v) * 100);

/** „Назив\nАдреса, Град“ as on the order, YUSCII leftovers repaired. */
export const ppPartyText = (p: { name?: string | null; address?: string | null; city?: string | null }): string =>
  fixYuscii([p.name, [p.address, p.city].filter(Boolean).join(', ')].filter(Boolean).join('\n'));

/** Recipient fields from a party (name + seat, account, bank derived from the account when not given). */
export function ppRecipientFields(p: PpRecipientParty): Pick<PaymentOrder, 'recip' | 'recipAcc' | 'recipBank'> {
  const acc = String(p.acc ?? '').trim();
  return { recip: ppPartyText(p), recipAcc: acc, recipBank: String(p.bank ?? '').trim() || mkBankName(acc) };
}

/** Amount, purpose and reference for the picked invoices (amount = Σ open, exact to the cent). */
export function ppInvoicesFill(L: readonly PpOpenInvoice[]): Pick<PaymentOrder, 'amount' | 'purpose' | 'refCredit'> {
  if (!L.length) return { amount: null, purpose: '', refCredit: '' };
  const total = L.reduce((s, x) => s + cents(x.open), 0) / 100;
  const nums = L.map((x) => String(x.number || '').trim()).filter(Boolean);
  let purpose = nums.length <= 1 ? 'Плаќање по фактура бр. ' + (nums[0] ?? '') : 'Плаќање по фактури бр. ' + nums.join(', ');
  if (purpose.length > 105) purpose = purpose.slice(0, 102).replace(/,\s*[^,]*$/, '') + ' …';
  let ref = nums.join(', ');
  if (ref.length > 30) ref = nums[0] ?? '';
  return { amount: total, purpose: purpose.trim(), refCredit: ref };
}

/** Payment method: 3 = the same bank (both accounts with one bank code), else 2 (clearing). */
export function ppNacin(payerAcc: unknown, recipAcc: unknown): string {
  const a = parseAccount(payerAcc), b = parseAccount(recipAcc);
  return a && b && a.acc && b.acc && a.acc.slice(0, 3) === b.acc.slice(0, 3) ? '3' : '2';
}

/** Both accounts as IBAN (`on`) or as plain 15 digits (`off`); invalid / empty values stay as typed. */
export function ppApplyIban(n: PaymentOrder, on: boolean): PaymentOrder {
  const f = on ? toIban : fromIban;
  const o: PaymentOrder = { ...n, iban: on };
  if (n.kind !== 'pp10' && n.payerAcc) o.payerAcc = f(n.payerAcc);
  if (n.recipAcc) o.recipAcc = f(n.recipAcc);
  return o;
}

/** One unpaid invoice of a supplier, as offered for the batch. */
export interface PpBatchItem extends PpOpenInvoice { partnerId: string; party: PpRecipientParty }

/**
 * „Подготви ПП30 за избраните“: one ПП30 per supplier with all its picked invoices (oldest first), the payer = the firm.
 * Suppliers without a valid account still get an order (flagged in `missing`) so the user can type the account.
 */
export function ppBatchOrders(items: readonly PpBatchItem[], payer: PpFirm, date: string, o: { iban?: boolean } = {}): { partnerId: string; refIds: string[]; order: PaymentOrder; missing: boolean }[] {
  const by = new Map<string, PpBatchItem[]>();
  for (const x of items) by.set(x.partnerId, [...(by.get(x.partnerId) ?? []), x]);
  return [...by].map(([partnerId, L]) => {
    const S = [...L].sort((a, b) => ((a.due || a.date) < (b.due || b.date) ? -1 : (a.due || a.date) > (b.due || b.date) ? 1 : 0));
    const r = ppRecipientFields(S[0]!.party);
    let order = ppNew('pp30', date, payer, { ...r, ...ppInvoicesFill(S), code: '930', nacin: ppNacin(payer.account, r.recipAcc) });
    if (o.iban) order = ppApplyIban(order, true);
    return { partnerId, refIds: S.map((x) => x.refId), order, missing: !parseAccount(r.recipAcc) };
  });
}
