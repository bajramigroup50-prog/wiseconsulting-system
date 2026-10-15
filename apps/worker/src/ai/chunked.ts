/**
 * Large PDFs (a 39-page analytic trial balance, a long bank statement) do not fit one model answer: the output limit
 * (max_tokens) cut the JSON and the read failed with „Документот е преголем…“ after paying for the whole input.
 * Here the size is estimated BEFORE any call (pages, rows of the text layer) and a large document is read in page
 * ranges with the same prompt and tier, then merged deterministically per kind and checked like the free readers
 * (trial balance: Σ debit = Σ credit and the printed grand total; statement: opening + movements = closing).
 *
 * Kinds: `ob` (rows concatenated, carry-over / total lines dropped, printed totals from the chunks, grand total from
 * the last chunk that printed one) and `bank` (transactions concatenated, opening from the first chunk, closing from
 * the last). Invoices are not chunked (a multi-invoice PDF is split per invoice, `split.ts`).
 */
import { PDFDocument } from 'pdf-lib';
import type { PdfItem } from '@wise/core/noai/pdf-lines';
import { pdfTextItems } from './pdf-text';

export type ChunkKind = 'ob' | 'bank';
export const CHUNK_KINDS: ReadonlySet<string> = new Set<ChunkKind>(['ob', 'bank']);

/** Output tokens of one row of the answer JSON (konto, names, partner, two amounts ≈ 25–35 tokens) with a margin. */
const TOK_PER_ROW: Record<ChunkKind, number> = { ob: 40, bank: 70 };
/** Rows per page of a scan (no text layer to count): a dense A4 table. */
const ROWS_PER_SCAN_PAGE = 45;
/** Never more pages per call (input size, attention on long tables). */
export const MAX_CHUNK_PAGES = 6;
/** Share of max_tokens a call is planned to use: the estimate is rough, the answer must never be cut. */
const FILL = 0.6;
/** max_tokens of one chunk call (Sonnet, non-streaming; the SDK refuses non-streaming calls above ~21k). */
export const CHUNK_MAX_TOKENS = 16000;

export interface ReadPlan {
  pages: number;
  /** Estimated output tokens of a single read of the whole document. */
  estTokens: number;
  /** Page ranges (1-based, inclusive); one range = read in one call. */
  ranges: { from: number; to: number }[];
}

/** Rows (lines carrying an amount) per page of a text layer; empty when the PDF has no text (scan). */
export function rowsPerPage(items: readonly PdfItem[]): Map<number, number> {
  const lines = new Map<string, string>();
  for (const it of items) {
    const k = it.page + ':' + Math.round(it.y / 3);
    lines.set(k, (lines.get(k) ?? '') + ' ' + it.s);
  }
  const out = new Map<number, number>();
  for (const [k, s] of lines) if (/\d[\d.,  ]*[.,]\d{2}(?!\d)/.test(s)) { const p = Number(k.split(':')[0]); out.set(p, (out.get(p) ?? 0) + 1); }
  return out;
}

/** Plan the read: one call when the answer surely fits, otherwise ranges of pages whose answers fit. */
export function planRead(kind: ChunkKind, pages: number, perPage: Map<number, number>, maxTokens = CHUNK_MAX_TOKENS): ReadPlan {
  const rows = (p: number) => (perPage.size ? perPage.get(p) ?? 0 : ROWS_PER_SCAN_PAGE);
  const tok = (p: number) => rows(p) * TOK_PER_ROW[kind];
  let est = 200;
  for (let p = 1; p <= pages; p++) est += tok(p);
  const budget = maxTokens * FILL;
  if (pages <= MAX_CHUNK_PAGES && est <= budget) return { pages, estTokens: est, ranges: [{ from: 1, to: Math.max(1, pages) }] };
  const ranges: { from: number; to: number }[] = [];
  let from = 1, acc = 200;
  for (let p = 1; p <= pages; p++) {
    const t = tok(p);
    if (p > from && (acc + t > budget || p - from >= MAX_CHUNK_PAGES)) { ranges.push({ from, to: p - 1 }); from = p; acc = 200; }
    acc += t;
  }
  ranges.push({ from, to: pages });
  return { pages, estTokens: est, ranges };
}

