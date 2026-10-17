/**
 * Counter-konto suggestions for statement lines and „Прокнижи ги сите“.
 *
 * Order: the automatic matching (`autoMatch` — invoices, POS, VAT, payroll, learned payment-code and description
 * rules) and, for the lines it does not recognise, the payment code (шифра на плаќање: 840 данок, 843 придонеси,
 * 666 / 289 провизија), payments to the Treasury / NBRSM (јавни приходи), bank fees, and the counterparty as a
 * customer / supplier. Every suggestion says why, and a konto missing from the chart is reported, not posted.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  autoMatch, Bank, BANK_FEE, BKPK_RE, bankName, isFxAccount, isVatPayment, keywordKonto, noPartnerLine, ownTransferBy, PAY_SCH_KEYS, ruleSideOk, schemeValue,
  wrongSideWarning, type BankRow, type NoPartnerKind, type PayScheme,
} from '@wise/core';
import { audit, type Tx } from '../audit';
import { missingAccounts } from '../posting';
import { bankLines, bankStatements, partners, type BankLine } from '../schema/index';
import { BankError, loadBankEnv, type BankEnv } from './context';
import { matchContext } from './match';
import { assertStatementOpen, lineProblem, postStatement, type PostStatementResult } from './posting';
import { bookingPatch } from './rows';
import type { ImportPlan } from './import';

export interface LineSuggestion {
  /** '' = nothing to suggest. */
  konto: string;
  partnerId?: string;
  /** Counterparty to create as a partner (customer / supplier konto without a partner yet). */
  newPartner?: string;
  /** Why this konto (shown next to the suggestion). */
  why: string;
  /** Source: the automatic matching (`autoMatch` how) or a payment-code / text heuristic. */
  how: string;
  /** Linked invoice label when the matching closes a document. */
  refLabel?: string;
  /** The konto is not in the firm's chart — the line cannot be posted until it is added or changed. */
  missing?: boolean;
}

/** Payment codes of bank fees (Халкбанк / НЛБ statements). */
export const FEE_CODES = new Set(['666', '289']);
/** Treasury account of the Budget (ПП50 recipient) — public revenue payments. */
const TREASURY_RE = /^100000000063|^MK07100000000063/;
const PUBLIC_RE = /трезор|буџет|народна банка|нбрсм|ујп|управа за јавни приходи|фонд за (пензиско|здравствено)|пиом|фзом|агенција за вработување/i;
const CONTRIB_RE = /придонес|пио\b|пензиск|здравств|вработување|професионално заболување|мпин|ппр|ппо/i;
const PROFIT_RE = /добивка|711212|711216|аконтациј/i;
const PIT_RE = /персонален|данок на доход|пдд|711111|711112|7111/i;
const VAT_RE = /ддв|данок на додадена|714116|\bvat\b|\bddv\b/i;
/** Konto of the profit tax liability (year-end `taxPayable`). */
const PROFIT_TAX_KONTO = '2330';

export interface SuggestInput {
  /** Signed MKD amount in cents (+ inflow). */
  amount: number;
  desc?: string | null;
  name?: string | null;
  purpose?: string | null;
  osnov?: string | null;
  counterAccount?: string | null;
  acct?: string;
  date?: string;
}

const lc = (s: unknown) => String(s ?? '').toLowerCase();

const NP_WHY: Record<NoPartnerKind, string> = {
  fee: 'провизија / надоместок на банката (без комитент)', card: 'плаќање со платежна картичка (без комитент)', bank: 'банката не е комитент',
  treasury: 'јавни приходи (Трезор / Министерство за финансии) – без комитент', wage: 'исплата на плата (нето) – без комитент',
};
/** Payroll kontos from the posting scheme (`pay_*`), for the salary / contribution lines. */
const payScheme = (posting: BankEnv['posting']): Partial<PayScheme> =>
  Object.fromEntries(PAY_SCH_KEYS.map((k) => [k, schemeValue(posting, k)]).filter(([, v]) => !!v)) as Partial<PayScheme>;

/**
 * Heuristic counter konto of one line (pure, no database): learned payment-code rule → description rule →
 * bank fee → public revenue (840 / 843 / Treasury) → counterparty partner (1200 / 2200).
 */
