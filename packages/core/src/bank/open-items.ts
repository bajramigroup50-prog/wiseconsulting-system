/**
 * Open items (неплатени фактури) computed from the persisted ledger — Phase 4 stopgap while the
 * invoice / purchase tables are built in Phase 3.
 *
 * Receivables are partner balances on 120–128, payables on 220–228 (the same `PARTNER_ACCOUNT_RE` the
 * posting service uses), grouped per partner × konto × document reference (`journal_lines.doc`, else a
 * single invoice number found in the note). The side that opens the item is the "total" (debit for
 * receivables, credit for payables); the other side on the same reference is paid. Lines without a
 * reference (opening balances, payments booked without an invoice number) are applied FIFO to the
 * partner's oldest open items, like legacy `bkVirt` did for unlinked bank payments.
 *
 * Bank-statement journals must be excluded by the caller (`exclude`): bank payments are counted from
 * the bank lines themselves (`bankPaid` in bank-match.ts), otherwise they would be subtracted twice.
 *
 * All amounts in cents.
 */
import { toCents } from './cents';
import { bmNums, type OpenDoc } from '../bank-match';

export interface OpenItemLedgerLine {
  account: string;
  debit: number;
  credit: number;
  date: string;
  partnerId?: string | null;
  doc?: string | null;
  note?: string | null;
  sourceType?: string | null;
}

export interface LedgerOpenItems {
  /** Receivables (customer invoices), for payments in. */
  invoices: OpenDoc[];
  /** Payables (supplier invoices), for payments out. */
  purchases: OpenDoc[];
}

const RECV = /^12[0-8]/;
const PAY = /^22[0-8]/;

/** Document reference of a ledger line: `doc`, else the one invoice number mentioned in the note. */
export function ledgerDocRef(l: Pick<OpenItemLedgerLine, 'doc' | 'note'>): string {
  const d = String(l.doc ?? '').trim();
  if (d) return d;
  const n = bmNums(l.note);
  return n.length === 1 ? n[0]! : '';
}

/** Stable id of a ledger open item (stored in bank-line refs). */
export const ledgerItemId = (konto: string, partnerId: string, ref: string): string => `L|${konto}|${partnerId}|${ref}`;

/** Parse an id from {@link ledgerItemId}. */
export function parseLedgerItemId(id: string): { konto: string; partnerId: string; ref: string } | null {
  const m = /^L\|(\d+)\|([^|]+)\|(.*)$/.exec(id);
  return m ? { konto: m[1]!, partnerId: m[2]!, ref: m[3]! } : null;
}

/**
 * Open items from ledger lines (any period the caller loads — normally the working year incl. its
 * opening journal). Items whose open amount is ≤ 0 are still returned when they have a positive total
 * (fully paid), so matching sees the document; callers filter by open amount.
 */
export function ledgerOpenItems(lines: readonly OpenItemLedgerLine[], opts: { exclude?: (l: OpenItemLedgerLine) => boolean } = {}): LedgerOpenItems {
  interface G { konto: string; partner: string; ref: string; total: number; paid: number; date: string }
  const groups = new Map<string, G>();
  /** Unreferenced opposite-side amounts per partner × konto (applied FIFO). */
  const loose = new Map<string, number>();
  for (const l of lines) {
    if (opts.exclude?.(l)) continue;
    const k = String(l.account);
    const recv = RECV.test(k);
    if (!recv && !PAY.test(k)) continue;
    if (!l.partnerId) continue;
    const d = toCents(+l.debit || 0);
    const c = toCents(+l.credit || 0);
    const open = recv ? d - c : c - d; // + opens / increases the item
    if (!open) continue;
    const ref = ledgerDocRef(l);
    if (!ref) {
      const lk = k + '|' + l.partnerId;
      loose.set(lk, (loose.get(lk) || 0) + open);
      continue;
    }
    const key = k + '|' + l.partnerId + '|' + ref;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { konto: k, partner: l.partnerId, ref, total: 0, paid: 0, date: l.date }));
    if (open > 0) { g.total += open; if (l.date < g.date) g.date = l.date; }
    else g.paid += -open;
  }
  const all = [...groups.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  // Unreferenced balances: a positive one is an item of its own ("без број"), a negative one pays FIFO.
  for (const [lk, amt] of loose) {
    const [konto, partner] = lk.split('|') as [string, string];
    if (amt > 0) { all.push({ konto, partner, ref: '', total: amt, paid: 0, date: '' }); continue; }
    let rem = -amt;
    for (const g of all) {
      if (rem <= 0) break;
      if (g.konto !== konto || g.partner !== partner) continue;
      const o = g.total - g.paid;
      if (o <= 0) continue;
      const a = Math.min(o, rem);
      g.paid += a;
      rem -= a;
    }
  }
  const out: LedgerOpenItems = { invoices: [], purchases: [] };
  for (const g of all) {
    if (g.total <= 0) continue;
    const doc: OpenDoc = {
      id: ledgerItemId(g.konto, g.partner, g.ref),
      number: g.ref,
      date: g.date,
      partner: g.partner,
      total: g.total,
      paidOther: g.paid,
      konto: g.konto,
    };
    (RECV.test(g.konto) ? out.invoices : out.purchases).push(doc);
  }
  return out;
}