/** Page count of a PDF (null when pdf-lib cannot open it). */
export async function pdfPageCount(bytes: Uint8Array): Promise<number | null> {
  try { return (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount(); } catch { return null; }
}

/** Plan a PDF read from its bytes (page count + text-layer rows). Null when the PDF cannot be opened. */
export async function planPdfRead(kind: ChunkKind, bytes: Uint8Array, maxTokens = CHUNK_MAX_TOKENS): Promise<ReadPlan | null> {
  const pages = await pdfPageCount(bytes);
  if (!pages) return null;
  let items: PdfItem[] = [];
  try { items = await pdfTextItems(bytes, 200); } catch { items = []; }
  return planRead(kind, pages, rowsPerPage(items), maxTokens);
}

/** Cut the page ranges out of a PDF (one PDF per range). */
export async function pdfRanges(bytes: Uint8Array, ranges: readonly { from: number; to: number }[]): Promise<Uint8Array[]> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out: Uint8Array[] = [];
  for (const r of ranges) {
    const d = await PDFDocument.create();
    const P = await d.copyPages(src, Array.from({ length: r.to - r.from + 1 }, (_, i) => r.from - 1 + i));
    P.forEach((p) => d.addPage(p));
    out.push(await d.save());
  }
  return out;
}

/** The note added to the prompt of a chunk (the model must not invent the missing parts). */
export const chunkNote = (kind: ChunkKind, i: number, n: number, r: { from: number; to: number }, pages: number): string =>
  `\n\nNOTE: this PDF is PART ${i + 1} of ${n} (pages ${r.from}–${r.to} of ${pages}) of one longer ${kind === 'ob' ? 'trial balance' : 'bank statement'}. `
  + 'Read ONLY what is printed on these pages, every line, in order. Lines at the top may continue an account / partner list from the previous part – keep them (empty konto if it is not printed). '
  + (kind === 'ob' ? 'Do not return carry-over („Пренос“ / „Донос“) lines. Return "grand" only if the grand total is printed on these pages, else [0,0].'
    : 'Return openingBalance only if it is printed on these pages (else 0), closingBalance likewise, and the totals only if printed here.');

// ---- merge + checks ----

