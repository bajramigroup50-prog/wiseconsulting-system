/**
 * Legacy-parity helpers of the statement screens (Изводи / Девизни изводи), pure and amounts in integer cents:
 *
 * - bank account konto name (`addBankAcct` 4846 / 7203) and the КБ special-account konto 108x (12677)
 * - statement-number suggestions by neighbour (`izvSugg` 12392, `izvFill` 12400)
 * - FX balance by statement chain (`bookSaldoCur` 12652)
 * - POS terminal balance and the bank fee posting (`posSaldo` / `posBox` / `posFee` 13075–13082) — shared with fiskPer
 * - one-sided transit transfers (`trOpen` 12764)
 * - lines on 12x/22x without a partner (`bkpNoP` / `bkJunk` / `bkpFix` 12415–12433)
 * - same-reference search (`bkRefKey` / `bkSameRef` 12690)
 * - firm owner match across firms (`ownMatchFirm` 12877)
 * - AI classification input/output (`aiClassify` 4856) — the prompt itself is verbatim in the worker
 * - payment notifications (`pnRun` 13312)
 */
import {
  bankEffKonto, bankName, bkCore, BKPK_RE, matchPartner,
  type BankKonta, type BankRow, type DocType, type OpenDoc, type Partner, BANK_KONTA,
} from '../bank-match';

const dig = (s: unknown) => String(s ?? '').replace(/\D/g, '');
/** cents → legacy number text (`fmt`-less, like `${r2(x)}` in a template string). */
const den = (c: number) => String(Math.round(c) / 100);

/* ------------------------------------------------------------------ bank accounts */

/** Name of the chart account created for a new bank account (legacy `addBankAcct` 7203, change listener 4846). */
export function bankKontoName(name: string, cur?: string | null): string {
  const c = (cur || 'MKD').toUpperCase();
  return (c !== 'MKD' ? 'Девизна сметка ' + c : 'Трансакциска сметка') + ' – ' + String(name || '').trim();
}

/** Konto of a new КБ special account (legacy 12677): first free 1080…1089. */
export function techAccountKonto(used: readonly string[]): string {
  const U = new Set(used.map(String));
  let k = 1080;
  while (U.has(String(k)) && k < 1089) k++;
  return String(k);
}

/* ------------------------------------------------------------------ statement numbers */

export interface StatementNo { acct: string; date: string; no?: string | null }

/**
 * Legacy `izvSugg` (12392): for every statement without a number, the number by neighbour within the account and
 * year — previous known number + distance, else next known − distance, else its position (1-based). Keyed
 * `acct|date`.
 */
