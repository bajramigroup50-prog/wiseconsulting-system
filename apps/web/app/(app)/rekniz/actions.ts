'use server';
/**
 * „🔁 Рекнижење во маса“: preview (dry run, rolled back), apply as one batch, undo a batch. Office owner / senior
 * accountant only (`reclass` / `reclassUndo` → permission `close`).
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { rcTotals, type RcChange, type RcKontoTotal } from '@wise/core/reclass';
import { reclassApply, reclassLines, reclassUndo, ReclassError } from '@wise/db';
import { firmAction, actionError, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';

const Ids = z.array(z.number().int().positive()).min(1).max(5000);
const Change = z.object({
  account: z.string().trim().regex(/^\d{1,10}$/).optional(),
  partnerId: z.string().uuid().nullable().optional(),
}).refine((c) => c.account || c.partnerId !== undefined, 'Изберете ново конто и / или нов комитент.');

export interface RcPreviewRow {
  id: number; date: string; number: string; account: string; partnerId: string | null; debit: number; credit: number;
  to: { account: string; partnerId: string | null } | null; reason: string | null; path: string | null;
}
export interface RcPreviewState { error?: string; rows?: RcPreviewRow[]; totals?: RcKontoTotal[]; ok?: number; blocked?: number; journals?: number }

const P = ['/rekniz', '/nalozi', '/bilanc', '/kartici', '/banka'];

function parse(ids: unknown, change: unknown): { ids: number[]; change: RcChange } | { error: string } {
  const a = Ids.safeParse(ids), c = Change.safeParse(change);
  if (!a.success) return { error: 'Не се избрани ставки.' };
  if (!c.success) return { error: c.error.issues[0]?.message ?? 'Неважечка промена.' };
  return { ids: a.data, change: c.data };
}

const reErr = (e: unknown): { error: string } => (e instanceof ReclassError ? { error: e.message } : actionError(e) as { error: string });

/** „👁 Преглед“: every chosen line with old → new or the reason it is skipped, and the totals per konto before / after. */
export async function previewAction(ids: number[], change: RcChange): Promise<RcPreviewState> {
  const x = parse(ids, change);
  if ('error' in x) return x;
  try {
    const { u, firm } = await firmAction('reclass');
    return await db().transaction(async (tx) => {
      const L = await reclassLines(tx, firm.id, { ids: x.ids });
      const R = await reclassApply(tx, { firmId: firm.id, userId: u.id, lineIds: x.ids, change: x.change, dryRun: true });
      const done = new Map(R.items.filter((i) => i.lineId != null).map((i) => [i.lineId!, i]));
      const why = new Map(R.blocked.filter((b) => b.lineId != null).map((b) => [b.lineId!, b.reason]));
      const rows: RcPreviewRow[] = L.map((l) => {
        const it = done.get(l.id);
        return { id: l.id, date: l.date, number: l.number, account: l.account, partnerId: l.partnerId, debit: l.debit, credit: l.credit,
          to: it ? it.new : null, reason: it ? null : why.get(l.id) ?? 'Не може да се рекнижи.', path: it?.path ?? null };
      });
      return {
        rows, ok: R.items.length, blocked: rows.length - R.items.length, journals: R.journals,
        totals: rcTotals(rows.map((r) => ({ account: r.account, to: r.to?.account ?? null, debit: r.debit, credit: r.credit }))),
      };
    });
  } catch (e) { return reErr(e); }
}

/** „✔ Потврди“: apply as one batch (one audit row, one „Врати“). */
export async function applyAction(ids: number[], change: RcChange): Promise<ActionState & { batchId?: string }> {
  const x = parse(ids, change);
  if ('error' in x) return x;
  try {
    const { u, firm } = await firmAction('reclass');
    const R = await db().transaction((tx) => reclassApply(tx, { firmId: firm.id, userId: u.id, lineIds: x.ids, change: x.change }));
    P.forEach((p) => revalidatePath(p));
    if (!R.items.length) return { error: 'Ништо не е рекнижено' + (R.blocked[0] ? ': ' + R.blocked[0].reason : '.') };
    const sum = R.items.reduce((s, i) => s + i.debit + i.credit, 0);
    return { ok: `Рекнижени ${R.items.length} ставки во ${R.journals} налози (${fmt(sum)}).${R.blocked.length ? ` Прескокнати ${R.blocked.length}.` : ''} Со „↶ Врати“ подолу се враќа целото рекнижење.`, batchId: R.batchId ?? undefined };
  } catch (e) { return reErr(e); }
}

/** „↶ Врати“: the whole batch back. */
export async function undoAction(batchId: string): Promise<ActionState> {
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) return { error: 'Неважечко рекнижење.' };
  try {
    const { u, firm } = await firmAction('reclassUndo');
    const R = await db().transaction((tx) => reclassUndo(tx, { firmId: firm.id, userId: u.id, batchId }));
    P.forEach((p) => revalidatePath(p));
    return { ok: `Вратени ${R.restored.length} ставки.` + (R.skipped.length ? ` Не се вратени ${R.skipped.length}: ${[...new Set(R.skipped.map((s) => s.reason))].join(' ')}` : '') };
  } catch (e) { return reErr(e); }
}
