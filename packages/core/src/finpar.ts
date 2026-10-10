/**
 * Finance parity helpers (pure, unit-tested) added by the 2026-10 legacy-parity pass.
 *
 * Manual corrections of document journals (legacy `nalSaveRows` 3580 + `nalRows` 3540): a nalog created from a
 * document (invoice, statement, …) can be corrected line by line. Legacy kept the corrections on the document
 * (`ed` = per-line edits keyed by the generated line index with the original konto/amounts `k0`/`d0`/`p0`,
 * `edAdd` = added lines) and re-applied them every time the document was re-posted; an edit whose original line
 * changed (the document itself was edited) is dropped („ако самиот документ се измени, корекцијата на тој ред
 * се поништува“).
 */
import { r2 } from './money';

export interface OvLine {
  account: string;
  debit?: number | string | null;
  credit?: number | string | null;
  partnerId?: string | null;
  note?: string | null;
  doc?: string | null;
  currency?: string | null;
  amountCur?: number | string | null;
  locationId?: string | null;
}

/** One edit of a generated line. `k0`/`d0`/`p0` = the generated values the edit was made against. */
export interface OvEdit {
  i: number; k0: string; d0: number; p0: number;
  account?: string; debit?: number; credit?: number; partnerId?: string | null; note?: string | null; doc?: string | null;
  /** The line is removed from the nalog. */
  del?: boolean;
}
export interface OvAdd { account: string; debit: number; credit: number; partnerId?: string | null; note?: string | null; doc?: string | null }
export interface JournalOverride { edits: OvEdit[]; adds: OvAdd[] }

const n = (v: unknown) => r2(Number(v ?? 0) || 0);

/** Generated lines in the indexable form the editor and the override keys use (zero lines dropped, like posting). */
export const ovBase = <L extends OvLine>(lines: readonly L[]): L[] => lines.filter((l) => n(l.debit) || n(l.credit));

/**
 * Apply an override to the generated lines. Edits whose original no longer matches are dropped.
 * Returns the resulting lines, how many edits applied / dropped and whether anything changed.
 */
export function applyOverride<L extends OvLine>(lines: readonly L[], ov: JournalOverride | null | undefined): { lines: OvLine[]; applied: number; dropped: number; changed: boolean } {
  const base = ovBase(lines);
  if (!ov || (!ov.edits?.length && !ov.adds?.length)) return { lines: base, applied: 0, dropped: 0, changed: false };
  let applied = 0, dropped = 0;
  const out: OvLine[] = [];
  base.forEach((l, i) => {
    const e = ov.edits.find((x) => x.i === i);
    if (!e) { out.push(l); return; }
    if (String(e.k0) !== String(l.account) || n(e.d0) !== n(l.debit) || n(e.p0) !== n(l.credit)) { dropped++; out.push(l); return; }
    applied++;
    if (e.del) return;
    out.push({
      ...l,
      account: e.account ?? l.account,
      debit: e.debit != null ? n(e.debit) : l.debit,
      credit: e.credit != null ? n(e.credit) : l.credit,
      partnerId: e.partnerId !== undefined ? e.partnerId : l.partnerId,
      note: e.note !== undefined ? e.note : l.note,
      doc: e.doc !== undefined ? e.doc : l.doc,
    });
  });
  for (const a of ov.adds ?? []) { if (n(a.debit) || n(a.credit)) { out.push({ ...a, debit: n(a.debit), credit: n(a.credit) }); applied++; } }
  dropped += (ov.edits ?? []).filter((e) => e.i >= base.length).length;
  return { lines: out, applied, dropped, changed: applied > 0 };
}

/** Editor row (one generated line with its edit, or an added line with `i = null`). */
export interface OvRow { i: number | null; account: string; debit: number; credit: number; partnerId: string | null; note: string; doc: string; del: boolean }

/** Build the override from the generated lines and the edited rows (rows with `i` refer to `base[i]`). */
export function diffOverride(base: readonly OvLine[], rows: readonly OvRow[]): JournalOverride {
  const edits: OvEdit[] = [];
  const adds: OvAdd[] = [];
  for (const r of rows) {
    if (r.i == null) { if (!r.del && (n(r.debit) || n(r.credit))) adds.push({ account: r.account.trim(), debit: n(r.debit), credit: n(r.credit), partnerId: r.partnerId || null, note: r.note || null, doc: r.doc || null }); continue; }
    const b = base[r.i];
    if (!b) continue;
    const e: OvEdit = { i: r.i, k0: String(b.account), d0: n(b.debit), p0: n(b.credit) };
    let ch = false;
    if (r.del) { e.del = true; ch = true; } else {
      if (r.account.trim() !== String(b.account)) { e.account = r.account.trim(); ch = true; }
      if (n(r.debit) !== n(b.debit)) { e.debit = n(r.debit); ch = true; }
      if (n(r.credit) !== n(b.credit)) { e.credit = n(r.credit); ch = true; }
      if ((r.partnerId || null) !== (b.partnerId || null)) { e.partnerId = r.partnerId || null; ch = true; }
      if ((r.note || '') !== (b.note || '')) { e.note = r.note || null; ch = true; }
      if ((r.doc || '') !== (b.doc || '')) { e.doc = r.doc || null; ch = true; }
    }
    if (ch) edits.push(e);
  }
  return { edits, adds };
}

/** Editor rows for the generated lines with the current override applied (dropped edits are ignored). */
export function overrideRows(base: readonly OvLine[], ov: JournalOverride | null | undefined): OvRow[] {
  const rows: OvRow[] = base.map((b, i) => {
    const e = ov?.edits.find((x) => x.i === i && String(x.k0) === String(b.account) && n(x.d0) === n(b.debit) && n(x.p0) === n(b.credit));
    return {
      i, account: e?.account ?? String(b.account), debit: e?.debit ?? n(b.debit), credit: e?.credit ?? n(b.credit),
      partnerId: (e && e.partnerId !== undefined ? e.partnerId : b.partnerId) ?? null,
      note: (e && e.note !== undefined ? e.note : b.note) ?? '', doc: (e && e.doc !== undefined ? e.doc : b.doc) ?? '', del: !!e?.del,
    };
  });
  for (const a of ov?.adds ?? []) rows.push({ i: null, account: a.account, debit: n(a.debit), credit: n(a.credit), partnerId: a.partnerId ?? null, note: a.note ?? '', doc: a.doc ?? '', del: false });
  return rows;
}

export const overrideEmpty = (ov: JournalOverride | null | undefined) => !ov || (!ov.edits.length && !ov.adds.length);