export function suggestByCode(x: SuggestInput, env: Pick<BankEnv, 'rules' | 'osnovK' | 'partners' | 'konta' | 'posting' | 'accounts' | 'firm'>): LineSuggestion {
  const out = x.amount < 0;
  const text = [x.desc, x.name, x.purpose].filter(Boolean).join(' ');
  const t = lc(text);
  const code = String(x.osnov ?? '').trim();
  if (code) {
    const k = env.osnovK[code + '|' + (out ? 'out' : 'in')];
    if (k) return { konto: k, why: `запомнато правило за шифра ${code}`, how: 'osnov' };
  }
  const rule = env.rules.find((r) => r.match && t.includes(r.match.toLowerCase()) && ruleSideOk(r.konto, x.amount));
  if (rule) return { konto: rule.konto, why: `правило „${rule.match}“`, how: 'rule' };
  // the bank itself, card purchases, salaries, the Treasury / Ministry of Finance: never a customer / supplier
  const np = noPartnerLine({ id: '', date: x.date ?? '', amount: x.amount, desc: x.desc ?? '', ...(x.name ? { name: x.name } : {}), ...(x.purpose ? { purpose: x.purpose } : {}),
    ...(x.counterAccount ? { counterAccount: x.counterAccount } : {}) }, { konta: env.konta, payScheme: payScheme(env.posting) });
  if (np?.konto) return { konto: np.konto, why: NP_WHY[np.kind], how: np.kind === 'fee' ? 'fee' : np.kind === 'card' ? 'card' : np.kind === 'wage' ? 'payroll' : 'tax' };
  if (np?.kind === 'bank') return { konto: '', why: 'банката не е комитент – изберете конто (кредит, камата …)', how: '' };
  if (out && (FEE_CODES.has(code) || BANK_FEE.test(t))) return { konto: env.konta.fee, why: code && FEE_CODES.has(code) ? `шифра ${code} – провизија на банката` : 'провизија на банката', how: 'fee' };
  const pub = code === '840' || code === '843' || TREASURY_RE.test(String(x.counterAccount ?? '').replace(/\s/g, '')) || PUBLIC_RE.test(text);
  if (pub) {
    const row: BankRow = { id: '', date: x.date ?? '', amount: x.amount, desc: x.desc ?? '', ...(x.name ? { name: x.name } : {}), ...(x.purpose ? { purpose: x.purpose } : {}) };
    if (isVatPayment(row) || VAT_RE.test(text)) return { konto: out ? env.konta.ddvPay : env.konta.ddvClaim, why: out ? 'плаќање на ДДВ (јавни приходи)' : 'поврат на ДДВ', how: 'vat' };
    if (out) {
      if (code === '843' || CONTRIB_RE.test(text)) {
        return { konto: schemeValue(env.posting, 'pay_contrib') || '2349', why: `${code === '843' ? 'шифра 843' : 'јавни приходи'} – придонеси од плата (шема: придонеси)`, how: 'contrib' };
      }
      if (PROFIT_RE.test(text)) return { konto: PROFIT_TAX_KONTO, why: `${code ? 'шифра ' + code : 'јавни приходи'} – данок на добивка`, how: 'tax' };
      if (code === '840' || PIT_RE.test(text)) {
        return { konto: schemeValue(env.posting, 'pay_tax') || '2340', why: `${code === '840' ? 'шифра 840' : 'јавни приходи'} – данок (шема: персонален данок)`, how: 'tax' };
      }
      return { konto: '', why: 'плаќање на јавни приходи без шифра – изберете го контото на давачката', how: '' };
    }
  }
  const r0: BankRow = { id: '', date: x.date ?? '', amount: x.amount, desc: x.desc ?? '', ...(x.name ? { name: x.name } : {}), ...(x.purpose ? { purpose: x.purpose } : {}),
    ...(x.acct ? { acct: x.acct } : {}), ...(x.counterAccount ? { counterAccount: x.counterAccount } : {}) };
  const own = ownTransferBy(r0, { firmName: env.firm.name, firmEdb: env.firm.edb ?? undefined, accounts: env.accounts, partners: env.partners, konta: env.konta });
  if (own) {
    const fxA = isFxAccount(env.accounts, x.acct);
    return { konto: fxA ? env.konta.transitFx : env.konta.transit, why: 'пренос меѓу сопствени сметки (комитентот е самата фирма)', how: 'own' };
  }
  const kw = keywordKonto(r0, env.accounts, env.konta);
  if (kw) return { konto: kw.konto, why: kw.cls === 'turnover' ? 'уплата на дневен промет / пазар' : 'подигање готовина', how: kw.cls };
  const nm = bankName({ id: '', date: '', amount: x.amount, desc: x.desc ?? '', ...(x.name ? { name: x.name } : {}), ...(x.purpose ? { purpose: x.purpose } : {}) }, env.partners);
  const konto = out ? env.konta.supplier : env.konta.customer;
  const pid = Bank.matchPartner(env.partners, nm, '');
  if (pid) return { konto, partnerId: pid, why: `${out ? 'добавувач' : 'купувач'} ${env.partners.find((p) => p.id === pid)?.name ?? ''} (без фактура – аванс / отворена ставка)`, how: 'partner' };
  if (x.name && x.name.trim().length > 2) return { konto, newPartner: x.name.trim().slice(0, 120), why: `${out ? 'добавувач' : 'купувач'} „${x.name.trim()}“ – нов комитент`, how: 'partner' };
  return { konto: '', why: 'нема предлог – изберете конто', how: '' };
}

