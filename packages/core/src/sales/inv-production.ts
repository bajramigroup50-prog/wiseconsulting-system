/**
 * Production from a sales invoice („Производство = Да“ → „Репроматеријали за производство“; new, not in legacy, where
 * only a free „Трошоци за производство“ field existed). The sale is processed in two moments: (1) production — the
 * raw materials are issued and the finished product is received at the materials cost (+ extra costs), (2) the
 * invoice issues the product as usual.
 *
 * Pure helpers: the material proposal from the normativ (BOM × line quantity), the material rows with stock on hand,
 * average cost and shortage, the per-unit BOM of a production order and the split of the extra costs.
 *
 * Per-line production (current editor): every invoice line has its own „🏭 производство“ marker and sub-panel
 * (materials from the normativ or picked from stock, extra costs, „зачувај како норматив“), with a live cost / margin
 * calculation (`lineProdCalc`, `prodSummary`). Older invoices saved under the invoice-level flag are read back as
 * marked lines (`plansFromSavedRun`).
 *
 * Production invoice („🏭 Фактура од производство“, chosen at the start of a new invoice): the invoice opens with its
 * main product(s) — usually new and custom, with a specification and dimensions (`ProdSpec`, `qtyFromSpec`) — and the
 * „Калкулација на производство“ per main product: materials + labour (hours × rate or an amount) + other direct costs +
 * overhead % = cost of production (`prodCostCalc`). Shortages and selling below cost are warnings, never blocks.
 */
import { r2 as money } from '../money';

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

/* ---------------- per-line production (each invoice line carries its own „🏭 производство“ marker) ---------------- */

/** Live calculation of one produced line: materials + extra costs = cost of production, unit cost, sale and margin. */
export interface LineProdCalc { mat: number; extra: number; cost: number; unit: number; sale: number; margin: number; pct: number | null; below: boolean }

/** `mat` = materials value at average cost, `sale` = the line's sale value without VAT (in denars). Money rounded with `r2`. */
export function lineProdCalc(x: { mat: number | string; extra?: number | string | null; qty: number | string; sale: number | string }): LineProdCalc {
  const mat = money(num(x.mat)), extra = money(num(x.extra)), q = num(x.qty), sale = money(num(x.sale));
  const cost = money(mat + extra);
  const margin = money(sale - cost);
  return { mat, extra, cost, unit: q > 0 ? r4(cost / q) : 0, sale, margin, pct: sale ? Math.round((margin / sale) * 1e4) / 100 : null, below: cost > 0 && sale + 0.005 < cost };
}

/** Invoice summary of the produced lines: total cost of production, their sale value and margin; `below` = lines sold under cost. */
export function prodSummary(calcs: readonly LineProdCalc[]): { cost: number; sale: number; margin: number; pct: number | null; below: number; lines: number } {
  const cost = money(calcs.reduce((a, c) => a + c.cost, 0)), sale = money(calcs.reduce((a, c) => a + c.sale, 0));
  const margin = money(sale - cost);
  return { cost, sale, margin, pct: sale ? Math.round((margin / sale) * 1e4) / 100 : null, below: calcs.filter((c) => c.below).length, lines: calcs.length };
}

/**
 * Materials to pick from stock for a produced line: stock items (not services, not the product itself) matching the
 * search (code / barcode / name), the ones with stock on hand at the warehouse first.
 */
