/**
 * „🔁 Рекнижење во маса“ (mass reclassify, for year-end corrections): the pure rules — which journal lines a filter
 * finds, how each line is changed (konto / partner / both), which lines may not be changed and why (locked period,
 * locked nalog, closing nalog, document partner, konto that needs a partner), the preview (old → new per line and the
 * totals per konto before / after) and the undo of a batch (the same items with old and new swapped).
 *
 * The amounts of a line never change, so every nalog stays balanced; the database side (`@wise/db` `reclass.ts`)
 * re-posts each nalog through its own path: a manual nalog is updated, a document nalog (invoice, purchase, payroll …)
 * gets a line correction (`journal_overrides`) and a statement nalog changes the statement line and re-posts the statement.
 */
import { needsPartner } from './ledger';

const r2 = (x: number) => Math.round(x * 100) / 100;
const dmy = (d: string) => d.split('-').reverse().join('.');

/** One journal line with its nalog header, as the screen and the batch see it. */
export interface RcLine {
  id: number;
  journalId: string;
  lineNo: number;
  date: string;
  kind: string;
  number: string;
  /** Nalog description. */
  jdesc: string | null;
  sourceType: string | null;
  /** The nalog itself is locked (`journals.locked`). */
  jlocked: boolean;
  account: string;
  partnerId: string | null;
  debit: number;
  credit: number;
  note: string | null;
  doc: string | null;
  locationId: string | null;
}

export interface RcFilter {
  from?: string; to?: string;
  /** One konto (prefix: „4“ = class 4, „1200“ = 1200 and its analytics) or a range with `kontoTo`. */
  kontoFrom?: string; kontoTo?: string;
  partnerId?: string;
  /** Nalog kind (`manual`, `bank`, `izlez`, …). */
  kind?: string;
  /** Nalog number (exact, or the start of it). */
  number?: string;
  /** Text in the nalog description, the line note or the document reference. */
  text?: string;
  /** Amount (debit or credit) range, absolute value. */
  amtMin?: number | null; amtMax?: number | null;
  /** Cost centre / location (`journal_lines.location_id`). */
  locationId?: string;
}

/** Konto inside `from` (prefix) or the range `from` – `to` (both inclusive, the analytics of `to` too). */
export function rcKontoMatch(account: string, from?: string, to?: string): boolean {
  const a = String(account), f = (from ?? '').trim(), t = (to ?? '').trim();
  if (!f && !t) return true;
  if (f && !t) return a.startsWith(f);
  if (!f) return a <= t || a.startsWith(t);
  return (a >= f || a.startsWith(f)) && (a <= t || a.startsWith(t));
}

const low = (s: string | null | undefined) => (s ?? '').toLocaleLowerCase('mk-MK');

/** The lines that match the filter (all fields optional). */
export function rcFilter<L extends RcLine>(lines: readonly L[], f: RcFilter): L[] {
  const txt = low(f.text).trim();
  const num = (f.number ?? '').trim();
  return lines.filter((l) => {
    if (f.from && l.date < f.from) return false;
    if (f.to && l.date > f.to) return false;
    if (!rcKontoMatch(l.account, f.kontoFrom, f.kontoTo)) return false;
    if (f.partnerId && (f.partnerId === '-' ? l.partnerId : l.partnerId !== f.partnerId)) return false;
    if (f.kind && l.kind !== f.kind) return false;
    if (num && l.number !== num && !l.number.startsWith(num)) return false;
    if (txt && !low(l.jdesc).includes(txt) && !low(l.note).includes(txt) && !low(l.doc).includes(txt)) return false;
    const amt = Math.abs(l.debit || l.credit);
    if (f.amtMin != null && amt < f.amtMin - 0.004) return false;
    if (f.amtMax != null && amt > f.amtMax + 0.004) return false;
    if (f.locationId && l.locationId !== f.locationId) return false;
    return true;
  });
}