/** Lines that can still be booked: unbooked, or on a customer / supplier konto without a document. */
export const lineUnbooked = (l: BankLine) => !l.refId && !(l.split && l.split.length) && (!l.konto || (BKPK_RE.test(l.konto) && !l.partnerId));

/**
 * Suggestions for the unbooked lines of one or more statements (keyed by line id). The automatic matching wins
 * (it can close invoices); the payment-code heuristic covers the rest. Kontos missing from the chart are flagged.
 */
export async function statementSuggestions(tx: Tx, firmId: string, statementIds: string[], env0?: BankEnv): Promise<Map<string, LineSuggestion>> {
  const out = new Map<string, LineSuggestion>();
  if (!statementIds.length) return out;
  const L = await tx.select().from(bankLines).where(and(eq(bankLines.firmId, firmId), inArray(bankLines.statementId, statementIds))).orderBy(asc(bankLines.lineNo));
  const open = L.filter(lineUnbooked);
  if (!open.length) return out;
  const env = env0 ?? (await loadBankEnv(tx, firmId));
  const years = [...new Set(open.map((l) => Number(l.date.slice(0, 4))))];
  const ids = new Set(open.map((l) => l.id));
  for (const y of years) {
    const ctx = await matchContext(tx, env, y);
    for (const c of autoMatch(ctx).changes) {
      if (!ids.has(c.id) || !c.row.konto) continue;
      out.set(c.id, {
        konto: c.row.konto, ...(c.row.partner ? { partnerId: c.row.partner } : {}), ...(c.newPartner ? { newPartner: c.newPartner } : {}),
        why: c.row.ref ? `${Number(c.row.amount) > 0 ? 'наша фактура' : 'влезна фактура'} ${c.row.ref.label}` : AUTO_WHY[c.how] ?? c.how,
        how: c.how, ...(c.row.ref ? { refLabel: c.row.ref.label } : {}),
      });
    }
  }
  for (const l of open) {
    if (out.has(l.id)) continue;
    const s = suggestByCode({ amount: Math.round(Number(l.amount) * 100), desc: l.description, name: l.name, purpose: l.purpose, osnov: l.osnov, counterAccount: l.counterAccount, acct: l.bankAccountId, date: l.date }, env);
    // a line already on 1200 / 2200 that only lacks the partner keeps its konto
    const amt = Math.round(Number(l.amount) * 100);
    // (an inflow left on 22x / an outflow on 12x is re-proposed: customers pay to 1200, suppliers are paid from 2200)
    if (l.konto && BKPK_RE.test(l.konto) && s.konto !== l.konto && !wrongSideWarning(l.konto, amt, false) && !s.how.match(/^(fee|card|payroll|tax|vat|contrib)$/)) {
      out.set(l.id, { konto: l.konto, ...(l.newPartner ? { newPartner: l.newPartner } : {}), why: l.newPartner ? `нов комитент „${l.newPartner}“` : 'изберете комитент', how: 'partner' });
    } else out.set(l.id, s);
  }
  await flagMissing(tx, firmId, out.values());
  return out;
}