export function statementNumberSuggestions(list: readonly StatementNo[]): Record<string, string> {
  const out: Record<string, string> = {};
  const by = new Map<string, Map<string, string>>();
  for (const s of list) {
    const k = s.acct + '|' + String(s.date).slice(0, 4);
    const m = by.get(k) ?? by.set(k, new Map()).get(k)!;
    const cur = m.get(s.date);
    if (!cur) m.set(s.date, String(s.no ?? '').trim());
  }
  for (const [ky, M] of by) {
    const a = ky.split('|')[0]!;
    const D = [...M.keys()].sort();
    const known = D.map((d) => { const v = M.get(d)!; return /^\d+$/.test(v) ? +v : null; });
    for (let i = 0; i < D.length; i++) {
      if (M.get(D[i]!)) continue;
      let s: number | null = null;
      for (let j = i - 1; j >= 0; j--) if (known[j] != null) { s = known[j]! + (i - j); break; }
      if (s == null) for (let j = i + 1; j < D.length; j++) if (known[j] != null) { s = known[j]! - (j - i); break; }
      if (s == null) s = i + 1;
      if (s > 0) out[a + '|' + D[i]] = String(s);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ FX balance */

/**
 * Legacy `bookSaldoCur` (12652): balance of an FX account in its currency = opening balance of the first statement
 * that has balances (on or before `date`) + every line amount in currency from that date through `date`.
 * Null when no statement up to `date` has a balance.
 */
export function bookSaldoCur(balances: readonly { date: string; opening: number }[], lines: readonly { date: string; amount: number; amountCur?: number | null }[], date: string): number | null {
  const E = balances.filter((x) => x.date <= date).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!E.length) return null;
  const f0 = E[0]!;
  let s = f0.opening;
  for (const b of lines) if (b.date >= f0.date && b.date <= date) s += b.amountCur ?? b.amount ?? 0;
  return s;
}

/* ------------------------------------------------------------------ POS terminal */

export interface PosSaldo { k: string; d: number; p: number; s: number; last: string }

/** Legacy `posSaldo` (13075): turnover of the POS konto — card sales (debit) vs. money received from the bank (credit). */
export function posSaldo(lines: readonly { k: string; date: string; d: number; p: number }[], posK: string = BANK_KONTA.pos): PosSaldo {
  const L = lines.filter((l) => String(l.k) === String(posK));
  const d = L.reduce((a, l) => a + (+l.d || 0), 0);
  const p = L.reduce((a, l) => a + (+l.p || 0), 0);
  return { k: posK, d, p, s: d - p, last: L.filter((l) => +l.p).map((l) => l.date).sort().pop() || '' };
}

/** State of the POS box (legacy `posBox` 13076): which message and whether the fee button is offered. */
export function posBoxState(x: PosSaldo): 'none' | 'fee' | 'waiting' | 'over' | 'closed' {
  if (!x.d && !x.p) return 'none';
  if (x.s > 0 && x.p > 0) return 'fee';
  if (x.s > 0) return 'waiting';
  if (x.s < 0) return 'over';
  return 'closed';
}

/** Journal lines of the POS bank fee (legacy ACT `posFee` 13078): debit 4460 / credit POS konto with the POS partner. */
export function posFeeLines(amount: number, posK: string, posPartner: string | null, feeK: string = BANK_KONTA.fee): { k: string; d: number; p: number; partner?: string }[] {
  return [{ k: feeK, d: amount, p: 0 }, { k: posK, d: 0, p: amount, ...(posPartner ? { partner: posPartner } : {}) }];
}

/** Validation of the fee amount: positive and not more than the open POS balance (+1 cent). */
export const posFeeValid = (amount: number, x: PosSaldo): boolean => amount > 0 && amount <= x.s + 1;

/* ------------------------------------------------------------------ transit */

/**
 * Legacy `trOpen` (12764): per day, the transit kontos (1039 / 1009) are left with a balance that is NOT a small FX
 * residue of a two-sided transfer (those are `transitResidue`) — the other side of the transfer is missing.
 * `r > 0`: went out, not received; `r < 0`: received, not sent out.
 */
export function transitOpen(lines: readonly { k: string; date: string; d: number; p: number }[], konta?: Partial<BankKonta>): { k: string; date: string; r: number }[] {
  const K = { ...BANK_KONTA, ...(konta || {}) };
  const out: { k: string; date: string; r: number }[] = [];
  for (const k of [K.transitFx, K.transit]) {
    const by: Record<string, { d: number; p: number }> = {};
    for (const l of lines) { if (String(l.k) !== k) continue; const o = (by[l.date] ||= { d: 0, p: 0 }); o.d += +l.d || 0; o.p += +l.p || 0; }
    for (const [date, o] of Object.entries(by)) {
      const r = o.d - o.p;
      if (r && !(o.d > 0 && o.p > 0 && Math.abs(r) <= Math.max(o.d, o.p) * 0.05)) out.push({ k, date, r });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Direction label of a transit residue (legacy 12573): positive = expense 4810, negative = income 7810. */
export const transitResidueLabel = (r: number, konta?: Partial<BankKonta>): string => {
  const K = { ...BANK_KONTA, ...(konta || {}) };
  return r > 0 ? `расход (${K.fxLoss})` : `приход (${K.fxGain})`;
};

/* ------------------------------------------------------------------ partners on 12x/22x */

/** Legacy `bankCpName` (12414): the start of the description (never the whole purpose). */
export function bankCpName(desc: unknown): string {
  const t = String(desc || '').split(/ - | – |[;·]/)[0]!.trim();
  return t.length >= 3 ? t.slice(0, 80) : '';
}

/** Legacy `bkJunk` (12418): the partner was wrongly opened from the payment purpose (old logic). */
export function partnerIsJunk(b: BankRow, partners: readonly Partner[], partnerKeyFn: (s: unknown) => string): boolean {
  if (!b.partner) return false;
  const p = partners.find((x) => x.id === b.partner);
  const nm = bankName(b, partners as Partner[]);
  return !!(p && nm && partnerKeyFn(p.name) !== partnerKeyFn(nm) && partnerKeyFn(p.name) === partnerKeyFn(bankCpName(b.desc)));
}

export interface PartnerFixPlan { id: string; partner: string; name: string; junk: boolean }

/**
 * Legacy `bkpNoP` + `bkpFix` plan (12427–12432): rows of the year on 12x/22x without a partner (or with a junk one)
 * that can be linked to the partner named in the statement — the linked document's partner, an existing partner by
 * name (`partner`), or a new partner to create (`partner` = '' and `name`).
 */
export function partnerFixPlan(rows: readonly BankRow[], a: {
  year?: number | string; partners: readonly Partner[]; refPartner: (b: BankRow) => string; partnerKey: (s: unknown) => string;
}): PartnerFixPlan[] {
  const P = a.partners as Partner[];
  const out: PartnerFixPlan[] = [];
  for (const b of rows) {
    if (a.year != null && !String(b.date).startsWith(String(a.year))) continue;
    if (!BKPK_RE.test(bankEffKonto(b))) continue;
    const rp = a.refPartner(b);
    const nm = bankName(b, P);
    const junk = partnerIsJunk(b, P, a.partnerKey);
    if (!((!b.partner && (rp || nm)) || junk)) continue;
    const pid = rp || matchPartner(P, nm, '');
    const name = rp ? P.find((p) => p.id === rp)?.name || nm : nm;
    if (!pid && (!name || name.length < 3)) continue;
    out.push({ id: b.id, partner: pid, name, junk });
  }
  return out;
}

/* ------------------------------------------------------------------ same reference */

/** Legacy `bkRefKey` (12690): the first number of ≥ 6 digits in the reference / description. */
export const sameRefKey = (b: Pick<BankRow, 'bref' | 'desc'>): string => (String(b.bref || '') + ' ' + String(b.desc || '')).match(/\d{6,}/)?.[0] ?? '';

/** Legacy `bkSameRef` (12691): other rows that mention the same reference (in reference, description or account). */
export function sameRefRows<T extends Pick<BankRow, 'id' | 'bref' | 'desc'> & { counterAccount?: string | null }>(b: Pick<BankRow, 'id' | 'bref' | 'desc'>, rows: readonly T[]): T[] {
  const k = sameRefKey(b);
  if (!k) return [];
  return rows.filter((x) => x.id !== b.id && (String(x.bref || '') + ' ' + String(x.desc || '') + ' ' + String(x.counterAccount || '')).includes(k));
}

/** Legacy `bkPickSave` (12703): the note is appended to the description as ` · [note]` (replacing an earlier one). */
export const withNote = (desc: string, note: string): string => {
  const base = String(desc || '').replace(/ · \[.*\]$/, '');
  return note.trim() ? base + ' · [' + note.trim() + ']' : base;
};

/* ------------------------------------------------------------------ owner check */

export interface OwnerFirm { id: string; name: string; edb?: string | null; accounts?: readonly (string | null | undefined)[] }

/** Legacy `ownMatchFirm` (12877): does the statement identity (name / ЕДБ / account) belong to this firm? */
export function ownMatchFirm(f: OwnerFirm, id: { name?: string; edb?: string; acct?: string }): boolean {
  const e = dig(id.edb), fe = dig(f.edb);
  if (e.length >= 7 && fe.length >= 7 && (e.endsWith(fe.slice(-13)) || fe.endsWith(e.slice(-13)))) return true;
  const a = dig(id.acct);
  if (a.length >= 8) {
    const B = (f.accounts ?? []).map(dig).filter((x) => x.length >= 8);
    if (B.some((x) => x.endsWith(a.slice(-10)) || a.endsWith(x.slice(-10)))) return true;
  }
  const n = bkCore(id.name), fn0 = bkCore(f.name);
  if (n.length >= 4 && fn0.length >= 4) {
    const w = n.split(' ').slice(0, 2).join(' '), fw = fn0.split(' ').slice(0, 2).join(' ');
    if (n === fn0 || n.includes(fw) || fn0.includes(w)) return true;
  }
  return false;
}

/**
 * Legacy `ownerCheck` (12880): null = fine (matches the current firm, or too little to tell); otherwise the warning,
 * naming the other firm when one of the user's firms matches.
 */
export function ownerCheck(cur: OwnerFirm, others: readonly OwnerFirm[], id: { name?: string; edb?: string; acct?: string }, what = 'Изводот'): { other?: OwnerFirm; message: string } | null {
  const has = dig(id.edb).length >= 7 || dig(id.acct).length >= 8 || bkCore(id.name).length >= 4;
  if (!has || ownMatchFirm(cur, id)) return null;
  const other = others.find((x) => x.id !== cur.id && ownMatchFirm(x, id));
  if (!other && dig(id.edb).length < 7 && dig(id.acct).length < 8) return null;
  const who = other ? `„${other.name}“` : `„${id.name || 'непозната фирма'}“${id.edb ? ' (ЕДБ ' + id.edb + ')' : ''}${id.acct ? ' (сметка ' + id.acct + ')' : ''}`;
  return {
    ...(other ? { other } : {}),
    message: `⚠ ${what} изгледа дека е на ${who}, а сега работите во фирмата „${cur.name}“. ${other ? 'Препорака: откажете и префрлете се на „' + other.name + '“ (⇄ Промени фирма).' : 'Проверете дали е избрана точната фирма.'}`,
  };
}

/* ------------------------------------------------------------------ AI classification */

export interface ClassifyDoc { type: DocType; id: string; number?: string; partnerName: string; open: number }
export interface ClassifyLine { id: string; date: string; amount: number; desc: string }

/**
 * Inputs of the `aiClassify` prompt (4860–4875) as text blocks, built exactly like legacy: accounts = chart minus bank
 * kontos and classes 7/8 (`k v.mk`), open documents `inv:<id> | наша фактура … | отворено <o>` /
 * `pur:<id> | влезна фактура …`, lines `<id> | <date> | <amount> | <desc>` (amounts in denars).
 */
export function bankClassifyLists(a: { chart: readonly { code: string; name: string }[]; bankKontos: readonly string[]; docs: readonly ClassifyDoc[]; lines: readonly ClassifyLine[] }): { acc: string; docs: string; lines: string } {
  const BK = new Set(a.bankKontos.map(String));
  const acc = a.chart.filter((x) => !BK.has(x.code) && !x.code.startsWith('7') && !x.code.startsWith('8')).map((x) => x.code + ' ' + x.name).join('\n');
  const inv = a.docs.filter((d) => d.type === 'invoice' && d.open > 0).map((d) => `inv:${d.id} | наша фактура ${d.number ?? ''} | купувач ${d.partnerName} | отворено ${den(d.open)}`);
  const pur = a.docs.filter((d) => d.type === 'purchase' && d.open > 0).map((d) => `pur:${d.id} | влезна фактура ${d.number ?? ''} | добавувач ${d.partnerName} | отворено ${den(d.open)}`);
  return { acc, docs: [...inv, ...pur].join('\n') || '(none)', lines: a.lines.map((b) => `${b.id} | ${b.date} | ${den(b.amount)} | ${b.desc}`).join('\n') };
}

export interface ClassifyAnswer { id: string; ref?: { type: DocType; id: string }; konto?: string; reason: string }

/**
 * Validate the model answer like legacy (4879–4882): only lines still unbooked; `inv:` only for inflows, `pur:` only
 * for outflows, and the document must be one of the open ones; a konto must exist in the chart and not be a bank
 * konto. Reason is cut to 160 characters.
 */
export function bankClassifyAnswers(res: unknown, a: { lines: ReadonlyMap<string, { amount: number }>; docs: ReadonlySet<string>; chart: ReadonlySet<string>; bankKontos: readonly string[] }): ClassifyAnswer[] {
  const R = Array.isArray(res) ? res : res && typeof res === 'object' && Array.isArray((res as { items?: unknown }).items) ? (res as { items: unknown[] }).items : [];
  const BK = new Set(a.bankKontos.map(String));
  const out: ClassifyAnswer[] = [];
  const seen = new Set<string>();
  for (const r0 of R) {
    if (!r0 || typeof r0 !== 'object') continue;
    const r = r0 as { id?: unknown; ref?: unknown; konto?: unknown; reason?: unknown };
    const id = String(r.id ?? '');
    const b = a.lines.get(id);
    if (!b || seen.has(id)) continue;
    const reason = String(r.reason || '').slice(0, 160);
    const ref = typeof r.ref === 'string' ? r.ref : '';
    if (ref && /^inv:/.test(ref) && b.amount > 0) {
      if (!a.docs.has(ref)) continue;
      out.push({ id, ref: { type: 'invoice', id: ref.slice(4) }, reason });
    } else if (ref && /^pur:/.test(ref) && b.amount < 0) {
      if (!a.docs.has(ref)) continue;
      out.push({ id, ref: { type: 'purchase', id: ref.slice(4) }, reason });
    } else if (r.konto != null && a.chart.has(String(r.konto)) && !BK.has(String(r.konto))) {
      out.push({ id, konto: String(r.konto), reason });
    } else continue;
    seen.add(id);
  }
  return out;
}

/* ------------------------------------------------------------------ payment notifications */

export interface PayNoteCfg { pay: boolean; sum: boolean; to: string }

/** Legacy `pnCfg` (13309): defaults on (`pay`, `sum`), no summary address. */
export const payNoteCfg = (v: unknown): PayNoteCfg => {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<PayNoteCfg>;
  return { pay: o.pay !== false, sum: o.sum !== false, to: String(o.to ?? '').trim() };
};

/** Legacy `opDays` ≤ 45: notifications only for recent payments. */
export const payNoteRecent = (date: string, today: string): boolean => {
  const d = (Date.parse(today) - Date.parse(date)) / 864e5;
  return Number.isFinite(d) && d <= 45;
};

const fmtMk = (c: number) => (c / 100).toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (d: string) => String(d).slice(0, 10).split('-').reverse().join('.');

export interface PayNoteItem { invNo: string; invDate: string; partner: string; email: string; amt: number; open: number; date: string; ok?: boolean; why?: string }

/** Payment confirmation to the customer (legacy `pnRun` 13312, text verbatim). Amounts in cents. */
export function payNoteMail(q: PayNoteItem, firm: { name?: string | null; short?: string | null; signer?: string | null; phone?: string | null }): { subject: string; body: string } {
  return {
    subject: `Потврда за уплата – фактура ${q.invNo} – ${firm.short || firm.name || ''}`,
    body: `Почитувани,\n\nВи благодариме – ја примивме вашата уплата од ${fmtMk(q.amt)} ден. на ${dmy(q.date)} за фактура бр. ${q.invNo} од ${dmy(q.invDate)}.\n${q.open < 50 ? 'Фактурата е целосно платена.' : 'Преостанат износ за плаќање: ' + fmtMk(q.open) + ' ден.'}\n\nСо почит,\n${firm.signer || ''}\n${firm.name || ''}${firm.phone ? '\nТел.: ' + firm.phone : ''}`,
  };
}

/** Summary for the office (legacy `sumTxt` 13313). */
export function payNoteSummary(Q: readonly PayNoteItem[], firm: { name?: string | null; short?: string | null }, today: string, overdue?: { total: number; partners: number }): { subject: string; body: string; total: number; closed: number } {
  const total = Q.reduce((s, q) => s + q.amt, 0);
  const closed = Q.filter((q) => q.open < 50).length;
  const body = `Извод – наплата од купувачи (${firm.name || ''}), ${dmy(today)}\n\nНаплатено по фактури: ${fmtMk(total)} ден. (${Q.length} уплати)\nЦелосно платени фактури: ${closed}\n\n${Q.map((r) => `• ${r.partner} – ф-ра ${r.invNo}: ${fmtMk(r.amt)} ден.${r.open >= 50 ? ' (останува ' + fmtMk(r.open) + ')' : ' ✓ платена'}${r.ok ? ' · потврда испратена на ' + r.email : r.why ? ' · потврда: ' + r.why : ''}`).join('\n')}${overdue ? `\n\nСè уште неплатено по рокот: ${fmtMk(overdue.total)} ден. кај ${overdue.partners} купувачи.` : ''}`;
  return { subject: `Наплата по извод – ${firm.short || firm.name || ''} – ${fmtMk(total)} ден.`, body, total, closed };
}

/* ------------------------------------------------------------------ misc */

/** Open amount (cents) of documents for the manual-line picker: partner name and label (legacy `mbOpen` 13256). */
export const docLabel = (d: Pick<OpenDoc, 'number' | 'date'>, partnerName: string, open: number): string =>
  `${d.number || ''} · ${dmy(d.date)} · ${partnerName} · отворено ${fmtMk(open)}`;