type ObRow = [string, string, string, string, number, number];
export interface ObRead { rows: ObRow[]; totals: [string, number, number][]; grand: [number, number] }
const num = (x: unknown) => { const n = typeof x === 'number' ? x : Number(String(x ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const r2 = (x: number) => Math.round(x * 100) / 100;
/** Carry-over / total lines that a chunk may still return as rows. */
const CARRY = /^\s*(пренос|донос|вкупно|се вкупно|сè вкупно|сума|збир|total|subtotal)(?!\p{L})/iu;

export function mergeOb(parts: readonly unknown[]): ObRead & { check: ObCheck; chunks: number } {
  const rows: ObRow[] = [];
  const totals = new Map<string, [string, number, number]>();
  let grand: [number, number] = [0, 0];
  for (const p0 of parts) {
    const p = (Array.isArray(p0) ? { rows: p0 } : (p0 ?? {})) as { rows?: unknown[]; totals?: unknown[]; grand?: unknown };
    for (const r0 of p.rows ?? []) {
      if (!Array.isArray(r0)) continue;
      const r: ObRow = [String(r0[0] ?? '').replace(/\D/g, ''), String(r0[1] ?? ''), String(r0[2] ?? ''), String(r0[3] ?? ''), num(r0[4]), num(r0[5])];
      if (CARRY.test(r[1]) || CARRY.test(r[2]) || (!r[0] && !r[1] && !r[2] && !r[3])) continue;
      rows.push(r);
    }
    for (const t of p.totals ?? []) if (Array.isArray(t) && t[0] != null) totals.set(String(t[0]), [String(t[0]), num(t[1]), num(t[2])]);
    const g = Array.isArray(p.grand) ? [num(p.grand[0]), num(p.grand[1])] as [number, number] : [0, 0] as [number, number];
    if (g[0] || g[1]) grand = g; // the printed grand total is on the last page: the last chunk that has one wins
  }
  const out = { rows, totals: [...totals.values()], grand };
  return { ...out, check: checkOb(out), chunks: parts.length };
}

export interface ObCheck { debit: number; credit: number; balanced: boolean; grandOk: boolean | null; warnings: string[] }
/** Σ debit = Σ credit of the САЛДО columns, and = the printed grand total when there is one. */
export function checkOb(r: Pick<ObRead, 'rows' | 'grand'>): ObCheck {
  const debit = r2(r.rows.reduce((s, x) => s + x[4], 0)), credit = r2(r.rows.reduce((s, x) => s + x[5], 0));
  const balanced = Math.abs(debit - credit) < 1;
  const g = r.grand;
  const grandOk = g[0] || g[1] ? Math.abs(g[0] - debit) < 1 && Math.abs(g[1] - credit) < 1 : null;
  const warnings: string[] = [];
  if (!balanced) warnings.push(`Должи (${debit}) ≠ Побарува (${credit}) – разлика ${r2(debit - credit)}.`);
  if (grandOk === false) warnings.push(`Збирот на редовите (${debit} / ${credit}) не е еднаков на печатениот вкупен износ (${g[0]} / ${g[1]}).`);
  return { debit, credit, balanced, grandOk, warnings };
}

export interface BankItem { date?: string; desc?: string; name?: string; purpose?: string; ref?: string; code?: string; amount: number; amountMkd?: number; stmtNo?: string }
export interface BankRead {
  number: string; totalDebit: number; totalCredit: number; openingBalance: number; closingBalance: number;
  account: string; owner: string; currency: string; rate: number; items: BankItem[];
}

export function mergeBank(parts: readonly unknown[]): BankRead & { balanced: boolean | null; warnings: string[]; chunks: number; statements?: BankRead[] } {
  const P = parts.map((p) => (p ?? {}) as Partial<BankRead> & { statements?: Partial<BankRead>[] });
  // several statements in the PDF (BANK_MULTI_NOTE): the statements of all parts, a statement cut by a part boundary
  // (same number in two parts) joined — each keeps its own number, balances and lines
  if (P.some((p) => Array.isArray(p.statements) && p.statements.length)) {
    const S: BankRead[] = [];
    for (const p of P) {
      for (const s0 of Array.isArray(p.statements) && p.statements.length ? p.statements : p.items?.length ? [p] : []) {
        const s = mergeBank([s0]);
        const prev = S[S.length - 1];
        if (prev && s.number && prev.number === s.number) {
          prev.items.push(...s.items);
          if (s.closingBalance) prev.closingBalance = s.closingBalance;
          if (s.totalDebit) prev.totalDebit = s.totalDebit;
          if (s.totalCredit) prev.totalCredit = s.totalCredit;
        } else S.push({ number: s.number, account: s.account, owner: s.owner, currency: s.currency, rate: s.rate, openingBalance: s.openingBalance, closingBalance: s.closingBalance, totalDebit: s.totalDebit, totalCredit: s.totalCredit, items: s.items });
      }
    }
    const C = S.map(checkBank);
    const first = S[0];
    return {
      number: '', account: first?.account ?? '', owner: first?.owner ?? '', currency: first?.currency ?? 'MKD', rate: first?.rate ?? 0,
      openingBalance: first?.openingBalance ?? 0, closingBalance: S[S.length - 1]?.closingBalance ?? 0, totalDebit: 0, totalCredit: 0,
      items: S.flatMap((s) => s.items.map((it) => ({ ...it, ...(s.number ? { stmtNo: s.number } : {}) }))),
      statements: S,
      balanced: C.every((c) => c.balanced === true) ? true : C.some((c) => c.balanced === false) ? false : null,
      warnings: C.flatMap((c, i) => c.warnings.map((w) => (S[i]!.number ? `Извод бр. ${S[i]!.number}: ${w}` : w))),
      chunks: parts.length,
    };
  }
  const first = <K extends keyof BankRead>(k: K) => P.map((p) => p[k]).find((v) => v != null && v !== '' && v !== 0);
  const last = <K extends keyof BankRead>(k: K) => [...P].reverse().map((p) => p[k]).find((v) => v != null && v !== '' && v !== 0);
  const items: BankItem[] = [];
  for (const p of P) for (const it of p.items ?? []) if (it && typeof it === 'object') items.push({ ...it, amount: num(it.amount) });
  const out: BankRead = {
    number: String(first('number') ?? ''), account: String(first('account') ?? ''), owner: String(first('owner') ?? ''),
    currency: String(first('currency') ?? 'MKD'), rate: num(first('rate')),
    openingBalance: num(P[0]?.openingBalance), closingBalance: num(last('closingBalance')),
    totalDebit: num(last('totalDebit')), totalCredit: num(last('totalCredit')),
    items,
  };
  const c = checkBank(out);
  return { ...out, ...c, chunks: parts.length };
}

/** opening + Σ movements = closing (null when the statement printed no balances). */
export function checkBank(r: Pick<BankRead, 'openingBalance' | 'closingBalance' | 'items'>): { balanced: boolean | null; warnings: string[] } {
  if (!r.openingBalance && !r.closingBalance) return { balanced: null, warnings: [] };
  const sum = r2(r.items.reduce((s, x) => s + x.amount, 0));
  const balanced = Math.abs(r2(r.openingBalance + sum) - r.closingBalance) < 0.5;
  return { balanced, warnings: balanced ? [] : [`Почетна (${r.openingBalance}) + промени (${sum}) ≠ крајна состојба (${r.closingBalance}).`] };
}