/**
 * Suggestions for the lines of an import preview (journal flow, editable before saving), keyed `day:index` like
 * `lineKey`. The preview lines join the year's lines for the automatic matching, so invoices are found too.
 */
export async function previewSuggestions(tx: Tx, firmId: string, plan: ImportPlan, env0?: BankEnv): Promise<Record<string, LineSuggestion>> {
  const env = env0 ?? (await loadBankEnv(tx, firmId));
  const out: Record<string, LineSuggestion> = {};
  const rows: BankRow[] = [];
  plan.days.forEach((d, di) => d.lines.forEach((l, i) => {
    if (l.dup) return;
    const key = `${di}:${i}`;
    if (l.konto) { out[key] = { konto: l.konto, ...(l.partner ? { partnerId: l.partner } : {}), ...(l.newPartner ? { newPartner: l.newPartner } : {}), why: CLS_WHY[l.cls ?? ''] ?? 'препознаено при увозот', how: l.cls ?? 'import' }; if (!BKPK_RE.test(l.konto)) return; }
    rows.push({ id: 'p:' + key, acct: d.accountId, date: l.date, amount: l.amount, desc: l.desc, ...(l.name ? { name: l.name } : {}), ...(l.purpose ? { purpose: l.purpose } : {}),
      ...(l.osnov ? { osnov: l.osnov } : {}), ...(l.konto ? { konto: l.konto } : {}), ...(l.partner ? { partner: l.partner } : {}), ...(l.amountCur != null ? { amountCur: l.amountCur } : {}) });
  }));
  for (const y of [...new Set(rows.map((r) => Number(r.date.slice(0, 4))))]) {
    const ctx = await matchContext(tx, env, y);
    for (const c of autoMatch({ ...ctx, rows: [...ctx.rows, ...rows.filter((r) => r.date.startsWith(String(y)))] }).changes) {
      if (!c.id.startsWith('p:') || !c.row.konto) continue;
      out[c.id.slice(2)] = {
        konto: c.row.konto, ...(c.row.partner ? { partnerId: c.row.partner } : {}), ...(c.newPartner ? { newPartner: c.newPartner } : {}),
        why: c.row.ref ? `${c.row.amount > 0 ? 'наша фактура' : 'влезна фактура'} ${c.row.ref.label}` : AUTO_WHY[c.how] ?? c.how, how: c.how,
        ...(c.row.ref ? { refLabel: c.row.ref.label } : {}),
      };
    }
  }
  plan.days.forEach((d, di) => d.lines.forEach((l, i) => {
    const key = `${di}:${i}`;
    if (l.dup || out[key]) return;
    out[key] = suggestByCode({ amount: l.amount, desc: l.desc, name: l.name, purpose: l.purpose, osnov: l.osnov ?? null, counterAccount: l.counterAccount ?? null, acct: d.accountId, date: l.date }, env);
  }));
  await flagMissing(tx, firmId, Object.values(out));
  return out;
}

/**
 * Period of a nalog for the statement import inside it: its own „период од / до“, else the months of a period
 * number (`6/10-12` → 01.10 – 31.12, `6/6-6` → June), else none (any date of the year).
 */
export function nalogPeriod(number: string, year: number, own?: { from?: string | null; to?: string | null }): { from: string | null; to: string | null } {
  if (own?.from || own?.to) return { from: own.from || null, to: own.to || null };
  const m = /\/(\d{1,2})-(\d{1,2})$/.exec(number.trim());
  if (!m) return { from: `${year}-01-01`, to: `${year}-12-31` };
  const a = Number(m[1]), b = Number(m[2]);
  if (!(a >= 1 && b <= 12 && a <= b)) return { from: `${year}-01-01`, to: `${year}-12-31` };
  const end = new Date(Date.UTC(year, b, 0)).toISOString().slice(0, 10);
  return { from: `${year}-${String(a).padStart(2, '0')}-01`, to: end };
}

