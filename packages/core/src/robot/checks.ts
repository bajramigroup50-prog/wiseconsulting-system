/**
 * 🤖 WISE Робот — pure safety checks:
 *  - a proposed journal must balance, every konto must exist in the firm's chart and partner kontos need a partner
 *    (the same rules `postJournal` enforces when the human confirms; refusing early keeps a wrong card from appearing);
 *  - every amount in a model answer must come from a tool result (`unverifiedNumbers`) — a number the model wrote that
 *    no tool returned is flagged under the answer.
 */
import { lineTotals, needsPartner } from '../ledger';
import { r2 } from '../money';

export interface ProposedLine { konto: string; debit: number; credit: number; partnerId?: string | null; partnerName?: string | null; note?: string | null }

export interface JournalCheck { ok: boolean; errors: string[]; debit: number; credit: number; diff: number; lines: ProposedLine[] }

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s);
const amt = (v: unknown): number => { const n = typeof v === 'string' ? Number(v.replace(/\s/g, '').replace(',', '.')) : Number(v); return Number.isFinite(n) ? r2(n) : NaN; };

/**
 * Validate a proposed journal against the chart (`chart` = konto codes of the firm's effective chart). `year` = the
 * working year: the date must be inside it.
 */
export function checkJournalProposal(p: { date?: unknown; lines?: unknown }, chart: ReadonlySet<string>, year: number): JournalCheck {
  const errors: string[] = [];
  const raw = Array.isArray(p.lines) ? p.lines : [];
  if (!isDate(p.date)) errors.push('Датумот на налогот не е важечки (ГГГГ-ММ-ДД).');
  else if (Number(p.date.slice(0, 4)) !== year) errors.push(`Датумот ${p.date} не е во работната година ${year}.`);
  if (raw.length < 2) errors.push('Налогот мора да има најмалку два реда.');
  if (raw.length > 60) errors.push('Налогот има премногу редови (најмногу 60).');
  const lines: ProposedLine[] = [];
  raw.slice(0, 60).forEach((x0, i) => {
    const x = (x0 ?? {}) as Record<string, unknown>;
    const konto = String(x.konto ?? x.account ?? '').trim();
    const d = amt(x.debit ?? 0), c = amt(x.credit ?? 0);
    const n = i + 1;
    if (!/^\d{3,10}$/.test(konto)) errors.push(`Ред ${n}: неважечко конто „${konto}“.`);
    else if (!chart.has(konto)) errors.push(`Ред ${n}: контото ${konto} не постои во контниот план на фирмата.`);
    if (Number.isNaN(d) || Number.isNaN(c)) errors.push(`Ред ${n}: неважечки износ.`);
    else if (d < 0 || c < 0) errors.push(`Ред ${n}: износите мора да се позитивни.`);
    else if ((d && c) || (!d && !c)) errors.push(`Ред ${n}: внесете износ или во Должи или во Побарува.`);
    const partnerId = typeof x.partnerId === 'string' && x.partnerId ? x.partnerId : null;
    if (/^\d/.test(konto) && needsPartner(konto) && !partnerId) errors.push(`Ред ${n}: контото ${konto} бара комитент.`);
    lines.push({ konto, debit: Number.isNaN(d) ? 0 : d, credit: Number.isNaN(c) ? 0 : c, partnerId, partnerName: typeof x.partnerName === 'string' ? x.partnerName : null, note: typeof x.note === 'string' ? x.note.slice(0, 200) : null });
  });
  const T = lineTotals(lines);
  if (lines.length && !T.balanced) errors.push(`Налогот не е изедначен: должи ${T.D.toFixed(2)} ≠ побарува ${T.P.toFixed(2)} (разлика ${T.diff.toFixed(2)}).`);
  if (lines.length && T.D === 0) errors.push('Налогот нема износи.');
  return { ok: !errors.length, errors, debit: T.D, credit: T.P, diff: T.diff, lines };
}

/* ---------------- amounts in answers ---------------- */

/** All numbers in a text as canonical strings (`1.234.567,89` / `1,234,567.89` / `1234567.89` → `1234567.89`). */
export function numbersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text ?? '').matchAll(/-?\d[\d.,\s]*\d|-?\d/g)) {
    let t = m[0].replace(/\s(?=\d{3}\b)/g, '').replace(/\s.*$/, '');
    const lastSep = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
    let v: number;
    if (lastSep >= 0 && t.length - lastSep - 1 <= 2 && t.length - lastSep - 1 > 0) {
      // decimal separator = the last one when 1–2 digits follow
      v = Number(t.slice(0, lastSep).replace(/[.,]/g, '') + '.' + t.slice(lastSep + 1));
    } else v = Number(t.replace(/[.,]/g, ''));
    if (Number.isFinite(v)) out.push(r2(v).toFixed(2));
  }
  return out;
}

/**
 * Amounts in `answer` (|x| ≥ 1000, or with decimals) that appear in none of the tool outputs. Small integers (days,
 * article numbers, years, counts) are not checked. A sign difference is accepted (a debt shown as positive).
 */
export function unverifiedNumbers(answer: string, toolTexts: readonly string[]): string[] {
  const known = new Set<string>();
  for (const t of toolTexts) for (const n of numbersIn(t)) { known.add(n); known.add(n.replace(/^-/, '')); }
  const bad = new Set<string>();
  for (const m of String(answer ?? '').matchAll(/-?\d[\d.,\s]*\d|-?\d/g)) {
    const raw = m[0].trim();
    const [n] = numbersIn(raw);
    if (!n) continue;
    const abs = Math.abs(Number(n));
    const hasDec = /[.,]\d{1,2}$/.test(raw);
    if (abs < 1000 && !hasDec) continue;
    // dates (14.10.2026, 2026-10-14) are not amounts
    if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(raw) || /^\d{4}-\d{2}-\d{2}$/.test(raw)) continue;
    if (/^(19|20)\d\d$/.test(raw)) continue;
    if (!known.has(n) && !known.has(n.replace(/^-/, ''))) bad.add(raw);
  }
  return [...bad];
}
