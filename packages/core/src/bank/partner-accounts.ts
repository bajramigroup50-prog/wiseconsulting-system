/**
 * Bank accounts of a partner (комитент): one or more, one of them the default used on payment orders. Stored on
 * the partner as `data.accounts` (jsonb) with the default mirrored in the `bank_account` / `bank_name` columns that
 * the rest of the program (UBL, dunning, payroll…) already reads — no migration.
 *
 * Accounts are learned automatically: from a read purchase invoice (the seller's „жиро сметка“), from bank statements
 * (the counterparty account of a payment / receipt booked to the partner) and typed on the partner card.
 */
import { mkBankName, parseAccount } from './mk-banks';

export type PartnerAccountSource = 'manual' | 'invoice' | 'statement' | 'import';
export interface PartnerAccount {
  /** 15 digits (MK) or the IBAN (foreign). */
  acc: string;
  iban: string;
  bank: string;
  def?: boolean;
  src?: PartnerAccountSource;
  /** ISO date when learned / last seen. */
  at?: string;
}

export interface PartnerAccountHolder { bankAccount?: string | null; bankName?: string | null; data?: Record<string, unknown> | null }

/** Accounts of a partner: `data.accounts`, plus the legacy `bank_account` column when it is not among them. */
export function partnerAccounts(p: PartnerAccountHolder): PartnerAccount[] {
  const raw = Array.isArray(p.data?.accounts) ? (p.data!.accounts as PartnerAccount[]) : [];
  const out: PartnerAccount[] = [];
  for (const a of raw) {
    const x = parseAccount(a?.acc || a?.iban);
    if (!x || out.some((o) => o.acc === (x.acc || x.iban))) continue;
    out.push({ acc: x.acc || x.iban, iban: x.iban, bank: String(a.bank || '').trim() || x.bank, ...(a.def ? { def: true } : {}), ...(a.src ? { src: a.src } : {}), ...(a.at ? { at: a.at } : {}) });
  }
  const col = parseAccount(p.bankAccount);
  if (col && !out.some((o) => o.acc === (col.acc || col.iban))) {
    out.unshift({ acc: col.acc || col.iban, iban: col.iban, bank: String(p.bankName || '').trim() || col.bank, def: !out.some((o) => o.def), src: 'manual' });
  }
  if (out.length && !out.some((o) => o.def)) out[0] = { ...out[0]!, def: true };
  let seenDef = false;
  return out.map((o) => { if (o.def && !seenDef) { seenDef = true; return o; } const { def: _d, ...r } = o; return r; });
}

/** The default account ('' when the partner has none). */
export const defaultAccount = (p: PartnerAccountHolder): PartnerAccount | undefined => partnerAccounts(p).find((a) => a.def);

export interface AddAccountResult { accounts: PartnerAccount[]; added: boolean; error?: string }

/**
 * Add an account (validated); an existing one is only refreshed (`at`, a missing bank name). The first account
 * becomes the default; `makeDefault` moves the default. Invalid accounts are refused with the reason.
 */
export function addPartnerAccount(list: readonly PartnerAccount[], account: unknown, o: { bank?: string | null; src?: PartnerAccountSource; at?: string; makeDefault?: boolean } = {}): AddAccountResult {
  const p = parseAccount(account);
  if (!p) {
    const d = String(account ?? '').replace(/\D/g, '');
    return { accounts: [...list], added: false, error: /^[A-Z]{2}/i.test(String(account ?? '').trim()) ? 'IBAN-от не е валиден (контролни цифри).' : d.length !== 15 ? 'Сметката мора да има 15 цифри.' : 'Сметката има погрешни контролни цифри.' };
  }
  const key = p.acc || p.iban;
  const bank = String(o.bank ?? '').trim() || p.bank || mkBankName(key);
  const ex = list.find((a) => a.acc === key);
  let L: PartnerAccount[];
  if (ex) L = list.map((a) => (a.acc === key ? { ...a, bank: a.bank || bank, ...(o.at ? { at: o.at } : {}) } : a));
  else L = [...list, { acc: key, iban: p.iban, bank, src: o.src ?? 'manual', ...(o.at ? { at: o.at } : {}), ...(list.length ? {} : { def: true }) }];
  if (o.makeDefault) L = L.map((a) => (a.acc === key ? { ...a, def: true } : (({ def: _d, ...r }) => r)(a)));
  return { accounts: L, added: !ex };
}

/** Columns + data patch for a partner after its accounts changed (default mirrored into the columns). */
export function partnerAccountPatch(data: Record<string, unknown> | null | undefined, accounts: readonly PartnerAccount[]) {
  const d = accounts.find((a) => a.def) ?? accounts[0];
  return { bankAccount: d?.acc ?? null, bankName: d?.bank || null, data: { ...(data ?? {}), accounts: [...accounts] } };
}

/** A statement line that can teach a partner account: booked to a partner, with a counterparty account. */
export interface LearnLine { partnerId: string | null; counterAccount: string | null; date: string }

/**
 * Accounts to learn from statement lines: per partner, each valid counterparty account (MK or IBAN) once, latest
 * date. Own-account transfers and the treasury (100…) are skipped.
 */
export function accountsFromStatementLines(L: readonly LearnLine[], own: readonly string[] = []): Map<string, { acc: string; at: string }[]> {
  const ownK = new Set(own.map((a) => { const p = parseAccount(a); return p ? p.acc || p.iban : ''; }).filter(Boolean));
  const out = new Map<string, { acc: string; at: string }[]>();
  for (const l of L) {
    if (!l.partnerId || !l.counterAccount) continue;
    const p = parseAccount(l.counterAccount);
    if (!p) continue;
    const k = p.acc || p.iban;
    if (ownK.has(k) || k.startsWith('100')) continue;
    const arr = out.get(l.partnerId) ?? [];
    const ex = arr.find((x) => x.acc === k);
    if (ex) { if (l.date > ex.at) ex.at = l.date; } else arr.push({ acc: k, at: l.date });
    out.set(l.partnerId, arr);
  }
  return out;
}
