/**
 * Нивелација helpers (legacy `nvApply` 17445, `nivTpl` 13186, `nivImp` 13188 / `nivItemBy`): bulk price change of
 * the selected items (▼ / ▲ %, or a fixed price, rounding 1 / 10 / none / …9), the Excel template and the import of
 * „Шифра · Нова цена · Количина · Стара цена“.
 */
import { r2 } from '../stock/num';
import { moNum } from './mout';

/** Rounding of a new price: 1 / 10 denars, 0.01 = none, 9 = ending in 9 (149, at least 9). */
export function nivRound(v: number, rs: number): number {
  if (rs === 9) return Math.max(9, Math.round(v / 10) * 10 - 1);
  if (rs === 0.01) return r2(v);
  return Math.round(v / rs) * rs;
}

/**
 * Legacy `nvApply`: new price of one item — a fixed price wins, else old × (1 ± pct %) rounded; `null` when nothing
 * changes (≤ 0 or within half a cent). `pct` with a leading minus is always a decrease.
 */
export function nivBulkPrice(old: number, o: { dir: 'down' | 'up'; pct?: string | number | null; fix?: string | number | null; rs: number }): number | null {
  const raw = String(o.pct ?? '').replace(/[−–—]/g, '-').trim();
  const pAbs = Math.abs(moNum(raw));
  const pct = raw.startsWith('-') || o.dir === 'down' ? -pAbs : pAbs;
  const fix = moNum(o.fix);
  if (!pct && !fix) return null;
  const nv = fix || nivRound(old * (1 + pct / 100), o.rs);
  return nv > 0 && Math.abs(nv - old) >= 0.005 ? nv : null;
}

export const NIV_TEMPLATE: readonly string[] = ['Шифра на производ', 'Нова цена', 'Количина', 'Стара цена'];

/** Legacy `nivImp`: the columns by header (шифра/баркод, нова, количина, стара; defaults 0–3), rows with a new price. */
export function nivImport<I extends { id: string; code?: string | null; name: string; barcodes?: readonly string[] }>(A0: readonly (readonly unknown[])[], items: readonly I[]):
  { rows: { item: I; nv: number; q: number; o: number }[]; miss: string[] } {
  const A = A0.filter((r) => r && r.some((x) => String(x ?? '').trim()));
  const hi = A.findIndex((r) => r.some((x) => /шифра|code|šifra/i.test(String(x || ''))));
  const H = hi >= 0 ? A[hi]!.map((x) => String(x || '').toLowerCase()) : [];
  const col = (re: RegExp, def: number) => { const k = H.findIndex((x) => re.test(x)); return k >= 0 ? k : def; };
  const cC = col(/шифра|code|šifra|баркод/, 0), cN = col(/нова|new|nova/, 1), cQ = col(/количина|qty|količ|kolicina/, 2), cO = col(/стара|old|stara/, 3);
  const by = (v: unknown) => {
    const s = String(v ?? '').trim();
    if (!s) return undefined;
    const l = s.toLowerCase();
    return items.find((i) => String(i.code ?? '').toLowerCase() === l) ?? items.find((i) => (i.barcodes ?? []).includes(s)) ?? items.find((i) => i.name.toLowerCase() === l);
  };
  const rows: { item: I; nv: number; q: number; o: number }[] = [];
  const miss: string[] = [];
  for (const r of A.slice(hi + 1)) {
    const it = by(r[cC]);
    const nv = moNum(r[cN]);
    if (!it) { if (String(r[cC] ?? '').trim()) miss.push(String(r[cC]).trim()); continue; }
    if (!(nv > 0)) continue;
    rows.push({ item: it, nv, q: moNum(r[cQ]), o: moNum(r[cO]) });
  }
  return { rows, miss };
}
