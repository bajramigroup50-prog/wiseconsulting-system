/**
 * Macedonian banks by the 3-digit code that starts every 15-digit transaction account (and the MK IBAN after
 * `MKkk`), plus account parsing / IBAN conversion and finding accounts printed in a document's text.
 *
 * Account rule (NBRM, ISO 7064 MOD 97-10): 3-digit bank code + 10 digits + 2 control digits, control =
 * 98 − (first 13 digits × 100 mod 97). IBAN: `MK` + 2 check digits (ISO 13616 mod-97) + the 15-digit account.
 *
 * `verified: false` = the code ↔ bank pairing comes from accounting practice / older registries and has not been
 * confirmed against the current NBRM register — „за проверка“. An unknown code gives no bank name (typed by hand).
 */
import { ibanValid, mkAccountValid, ppIban } from './payment-order';

export interface MkBank { code: string; name: string; bic: string; verified: boolean; note?: string }

export const MK_BANK_CODES: readonly MkBank[] = [
  { code: '100', name: 'Народна банка на РСМ', bic: 'NBRMMK2X', verified: true, note: 'Трезорска сметка 100000000063095' },
  { code: '200', name: 'Стопанска Банка АД Скопје', bic: 'STOBMK2X', verified: true },
  { code: '210', name: 'НЛБ Банка АД Скопје', bic: 'TUTNMK22', verified: true },
  { code: '240', name: 'УНИ Банка АД Скопје', bic: 'UIBMMK22', verified: false },
  { code: '250', name: 'Шпаркасе Банка АД Скопје', bic: 'INSBMK22', verified: false },
  { code: '270', name: 'Халк Банка АД Скопје', bic: 'EXPCMK22', verified: true },
  { code: '280', name: 'Силк Роуд Банка АД Скопје', bic: 'KRSKMK2X', verified: false, note: 'поранешна Алфа / Кредитна банка' },
  { code: '290', name: 'ТТК Банка АД Скопје', bic: 'TTXBMK2X', verified: false },
  { code: '300', name: 'Комерцијална Банка АД Скопје', bic: 'KOBSMK2X', verified: true },
  { code: '320', name: 'Централна кооперативна банка АД Скопје', bic: 'CECBMK22', verified: false },
  { code: '380', name: 'ПроКредит Банка АД Скопје', bic: 'PRBUMK22', verified: true },
  { code: '500', name: 'Алта Банка АД Битола', bic: 'STBBMK22', verified: false, note: 'поранешна Стопанска банка Битола' },
  { code: '530', name: 'Шпаркасе Банка АД Скопје', bic: 'INSBMK22', verified: false, note: 'поранешна Охридска банка' },
];

const BY_CODE = new Map(MK_BANK_CODES.map((b) => [b.code, b]));
const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** Bank of a 15-digit account or MK IBAN by its code; undefined when unknown. */
export function mkBankOf(acc: unknown): MkBank | undefined {
  const s = String(acc ?? '').replace(/\s+/g, '').toUpperCase();
  const b = s.startsWith('MK') ? s.slice(4) : dig(s);
  return b.length >= 3 ? BY_CODE.get(b.slice(0, 3)) : undefined;
}

/** Bank name of an account ('' when the code is unknown). */
export const mkBankName = (acc: unknown): string => mkBankOf(acc)?.name ?? '';

/** A parsed account: `acc` = 15 digits (MK) or '' (foreign IBAN), `iban` always filled. */
export interface ParsedAccount { acc: string; iban: string; bank: string; foreign: boolean }

/**
 * Parse a typed / read account: `270-0772995201-74`, `270 0772995201 74`, `MK07 2700 …`, a foreign IBAN.
 * null when it is not a valid account (wrong length or control digits).
 */
export function parseAccount(v: unknown): ParsedAccount | null {
  const s = String(v ?? '').replace(/[\s.]+/g, '').toUpperCase();
  if (!s) return null;
  if (/^[A-Z]{2}\d{2}/.test(s)) {
    if (!ibanValid(s)) return null;
    if (s.startsWith('MK')) {
      const acc = s.slice(4);
      if (!mkAccountValid(acc)) return null;
      return { acc, iban: s, bank: mkBankName(acc), foreign: false };
    }
    return { acc: '', iban: s, bank: '', foreign: true };
  }
  if (/[^\d-]/.test(s)) return null;
  const acc = dig(s);
  if (!mkAccountValid(acc)) return null;
  return { acc, iban: ppIban(acc), bank: mkBankName(acc), foreign: false };
}

/** The key two spellings of one account share (15 digits for MK, the IBAN otherwise). */
export const accountKey = (v: unknown): string => { const p = parseAccount(v); return p ? p.acc || p.iban : ''; };

/**
 * An account at the Treasury / НБРМ (bank code 100, „Трезорска сметка“ 100-0000000630-95 …): shared by every state body,
 * municipality and public institution — never identifies a partner.
 */
export function treasuryAccount(v: unknown): boolean {
  const k = accountKey(v) || String(v ?? '').replace(/\D/g, '');
  return /^100\d{12}$/.test(k) || /^MK\d{2}100\d{12}$/.test(k);
}

/** Account → IBAN (MK07…) when it is a valid MK account; the input unchanged otherwise. */
export function toIban(v: unknown): string {
  const p = parseAccount(v);
  return p ? p.iban : String(v ?? '').trim();
}

