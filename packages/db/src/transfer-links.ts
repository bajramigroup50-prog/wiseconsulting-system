/**
 * Transfer ↔ source calculation links. A transfer created from one or more warehouse calculations („→ Продавница“,
 * „📦 Пренос во продавница“, `/prenosi?calc=`) stores their purchase ids in `transfers.source_purchase_ids`. Older
 * transfers carry only the note „Од калкулација <calcNo>, <calcNo>“: the link is inferred at read time (calculation
 * number + firm + year of the transfer + the transfer's source location).
 *
 * Used by: purchase delete (dependent transfers are listed, then deleted in the same transaction), the transfer delete
 * guard (no delete in a locked period or when later moves in the destination already consumed the goods), and the
 * orphan check of the transfers list („⚠ изворната калкулација е избришана“).
 */
import { and, asc, eq, inArray, isNotNull, isNull, like, or, sql } from 'drizzle-orm';
import type { Tx } from './audit';
import { assertOpenPeriod } from './posting';
import { codes, firms, items, purchases, stockMoves, transfers, type TransferRow } from './schema/index';
import { DocumentError } from './sales/context';

const NOTE = /Од калкулација\s+([^\n]+)/i;
const EPS = 0.0001;
const dmy = (d: string) => d.split('-').reverse().join('.');

/** Calculation numbers referenced by a transfer note („Од калкулација 0001 01, 0002 01“). */
export function noteCalcNos(note: string | null | undefined): string[] {
  const m = NOTE.exec(note ?? '');
  if (!m) return [];
  return [...new Set(m[1]!.split(',').map((x) => x.trim()).filter(Boolean))];
}

export interface TransferSource {
  /** Existing source purchases. */
  ids: string[];
  /** Referenced sources that no longer exist (purchase ids, or calculation numbers when inferred from the note). */
  missing: string[];
  /** The link comes from the note, not from `source_purchase_ids`. */
  inferred: boolean;
}

type TRow = Pick<TransferRow, 'id' | 'date' | 'note' | 'fromLocationId' | 'sourcePurchaseIds'>;

/** Source calculations of the given transfers (explicit ids, else inferred from the note). Transfers without any link are left out. */
export async function transferSources(tx: Tx, firmId: string, rows: readonly TRow[]): Promise<Map<string, TransferSource>> {
  const out = new Map<string, TransferSource>();
  const explicit = rows.filter((r) => Array.isArray(r.sourcePurchaseIds) && r.sourcePurchaseIds.length);
  const inferred = rows.filter((r) => !(Array.isArray(r.sourcePurchaseIds) && r.sourcePurchaseIds.length) && noteCalcNos(r.note).length);
  const ids = [...new Set(explicit.flatMap((r) => r.sourcePurchaseIds!))].filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const have = new Set(ids.length ? (await tx.select({ id: purchases.id }).from(purchases).where(and(eq(purchases.firmId, firmId), inArray(purchases.id, ids)))).map((p) => p.id) : []);
  for (const r of explicit) {
    const L = [...new Set(r.sourcePurchaseIds!)];
    out.set(r.id, { ids: L.filter((x) => have.has(x)), missing: L.filter((x) => !have.has(x)), inferred: false });
  }
  if (inferred.length) {
    const nos = [...new Set(inferred.flatMap((r) => noteCalcNos(r.note)))];
    const P = await tx.select({ id: purchases.id, calcNo: purchases.calcNo, date: purchases.date, wh: purchases.warehouseId }).from(purchases)
      .where(and(eq(purchases.firmId, firmId), eq(purchases.ptype, 'stock'), inArray(purchases.calcNo, nos)));
    for (const r of inferred) {
      const y = r.date.slice(0, 4);
      const found: string[] = [];
      const missing: string[] = [];
      for (const no of noteCalcNos(r.note)) {
        const m = P.filter((p) => p.calcNo === no && p.date.slice(0, 4) === y && (p.wh ?? null) === (r.fromLocationId ?? null));
        if (m.length) found.push(...m.map((p) => p.id)); else missing.push(no);
      }
      out.set(r.id, { ids: [...new Set(found)], missing, inferred: true });
    }
  }
  return out;
}

export interface DependentTransfer {
  id: string; number: string; date: string; from: string; to: string; lines: number;
  /** Source purchases of the transfer (all of them, not only the ones being deleted). */
  sourceIds: string[];
}

/** Display name of a location (`null` = the main warehouse). */
async function locNames(tx: Tx, ids: readonly (string | null)[]): Promise<(id: string | null) => string> {
  const L = [...new Set(ids.filter((x): x is string => !!x))];
  const M = new Map(L.length ? (await tx.select({ id: codes.id, name: codes.name }).from(codes).where(inArray(codes.id, L))).map((c) => [c.id, c.name]) : []);
  return (id) => (id ? M.get(id) ?? '?' : 'Главен магацин');
}

