/**
 * BOM suggestion read with `BOM_PROMPT` → normativ lines (legacy ACT `bomAI` 13860): materials matched by exact
 * name, then case-insensitively; quantities rounded to 4 decimals; lines without a match or a positive quantity
 * are dropped. The materials offered are the firm's active `material` / `goods` items other than the product.
 */
export interface BomMaterial { id: string; name: string; unit?: string | null; type?: string | null; active?: boolean | null }
export interface BomSuggestion { lines: { itemId: string; qty: number }[]; missing: { name: string; unit: string; qty: number }[]; note: string }

/** Legacy `M`: the materials a BOM may use. */
export const bomMaterials = <T extends BomMaterial>(items: readonly T[], productId: string): T[] =>
  items.filter((i) => i.active !== false && (i.type === 'material' || i.type === 'goods') && i.id !== productId);

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

export function bomFromSuggestion(r: unknown, M: readonly BomMaterial[]): BomSuggestion {
  const o = (r && typeof r === 'object' ? r : {}) as { lines?: { name?: string; qty?: number | string }[]; missing?: { name?: string; unit?: string; qty?: number | string }[]; note?: string };
  const lines: BomSuggestion['lines'] = [];
  for (const l of o.lines ?? []) {
    const it = M.find((i) => i.name === l?.name) ?? M.find((i) => String(i.name).toLowerCase() === String(l?.name || '').toLowerCase());
    if (it && +(l.qty ?? 0) > 0) lines.push({ itemId: it.id, qty: r4(+l.qty!) });
  }
  const missing = (o.missing ?? []).filter((m) => m && m.name).map((m) => ({ name: String(m.name), unit: String(m.unit || ''), qty: +(m.qty ?? 0) || 0 }));
  return { lines, missing, note: String(o.note || '') };
}