/** IBAN / formatted account → the plain 15 digits when valid; the input unchanged otherwise. */
export function fromIban(v: unknown): string {
  const p = parseAccount(v);
  return p && p.acc ? p.acc : String(v ?? '').trim();
}

export interface FoundAccount extends ParsedAccount { /** printed next to „жиро / трансакциска сметка / IBAN“ */ labelled: boolean; index: number }

const LABEL = /(жиро|трансакциск|тековн|сметка|сметки|ж\.\s?с|т\.\s?с|iban|account|racun|сметк|bank)/i;

/**
 * Valid accounts printed in a text (an invoice, a contract), in reading order without repeats: MK IBANs and
 * 15-digit accounts as `XXX-XXXXXXXXXX-XX`, with spaces or plain. The control digits filter out other numbers.
 * `exclude` = own accounts (the firm's) that must not be taken as the other party's.
 */
export function accountsInText(text: string, exclude: readonly string[] = []): FoundAccount[] {
  const ex = new Set(exclude.map(accountKey).filter(Boolean));
  const out: FoundAccount[] = [];
  const seen = new Set<string>();
  const add = (raw: string, index: number) => {
    const p = parseAccount(raw);
    if (!p) return;
    const k = p.acc || p.iban;
    if (seen.has(k) || ex.has(k)) return;
    seen.add(k);
    const before = text.slice(Math.max(0, index - 60), index);
    out.push({ ...p, labelled: LABEL.test(before) || /^MK/i.test(raw), index });
  };
  for (const m of text.matchAll(/\b[A-Z]{2}\s?\d{2}(?:\s?[A-Z0-9]){11,30}\b/g)) add(m[0], m.index ?? 0);
  for (const m of text.matchAll(/(?<![\d-])(\d{3})[\s-]?(\d{10})[\s-]?(\d{2})(?![\d-])/g)) add(m[0], m.index ?? 0);
  for (const m of text.matchAll(/(?<![\d-])(\d{3})[\s-](\d{3,4})[\s-]?(\d{3,4})[\s-]?(\d{2,4})[\s-]?(\d{0,3})(?![\d-])/g)) if (dig(m[0]).length === 15) add(m[0], m.index ?? 0);
  return out.sort((a, b) => a.index - b.index);
}

/** The account a supplier most likely wants to be paid to: the first labelled one, else the first valid one. */
export function supplierAccountIn(text: string, exclude: readonly string[] = []): string {
  const L = accountsInText(text, exclude).filter((a) => a.bank !== 'Народна банка на РСМ');
  const a = L.find((x) => x.labelled) ?? L[0];
  return a ? a.acc || a.iban : '';
}

/* ------------------------------------------------------------------ bank konto by bank */

/** How each bank is named in the chart of accounts (analytics of 1000: „Жиро сметка халк банка“, „Под сметка халк банка“ …). */
const CHART_BANK_RE: Record<string, RegExp> = {
  '200': /стопанска(?!\s+банка\s+битола)/i, '210': /тутунска|нлб/i, '240': /уни\s*банка/i, '250': /шпаркасе/i, '270': /халк/i,
  '280': /силк\s*ро|алфа\s*банка|кредитна\s*банка/i, '290': /ттк/i, '300': /комерцијална/i, '320': /централна\s+кооперативна|цкб/i,
  '380': /прокредит/i, '500': /алта|стопанска\s+банка\s+битола/i, '530': /шпаркасе|охридска/i,
};
const SUB_RE = /под\s*-?\s*сметка|подсметка/i;
/** Purpose / savings accounts of a bank are never picked automatically. */
const SPECIAL_RE = /наменска|совест|разговор|почеток|депозит|штедн/i;

/**
 * Analytic bank konto (under 1000) for a new denar account by its bank: the 3-digit code of the account → the chart
 * konto whose name names that bank — the main „Жиро сметка … банка“ for the firm's first account of that bank, then
 * an unused „Под сметка … банка“ for the next ones. Firm-specific chart entries (`own`) first. null = nothing matches
 * (the caller falls back to 1000).
 */
export function pickBankKonto(acc: unknown, chart: readonly { code: string; name: string; own?: boolean }[], used: readonly string[] = []): string | null {
  const b = mkBankOf(acc);
  const re = b ? CHART_BANK_RE[b.code] : undefined;
  if (!re) return null;
  const C = chart.filter((a) => /^1000\d+$/.test(a.code) && re.test(a.name) && !SPECIAL_RE.test(a.name))
    .sort((x, y) => (Number(!!y.own) - Number(!!x.own)) || x.code.length - y.code.length || (x.code < y.code ? -1 : x.code > y.code ? 1 : 0));
  const U = new Set(used);
  const main = C.filter((a) => !SUB_RE.test(a.name));
  const sub = C.filter((a) => SUB_RE.test(a.name));
  const m = main[0];
  if (m && !U.has(m.code)) return m.code;
  const s = sub.find((a) => !U.has(a.code)) ?? main.find((a) => !U.has(a.code));
  return s ? s.code : null;
}

/** A generic bank konto (the synthetic 1000 / 100) that an analytic per bank should replace. */
export const genericBankKonto = (k: string | null | undefined): boolean => k === '1000' || k === '100';