/**
 * How the nalog of a line is re-posted: `manual` = the nalog is edited directly; `doc` = a correction of a document
 * nalog (re-applied every time the document is posted again); `bank` = the statement line is changed and the
 * statement re-posted; `close` = never (closing nalog of the year).
 */
export type RcPath = 'manual' | 'doc' | 'bank' | 'close';

export const BANK_SOURCE = 'bank_statement';

export function rcPath(kind: string, sourceType: string | null): RcPath {
  if (kind === 'close') return 'close';
  if (sourceType === BANK_SOURCE) return 'bank';
  if (!sourceType || ['manual', 'open', 'bbimp'].includes(kind)) return 'manual';
  return 'doc';
}

/** What to change: `account` and / or `partnerId` (`null` = remove the partner); `undefined` = keep. */
export interface RcChange { account?: string; partnerId?: string | null }

/** The new konto / partner of one line under the change. */
export const rcNew = (l: Pick<RcLine, 'account' | 'partnerId'>, c: RcChange) => ({
  account: c.account?.trim() ? c.account.trim() : l.account,
  partnerId: c.partnerId !== undefined ? c.partnerId : l.partnerId,
});

export interface RcCtx {
  /** Firm lock date (`firms.lock_date`): lines on or before it are not changed. */
  lockDate?: string | null;
  /** Kontos of the chart (to refuse a konto that does not exist); omitted = not checked here. */
  kontos?: ReadonlySet<string>;
}

export type RcCheck = { ok: true; path: RcPath; account: string; partnerId: string | null } | { ok: false; reason: string; path: RcPath };

/** May this line get the new konto / partner? The reason is shown next to the line. */
export function rcCheck(l: RcLine, c: RcChange, ctx: RcCtx = {}): RcCheck {
  const path = rcPath(l.kind, l.sourceType);
  const n = rcNew(l, c);
  if (path === 'close') return { ok: false, path, reason: 'Налог за затворање на годината – не се рекнижува.' };
  if (ctx.lockDate && l.date <= ctx.lockDate) return { ok: false, path, reason: `Заклучен период (до ${dmy(ctx.lockDate)}).` };
  if (l.jlocked) return { ok: false, path, reason: `Налогот ${l.number} е заклучен.` };
  if (n.account === l.account && (n.partnerId ?? null) === (l.partnerId ?? null)) return { ok: false, path, reason: 'Без промена (веќе е така).' };
  if (!/^\d{1,10}$/.test(n.account)) return { ok: false, path, reason: `Неважечко конто „${n.account}“.` };
  if (ctx.kontos && !ctx.kontos.has(n.account)) return { ok: false, path, reason: `Контото ${n.account} не постои во контниот план.` };
  if (path === 'doc' && (n.partnerId ?? null) !== (l.partnerId ?? null)) {
    return { ok: false, path, reason: 'Ставка од документ (фактура, плата …) – комитентот се менува во самиот документ.' };
  }
  if (needsPartner(n.account) && !n.partnerId) return { ok: false, path, reason: `Конто ${n.account} бара комитент – изберете и комитент.` };
  return { ok: true, path, ...n };
}

/** One changed line of a batch (stored in the audit row; the undo swaps `old` / `new`). */
export interface RcItem {
  path: Exclude<RcPath, 'close'>;
  journalId: string;
  number: string;
  date: string;
  lineNo: number;
  debit: number;
  credit: number;
  old: { account: string; partnerId: string | null };
  new: { account: string; partnerId: string | null };
  /** Statement line (path `bank`). */
  bankLineId?: string;
  /** Journal line id at the time of the run (changes when the nalog is re-posted; only for the preview). */
  lineId?: number;
}

/** The undo of a batch: every item back from `new` to `old`. */
export const rcUndoItems = (items: readonly RcItem[]): RcItem[] => items.map((i) => ({ ...i, old: i.new, new: i.old }));

export interface RcPreviewRow { line: RcLine; check: RcCheck }
export interface RcKontoTotal { konto: string; debitBefore: number; creditBefore: number; debitAfter: number; creditAfter: number; diff: number }