const CLS_WHY: Record<string, string> = { pos: 'POS картички', conv: 'откуп на девизи', own: 'пренос меѓу свои сметки', fee: 'провизија', tech: 'посебна сметка' };

export const AUTO_WHY: Record<string, string> = {
  pos: 'POS картички', vat: 'ДДВ (УЈП)', osnov: 'запомнато правило за шифрата', fee: 'провизија на банката', payroll: 'плата / придонеси по пресметката',
  rule: 'правило за описот', num: 'по број на фактура', amt: 'по износ на фактура', sum: 'збир на фактури',
};

/** Mark suggestions whose konto is not in the chart (the reason is extended, the konto kept). */
export async function flagMissing(tx: Tx, firmId: string, S: Iterable<LineSuggestion>): Promise<void> {
  const A = [...S].filter((s) => s.konto);
  const miss = new Set(await missingAccounts(tx, firmId, A.map((s) => s.konto)));
  for (const s of A) if (miss.has(s.konto)) { s.missing = true; s.why = `конто ${s.konto} не постои во контниот план (${s.why}) – додадете го во „Контен план“ или изберете друго`; }
}

export interface BookAllResult {
  booked: number;
  /** Lines left unbooked, with the reason. */
  skipped: { lineId: string; lineNo: number; why: string }[];
  posted: Map<string, PostStatementResult>;
}

/**
 * „Прокнижи ги сите“: book every unbooked line of the statements on its (possibly user-edited) counter konto and
 * post the statements. `overrides` = konto / partner chosen by the user per line id (wins over the suggestion).
 * Lines without a usable konto stay unbooked and are returned with the reason.
 */
