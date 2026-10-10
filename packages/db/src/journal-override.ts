/**
 * Manual line corrections of document journals (legacy `ed` / `edAdd` on the source document, `nalSaveRows` 3580).
 * `applyJournalOverride` is called by the posting service for every posting of a source document: the stored
 * generated lines (`base`) are refreshed and the edits re-applied. Edits whose original line changed are dropped
 * (legacy: „ако самиот документ се измени, корекцијата на тој ред се поништува“); if the corrected nalog would not
 * balance any more, the document's own lines are posted and the journal is marked `overrideDropped`.
 */
import { and, eq, sql } from 'drizzle-orm';
import { applyOverride, ovBase, type JournalOverride } from '@wise/core/finpar';
import { lineTotals } from '@wise/core';
import type { Tx } from './audit';
import type { PostJournalInput, PostLineInput } from './posting';
import { journalOverrides, type JournalOverrideBase } from './schema/index';

const NO_OVERRIDE_KINDS = new Set(['manual', 'open', 'bbimp', 'close']);
const num = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;

export const toOverrideBase = (lines: readonly PostLineInput[]): JournalOverrideBase[] => ovBase(lines).map((l) => ({
  account: String(l.account ?? '').trim(), debit: num(l.debit), credit: num(l.credit), partnerId: l.partnerId ?? null,
  note: l.note ?? null, doc: l.doc ?? null, currency: l.currency ?? null,
  amountCur: l.amountCur == null || l.amountCur === '' ? null : num(l.amountCur), locationId: l.locationId ?? null,
}));

let tableReady = false;
/**
 * The table comes with the coordinator's next migration; until it exists (older database, tests on the committed
 * migrations) postings work as before. Checked with `to_regclass` so a missing table never aborts the transaction.
 */
export async function journalOverridesReady(tx: Tx): Promise<boolean> {
  if (tableReady) return true;
  const r = await tx.execute(sql`select to_regclass('journal_overrides') is not null as ok`);
  const row = ((r as unknown as { rows?: { ok: boolean }[] }).rows ?? (r as unknown as { ok: boolean }[]))[0];
  tableReady = !!row?.ok;
  return tableReady;
}

export async function applyJournalOverride(tx: Tx, firmId: string, input: PostJournalInput): Promise<PostJournalInput> {
  if (!input.sourceType || !input.sourceId || NO_OVERRIDE_KINDS.has(input.kind)) return input;
  if (!(await journalOverridesReady(tx))) return input;
  const [ov] = await tx.select().from(journalOverrides).where(and(
    eq(journalOverrides.firmId, firmId), eq(journalOverrides.sourceType, input.sourceType), eq(journalOverrides.sourceId, input.sourceId),
  )).limit(1);
  if (!ov) return input;
  const base = toOverrideBase(input.lines);
  await tx.update(journalOverrides).set({ base }).where(eq(journalOverrides.id, ov.id));
  const r = applyOverride(base, ov.data as JournalOverride);
  if (!r.changed) return { ...input, meta: { ...(input.meta ?? {}), override: { applied: 0, dropped: r.dropped } } };
  const t = lineTotals(r.lines.map((l) => ({ debit: num(l.debit), credit: num(l.credit) })));
  if (!t.balanced) return { ...input, meta: { ...(input.meta ?? {}), override: { applied: 0, dropped: r.applied + r.dropped, unbalanced: true } } };
  return { ...input, lines: r.lines as PostLineInput[], meta: { ...(input.meta ?? {}), override: { applied: r.applied, dropped: r.dropped } } };
}