/**
 * Preview of a change on the chosen lines: per line old → new (or the reason it is skipped) and, per konto, the
 * debit / credit of the chosen lines before and after (only the lines that will change move).
 */
/** Debit / credit per konto before and after (`to` = the new konto of a line that changes, null = unchanged). */
export function rcTotals(rows: readonly { account: string; to: string | null; debit: number; credit: number }[]): RcKontoTotal[] {
  const T = new Map<string, RcKontoTotal>();
  const t = (k: string) => T.get(k) ?? T.set(k, { konto: k, debitBefore: 0, creditBefore: 0, debitAfter: 0, creditAfter: 0, diff: 0 }).get(k)!;
  for (const r of rows) {
    const b = t(r.account);
    b.debitBefore += r.debit; b.creditBefore += r.credit;
    const a = t(r.to ?? r.account);
    a.debitAfter += r.debit; a.creditAfter += r.credit;
  }
  return [...T.values()].map((x) => {
    const y = { ...x, debitBefore: r2(x.debitBefore), creditBefore: r2(x.creditBefore), debitAfter: r2(x.debitAfter), creditAfter: r2(x.creditAfter) };
    return { ...y, diff: r2((y.debitAfter - y.creditAfter) - (y.debitBefore - y.creditBefore)) };
  }).sort((a, b) => a.konto.localeCompare(b.konto));
}

export function rcPreview(lines: readonly RcLine[], c: RcChange, ctx: RcCtx = {}): {
  rows: RcPreviewRow[]; ok: number; blocked: number; totals: RcKontoTotal[]; debit: number; credit: number;
} {
  const rows = lines.map((line) => ({ line, check: rcCheck(line, c, ctx) }));
  const totals = rcTotals(rows.map(({ line, check }) => ({ account: line.account, to: check.ok ? check.account : null, debit: line.debit, credit: line.credit })));
  const ok = rows.filter((r) => r.check.ok).length;
  return {
    rows, ok, blocked: rows.length - ok, totals,
    debit: r2(lines.reduce((s, l) => s + l.debit, 0)), credit: r2(lines.reduce((s, l) => s + l.credit, 0)),
  };
}

/** Sum of debit / credit of lines (the total under the filter). */
export const rcSum = (lines: readonly Pick<RcLine, 'debit' | 'credit'>[]) => ({
  n: lines.length, debit: r2(lines.reduce((s, l) => s + l.debit, 0)), credit: r2(lines.reduce((s, l) => s + l.credit, 0)),
});

/**
 * The current line that an item points to (for the undo, and for a nalog re-posted since the preview): same konto,
 * partner and amounts as the item's `old`, preferring its own line number. Null when the line was changed or removed.
 */
export function rcFind<L extends Pick<RcLine, 'lineNo' | 'account' | 'partnerId' | 'debit' | 'credit'>>(lines: readonly L[], it: Pick<RcItem, 'lineNo' | 'debit' | 'credit' | 'old'>, taken: ReadonlySet<L> = new Set()): L | null {
  const fit = lines.filter((l) => !taken.has(l) && l.account === it.old.account && (l.partnerId ?? null) === (it.old.partnerId ?? null)
    && Math.round(l.debit * 100) === Math.round(it.debit * 100) && Math.round(l.credit * 100) === Math.round(it.credit * 100));
  if (!fit.length) return null;
  return fit.reduce((b, l) => (Math.abs(l.lineNo - it.lineNo) < Math.abs(b.lineNo - it.lineNo) ? l : b));
}

/** Short text of a batch for the history list. */
export function rcLabel(c: RcChange, konto: (k: string) => string = (k) => k, partner: (id: string | null) => string = (id) => id ?? '—'): string {
  const p: string[] = [];
  if (c.account?.trim()) p.push('конто → ' + konto(c.account.trim()));
  if (c.partnerId !== undefined) p.push('комитент → ' + (c.partnerId ? partner(c.partnerId) : 'без комитент'));
  return p.join(', ') || '—';
}