export function searchStockMaterials<T extends { id: string; code: string | null; name: string; type: string; barcodes?: readonly string[] }>(
  items: readonly T[], q: string, stockOf: (id: string) => { qty: number; avg: number }, exclude: string | null, limit = 12,
): (T & { have: number; avg: number })[] {
  const s = q.trim().toLowerCase();
  const hit = (i: T) => !s || (i.code ?? '').toLowerCase().startsWith(s) || (i.barcodes ?? []).some((b) => b.includes(s)) || i.name.toLowerCase().includes(s);
  return items.filter((i) => i.type !== 'service' && i.id !== exclude && hit(i))
    .map((i) => { const x = stockOf(i.id); return { ...i, have: x.qty, avg: x.avg }; })
    .sort((a, b) => Number(b.have > 0) - Number(a.have > 0) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/* ---------------- production invoice („🏭 Фактура од производство“): main product, dimensions, full cost calculation ---------------- */

/**
 * Specification of a custom main product (e.g. „ТЕРАСА ПЕРГОЛА“): free text plus optional dimensions in metres.
 * `mode` says how the dimensions give the invoice quantity: `m2` = Д × Ш, `m3` = Д × Ш × В, `m` = Д (running metres),
 * '' = the quantity is typed. `pcs` = number of identical pieces (default 1).
 */
export interface ProdSpec { text?: string | null; l?: number | string | null; w?: number | string | null; h?: number | string | null; mode?: '' | 'm' | 'm2' | 'm3' | null; pcs?: number | string | null }

/** Area Д × Ш in m² (rounded to 4 decimals). */
export const dimArea = (l: number | string | null | undefined, w: number | string | null | undefined): number => r4(num(l) * num(w));
/** Volume Д × Ш × В in m³ (rounded to 4 decimals). */
export const dimVolume = (l: number | string | null | undefined, w: number | string | null | undefined, h: number | string | null | undefined): number => r4(num(l) * num(w) * num(h));

/** Invoice quantity from the dimensions × pieces (null when the mode is manual or a needed dimension is missing). */
export function qtyFromSpec(s: ProdSpec | null | undefined): number | null {
  if (!s?.mode) return null;
  const pcs = s.pcs == null || s.pcs === '' ? 1 : num(s.pcs);
  if (!(pcs > 0)) return null;
  const v = s.mode === 'm' ? num(s.l) : s.mode === 'm2' ? dimArea(s.l, s.w) : dimVolume(s.l, s.w, s.h);
  return v > 0 ? r4(v * pcs) : null;
}

/** Unit of measure that goes with a dimension mode. */
export const specUnit = (mode: ProdSpec['mode']): string | null => (mode === 'm2' ? 'm²' : mode === 'm3' ? 'm³' : mode === 'm' ? 'm' : null);

/** One-line description of the specification for the invoice line / calculation sheet: „Алуминиум, 4 × 3 m = 12 m²“. */
export function specText(s: ProdSpec | null | undefined): string {
  if (!s) return '';
  const f = (x: unknown) => String(r4(num(x))).replace('.', ',');
  const dims = s.mode === 'm' ? [s.l] : s.mode === 'm2' ? [s.l, s.w] : s.mode === 'm3' ? [s.l, s.w, s.h] : [s.l, s.w, s.h].filter((x) => num(x) > 0);
  const q = qtyFromSpec(s);
  const pcs = num(s.pcs) > 1 ? `${f(s.pcs)} × ` : '';
  const d = dims.some((x) => num(x) > 0) ? `${pcs}${dims.map(f).join(' × ')} m${q != null && s.mode !== 'm' ? ` = ${f(q)} ${specUnit(s.mode)}` : ''}` : '';
  return [String(s.text ?? '').trim(), d].filter(Boolean).join(', ');
}

/**
 * Cost elements of a produced line besides the materials: labour (hours × rate, or a fixed amount — the amount wins
 * when given), other direct costs (energy, transport, installation, subcontractors…) and overhead (режиски трошоци) in
 * % of the direct costs (materials + labour + other). All amounts in denars.
 */
export interface ProdCostInput {
  hours?: number | string | null; rate?: number | string | null; labour?: number | string | null;
  other?: readonly { label: string; amount: number | string | null }[] | null;
  ovhPct?: number | string | null;
}

/** Labour cost: the typed amount, else hours × rate (money). */
export function labourAmount(x: Pick<ProdCostInput, 'hours' | 'rate' | 'labour'> | null | undefined): number {
  if (!x) return 0;
  if (x.labour != null && String(x.labour).trim() !== '') return money(num(x.labour));
  return money(num(x.hours) * num(x.rate));
}

/** Full calculation of a produced line: `extra` = labour + other + overhead (what the production order books as labour). */
export interface ProdCostCalc extends LineProdCalc { lab: number; other: number; direct: number; ovhPct: number; ovh: number }

export function prodCostCalc(x: ProdCostInput & { mat: number | string; qty: number | string; sale: number | string }): ProdCostCalc {
  const mat = money(num(x.mat));
  const lab = labourAmount(x);
  const other = money((x.other ?? []).reduce((a, o) => a + money(num(o.amount)), 0));
  const direct = money(mat + lab + other);
  const ovhPct = num(x.ovhPct);
  const ovh = money((direct * ovhPct) / 100);
  const base = lineProdCalc({ mat, extra: money(lab + other + ovh), qty: x.qty, sale: x.sale });
  return { ...base, lab, other, direct, ovhPct, ovh };
}

/** „Работен налог / период“ of a production invoice. */
export interface WorkOrderRef { number: string; from?: string | null; to?: string | null }

/** „Работен налог 007/2026 (01.03.2026 – 31.03.2026)“. */
export function workOrderLabel(w: WorkOrderRef | null | undefined): string {
  if (!w?.number?.trim()) return '';
  const d = (x?: string | null) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x.split('-').reverse().join('.') : '');
  const per = [d(w.from), d(w.to)].filter(Boolean);
  return `Работен налог ${w.number.trim()}${per.length ? ` (${per.join(' – ')})` : ''}`;
}

/**
 * Number of a production order made under a work order: the work order's own number when free, else „број-2“,
 * „број-3“… (production order numbers are unique per firm).
 */
export function workOrderNumber(wo: string, taken: Iterable<string>): string {
  const T = new Set(taken);
  const b = wo.trim();
  if (!T.has(b)) return b;
  let k = 2;
  while (T.has(`${b}-${k}`)) k++;
  return `${b}-${k}`;
}

/** Amounts of a booked production line (stored with the invoice, shown on the calculation sheet). */
export interface ProdLineResult { mat: number; lab: number; other: number; ovh: number; cost: number; unit: number }

/** Production plan of one invoice line as saved in `invoices.data.prodRun.lines` (per-line fields optional: older runs kept them on the invoice). */
export interface SavedProdLine {
  lineNo: number; productId: string; qty: number; materials: readonly ProdMaterial[]; wh?: string | null; extra?: number | null; saveBom?: boolean;
  /** Production invoice: main product of the invoice, its specification and its cost elements. */
  main?: boolean; spec?: ProdSpec | null; calc?: ProdCostInput | null;
}
export interface SavedProdRun { wh?: string | null; extra?: number; saveBom?: boolean; lines: readonly SavedProdLine[]; orders?: readonly { productId: string; lineNo: number; lab?: number }[] }
export interface LineProdPlan { wh: string; extra: number; saveBom: boolean; materials: ProdMaterial[]; main?: boolean; spec?: ProdSpec | null; calc?: ProdCostInput | null }

/**
 * Backward compatibility: the saved run (per-line, or the older invoice-level „Производство = Да“ with one materials
 * warehouse and one extra cost for the whole invoice) → the plan of every editor line (null = not produced).
 * The extra cost of an older run comes from the line's production order (`lab` = its share), else it is split by the
 * materials quantities. With the old invoice-level flag (`legacyFlag`), the product lines the old panel listed
 * without materials are marked too.
 */
export function plansFromSavedRun(run: SavedProdRun | null | undefined, lines: readonly { itemId?: string | null }[], o: { legacyFlag?: boolean; isProduct?: (id: string) => boolean } = {}): (LineProdPlan | null)[] {
  const out: (LineProdPlan | null)[] = lines.map(() => null);
  const R = run?.lines ?? [];
  const share = splitExtra(num(run?.extra), R.map((l) => l.materials.reduce((a, m) => a + num(m.qty), 0)));
  R.forEach((l, k) => {
    let i = lines[l.lineNo]?.itemId === l.productId && !out[l.lineNo] ? l.lineNo : -1;
    if (i < 0) i = lines.findIndex((x, j) => x.itemId === l.productId && !out[j]);
    if (i < 0) return;
    const ord = run?.orders?.find((x) => x.lineNo === l.lineNo && x.productId === l.productId);
    const extra = l.extra != null ? num(l.extra) : ord?.lab != null ? num(ord.lab) : share[k] ?? 0;
    out[i] = {
      wh: l.wh ?? run?.wh ?? '', extra: money(extra), saveBom: l.saveBom ?? !!run?.saveBom, materials: l.materials.map((m) => ({ itemId: m.itemId, qty: num(m.qty) })),
      ...(l.main ? { main: true } : {}), ...(l.spec ? { spec: l.spec } : {}), ...(l.calc ? { calc: l.calc } : {}),
    };
  });
  if (o.legacyFlag) lines.forEach((l, i) => { if (!out[i] && l.itemId && o.isProduct?.(l.itemId)) out[i] = { wh: run?.wh ?? '', extra: 0, saveBom: !!run?.saveBom, materials: [] }; });
  return out;
}

/** BOM × quantity for one line (the proposal of the „🏭“ sub-panel); empty without a normativ. */
export function bomMaterials(bom: ProdBom | undefined, qty: number | string): ProdMaterial[] {
  return (bom?.lines ?? []).filter((x) => x.itemId && num(x.qty) > 0).map((x) => ({ itemId: x.itemId, qty: r4(num(x.qty) * num(qty)) }));
}
