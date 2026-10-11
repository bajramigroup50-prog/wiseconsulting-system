/**
 * Production from a sales invoice („Производство = Да“ → „Репроматеријали за производство“; new, not in legacy, where
 * only a free „Трошоци за производство“ field existed). The sale is processed in two moments: (1) production — the
 * raw materials are issued and the finished product is received at the materials cost (+ extra costs), (2) the
 * invoice issues the product as usual.
 *
 * Pure helpers: the material proposal from the normativ (BOM × line quantity), the material rows with stock on hand,
 * average cost and shortage, the per-unit BOM of a production order and the split of the extra costs.
 */

export interface ProdBom { lines: readonly { itemId: string; qty: number | string }[]; labor?: number | string | null }
export interface ProdMaterial { itemId: string; qty: number }
export interface ProdLine { lineNo: number; productId: string; qty: number; materials: ProdMaterial[]; fromBom: boolean }

const num = (v: unknown) => Number(v) || 0;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/**
 * Proposal for the invoice lines that are produced: products (or items the user marked) get their BOM × line quantity;
 * a line without a BOM gets an empty list (the user picks the materials).
 */
export function proposeMaterials(
  lines: readonly { itemId?: string | null; qty: number | string; type?: string | null; produced?: boolean }[],
  boms: Readonly<Record<string, ProdBom | undefined>>,
): ProdLine[] {
  const out: ProdLine[] = [];
  lines.forEach((l, i) => {
    if (!l.itemId || !(num(l.qty) > 0)) return;
    if (l.type !== 'product' && !l.produced) return;
    const b = boms[l.itemId];
    const materials = (b?.lines ?? []).filter((x) => x.itemId && num(x.qty) > 0).map((x) => ({ itemId: x.itemId, qty: r4(num(x.qty) * num(l.qty)) }));
    out.push({ lineNo: i, productId: l.itemId, qty: r4(num(l.qty)), materials, fromBom: !!b && materials.length > 0 });
  });
  return out;
}

export interface MaterialRow extends ProdMaterial { have: number; avg: number; value: number; short: boolean }

/** Material rows with stock on hand and average cost at the materials warehouse; `short` when the stock is not enough (several rows of one item add up). */
export function materialRows(materials: readonly ProdMaterial[], stockOf: (itemId: string) => { qty: number; avg: number }): { rows: MaterialRow[]; value: number } {
  const need = new Map<string, number>();
  for (const m of materials) need.set(m.itemId, r4((need.get(m.itemId) ?? 0) + num(m.qty)));
  const rows = materials.map((m) => {
    const s = stockOf(m.itemId);
    const q = num(m.qty);
    return { itemId: m.itemId, qty: q, have: s.qty, avg: s.avg, value: r2(q * s.avg), short: (need.get(m.itemId) ?? 0) > s.qty + 1e-9 };
  });
  return { rows, value: r2(rows.reduce((a, r) => a + r.value, 0)) };
}

/** The per-unit BOM of a production order from the total materials (production order runs `qty` units). */
export function perUnitBom(materials: readonly ProdMaterial[], qty: number): { item: string; qty: number }[] {
  const q = num(qty);
  if (!(q > 0)) return [];
  const by = new Map<string, number>();
  for (const m of materials) if (m.itemId && num(m.qty) > 0) by.set(m.itemId, (by.get(m.itemId) ?? 0) + num(m.qty));
  return [...by].map(([item, t]) => ({ item, qty: t / q }));
}

/** Split the extra production costs over the produced lines in proportion to their materials value (rounding on the last). */
export function splitExtra(extra: number, values: readonly number[]): number[] {
  const e = r2(num(extra));
  const tot = values.reduce((a, v) => a + num(v), 0);
  if (!e || !values.length) return values.map(() => 0);
  const out = values.map((v) => (tot ? r2((e * num(v)) / tot) : r2(e / values.length)));
  out[out.length - 1] = r2(e - out.slice(0, -1).reduce((a, v) => a + v, 0));
  return out;
}

/** Quick entry „шифра количина“ (like the production screen): `code qty` → item id + qty, or null. */
export function parseQuickMaterial(s: string, find: (code: string) => { id: string } | null | undefined): ProdMaterial | null {
  const m = s.trim().match(/^(\S+)(?:\s+([\d.,]+))?$/);
  if (!m) return null;
  const it = find(m[1]!);
  if (!it) return null;
  const q = m[2] ? Number(m[2].replace(',', '.')) : 1;
  return q > 0 ? { itemId: it.id, qty: r4(q) } : null;
}