export async function bookStatementLines(tx: Tx, a: {
  firmId: string; userId: string | null; statementIds: string[];
  overrides?: Record<string, { konto: string; partnerId?: string | null; createPartner?: string | null }>;
  /** Book only these lines (one-click „✓ Прокнижи“ on a line); default every line of the statements. */
  onlyLines?: string[];
  /**
   * Suggestions and matched rows computed by the caller (the „Преглед за книжење“ pass, `review.ts`) instead of
   * `statementSuggestions` + `autoMatch` here — what the user confirmed is exactly what is booked.
   */
  pre?: { sugg: Map<string, LineSuggestion>; rows: Map<string, BankRow> };
  /** Audit action (default `bankBookAll`) and extra audit data. */
  auditAction?: string;
  auditData?: Record<string, unknown>;
}): Promise<BookAllResult> {
  const S = a.statementIds.length ? await tx.select().from(bankStatements).where(and(eq(bankStatements.firmId, a.firmId), inArray(bankStatements.id, a.statementIds))) : [];
  if (S.length !== new Set(a.statementIds).size) throw new BankError('Изводот не постои.');
  for (const st of S) await assertStatementOpen(tx, st);
  const env = await loadBankEnv(tx, a.firmId);
  const sugg = a.pre?.sugg ?? (await statementSuggestions(tx, a.firmId, a.statementIds, env));
  const L = await tx.select().from(bankLines).where(and(eq(bankLines.firmId, a.firmId), inArray(bankLines.statementId, a.statementIds))).orderBy(asc(bankLines.lineNo));
  const bankK = new Set(env.accounts.map((x) => x.konto));
  const ov = a.overrides ?? {};
  // konto validity of the user's choices (chart, not a bank konto)
  const ovK = Object.values(ov).map((o) => o.konto).filter(Boolean);
  const miss = new Set(await missingAccounts(tx, a.firmId, ovK));
  const skipped: BookAllResult['skipped'] = [];
  const matchRows = a.pre?.rows ?? new Map<string, BankRow>();
  if (!a.pre) {
    for (const y of [...new Set(L.map((l) => Number(l.date.slice(0, 4))))]) {
      const ctx = await matchContext(tx, env, y);
      for (const c of autoMatch(ctx).changes) matchRows.set(c.id, c.row);
    }
  }
  const fx = (l: BankLine) => !!l.cur && l.cur !== 'MKD';
  let booked = 0;
  for (const l of L) {
    if (a.onlyLines && !a.onlyLines.includes(l.id)) continue;
    const o0 = ov[l.id];
    // an override equal to an existing booking (POS, conversion, own transfer) keeps that booking
    const o = o0 && !(l.konto && o0.konto === l.konto && !lineUnbooked(l)) ? o0 : undefined;
    if (!lineUnbooked(l) && !o) continue;
    const s = sugg.get(l.id);
    let konto = o?.konto?.trim() || '';
    const same = !!s && (!o || s.konto === konto);
    let partnerId: string | null = (o?.partnerId || null) ?? null;
    if (!partnerId && same) partnerId = s!.partnerId ?? null;
    if (!partnerId && (!o || o.konto === l.konto)) partnerId = l.partnerId ?? null;
    const create = o?.createPartner || (same ? s!.newPartner : null) || l.newPartner || null;
    if (o && konto) {
      if (!/^\d{2,10}$/.test(konto)) { skipped.push({ lineId: l.id, lineNo: l.lineNo, why: `неважечко конто „${konto}“` }); continue; }
      if (bankK.has(konto)) { skipped.push({ lineId: l.id, lineNo: l.lineNo, why: `конто ${konto} е конто на банкарска сметка – изберете спротивно конто` }); continue; }
      if (miss.has(konto)) { skipped.push({ lineId: l.id, lineNo: l.lineNo, why: `конто ${konto} не постои во контниот план` }); continue; }
    } else if (!o) {
      if (!s?.konto) { skipped.push({ lineId: l.id, lineNo: l.lineNo, why: s?.why ?? 'нема предлог – изберете конто' }); continue; }
      if (s.missing) { skipped.push({ lineId: l.id, lineNo: l.lineNo, why: s.why }); continue; }
      konto = s.konto;
    } else { skipped.push({ lineId: l.id, lineNo: l.lineNo, why: 'не е избрано конто' }); continue; }
    if (partnerId && !env.partners.some((p) => p.id === partnerId)) throw new BankError('Комитентот не постои.');
    if (!partnerId && create && BKPK_RE.test(konto)) partnerId = await ensureLinePartner(tx, a.firmId, a.userId, create, l.counterAccount);
    if (BKPK_RE.test(konto) && !partnerId) { skipped.push({ lineId: l.id, lineNo: l.lineNo, why: `конто ${konto} бара комитент – изберете го` }); continue; }
    // the matched row (invoice link, split, POS) when the user kept the suggestion
    const m = !o || o.konto === matchRows.get(l.id)?.konto ? matchRows.get(l.id) : undefined;
    const patch = m && (!o || !o.partnerId || o.partnerId === m.partner)
      ? { ...bookingPatch({ ...m, ...(partnerId && !m.partner ? { partner: partnerId } : {}) }), auto: s?.how || null }
      : { konto, partnerId, refType: null, refId: null, refLabel: null, refs: null, settle: null, split: null, payRef: null, auto: o ? null : s?.how || null };
    await tx.update(bankLines).set({ ...patch, newPartner: null }).where(eq(bankLines.id, l.id));
    booked++;
    const after = { ...l, ...patch } as BankLine;
    const p = lineProblem(after, fx(l));
    if (p) skipped.push({ lineId: l.id, lineNo: l.lineNo, why: p });
  }
  const posted = new Map<string, PostStatementResult>();
  for (const st of S) posted.set(st.id, await postStatement(tx, st.id, a.userId, env));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: a.auditAction ?? 'bankBookAll', entityType: 'bank_statement', entityId: a.statementIds[0],
    data: { statements: a.statementIds, booked, skipped: skipped.map((x) => ({ line: x.lineNo, why: x.why })), overrides: Object.keys(ov).length, ...(a.auditData ?? {}) } });
  return { booked, skipped, posted };
}

async function ensureLinePartner(tx: Tx, firmId: string, userId: string | null, name: string, bankAccount?: string | null): Promise<string> {
  const [ex] = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.firmId, firmId), eq(partners.name, name))).limit(1);
  if (ex) return ex.id;
  const [p] = await tx.insert(partners).values({ firmId, name, bankAccount: bankAccount ?? null }).returning({ id: partners.id });
  await audit(tx, { userId, firmId, action: 'newS', entityType: 'partner', entityId: p!.id, data: { name, from: 'bank' } });
  return p!.id;
}