/** Transfers created from any of the given purchases (calculations). */
export async function dependentTransfers(tx: Tx, firmId: string, purchaseIds: readonly string[]): Promise<DependentTransfer[]> {
  if (!purchaseIds.length) return [];
  const T = await tx.select().from(transfers)
    .where(and(eq(transfers.firmId, firmId), or(isNotNull(transfers.sourcePurchaseIds), like(transfers.note, '%Од калкулација%'))))
    .orderBy(asc(transfers.date), asc(transfers.number));
  if (!T.length) return [];
  const S = await transferSources(tx, firmId, T);
  const want = new Set(purchaseIds);
  const D = T.filter((t) => S.get(t.id)?.ids.some((x) => want.has(x)) || (t.sourcePurchaseIds ?? []).some((x) => want.has(x)));
  const nm = await locNames(tx, D.flatMap((t) => [t.fromLocationId, t.toLocationId]));
  return D.map((t) => ({
    id: t.id, number: t.number, date: t.date, from: nm(t.fromLocationId), to: nm(t.toLocationId), lines: t.lines.length,
    sourceIds: S.get(t.id)?.ids ?? [],
  }));
}

/** „Преносница 0001/2026 Главен магацин → GOSTIVAR (66 ставки)“ */
export const dependentLabel = (d: Pick<DependentTransfer, 'number' | 'from' | 'to' | 'lines'>): string =>
  `Преносница ${d.number} ${d.from} → ${d.to} (${d.lines} ${d.lines === 1 ? 'ставка' : 'ставки'})`;

/**
 * Throws when the transfer cannot be deleted without damage: its date is in a locked period, or later moves in the
 * destination (sales, invoices, further transfers, write-offs …) already consumed the goods it brought in — deleting
 * it would leave negative stock there. `alsoRemoved` = other transfers deleted in the same operation.
 */
export async function assertTransferRemovable(tx: Tx, firmId: string, row: TransferRow, alsoRemoved: readonly string[] = []): Promise<void> {
  const [f] = await tx.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!f) throw new DocumentError('Фирмата не постои.');
  try { assertOpenPeriod(f, row.date); } catch {
    throw new DocumentError(`Преносницата ${row.number} од ${dmy(row.date)} е во заклучен период (до ${dmy(f.lockDate ?? '')}) и не може да се брише. Отклучете го периодот или направете повратна преносница со денешен датум.`);
  }
  const itemIds = [...new Set(row.lines.map((l) => l.itemId))];
  if (!itemIds.length) return;
  const excl = [...new Set([row.id, ...alsoRemoved])];
  const R = await tx.select({ item: stockMoves.itemId, date: stockMoves.date, q: sql<string>`sum(${stockMoves.qty})` }).from(stockMoves)
    .where(and(
      eq(stockMoves.firmId, firmId), inArray(stockMoves.itemId, itemIds), eq(stockMoves.pending, false),
      row.toLocationId ? eq(stockMoves.locationId, row.toLocationId) : isNull(stockMoves.locationId),
      sql`not (${stockMoves.sourceType} = 'transfer' and ${inArray(stockMoves.sourceId, excl)})`,
    ))
    .groupBy(stockMoves.itemId, stockMoves.date)
    .orderBy(asc(stockMoves.itemId), asc(stockMoves.date));
  const bal = new Map<string, number>();
  const short = new Map<string, number>();
  for (const r of R) {
    const b = (bal.get(r.item) ?? 0) + Number(r.q);
    bal.set(r.item, b);
    if (r.date >= row.date && b < -EPS) short.set(r.item, Math.min(short.get(r.item) ?? 0, b));
  }
  if (!short.size) return;
  const I = await tx.select({ id: items.id, name: items.name }).from(items).where(inArray(items.id, [...short.keys()]));
  const nm = new Map(I.map((i) => [i.id, i.name]));
  const loc = (await locNames(tx, [row.toLocationId]))(row.toLocationId);
  const fq = (x: number) => String(Math.round(x * 10000) / 10000).replace('.', ',');
  const L = [...short.entries()].map(([id, b]) => `${nm.get(id) ?? id} (недостасуваат ${fq(-b)})`);
  throw new DocumentError(
    `Преносницата ${row.number} не може да се избрише: стоката е веќе продадена/издадена во ${loc} – ${short.size} артикли би имале негативна залиха: `
    + `${L.slice(0, 3).join('; ')}${L.length > 3 ? ' …' : ''}. Прво сторнирајте ги продажбите/излезите во ${loc} (или направете повратна преносница), па бришете.`,
  );
}
