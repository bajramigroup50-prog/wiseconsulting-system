/**
 * „📥 Фактура со ставки од Excel“ (legacy `pxOpen` … `pxBuild` 17236–17376): a purchase invoice whose lines come from a
 * spreadsheet. Header-row detection and column auto-mapping (`PX_COLS`, `pxNorm`, `pxAuto`), number parsing (`fkN`,
 * `pxN6`) and the draft lines / VAT groups. FIX (LEGACY-MAP 3.4 item 19): no formula evaluation with `Function()` —
 * the reader passes the cached cell values only.
 */

/** Legacy `PX_COLS` (17236). */
export const PX_COLS: Record<'code' | 'name' | 'qty' | 'price' | 'sp' | 'rate' | 'bar', RegExp> = {
  code: /шифра|code|šifra|kodi|sifra|art\.?\s*(no|nr|#)|item\s*no|артикл бр|кат\.?\s*бр|sku|kodu|stok\s*kod|urun\s*kod/i,
  name: /назив|опис|производ|name|emri|description|artikull|naziv|opis|roba|артикл$|^adi$|^ad$|urun\s*ad|mal\s*ad/i,
  qty: /количина|^кол\.?$|qty|sasia|kolicina|količina|quantity|^kom\.?$|^ком\.?$|pcs|^birim\s*miktar|^miktar|adet/i,
  price: /набавна|nab|цена|девиз|fob|price|cmimi|çmimi|cena|cijena|unit|jed|eur|usd|birim\s*fiyat|^fiyat/i,
  sp: /продажна|мпц|mpc|мало|selling|retail|shites|shitës|prodajna|satis|magaza/i,
  rate: /ддв|vat|tvsh|стапка|kdv/i,
  bar: /баркод|barcode|ean|barkod/i,
};
export type PxCol = keyof typeof PX_COLS;
export type PxMap = Partial<Record<PxCol, number>> & { _guess?: boolean };

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Legacy `fkN` (11344): numbers in Macedonian or English notation. */
export function pxNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? r2(v) : 0;
  let t = String(v ?? '').replace(/[\s ']/g, '').replace(/[^\d.,-]/g, '');
  if (!t) return 0;
  const lc = t.lastIndexOf(','), ld = t.lastIndexOf('.');
  if (lc > -1 && ld > -1) t = lc > ld ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (lc > -1) t = /,\d{1,2}$/.test(t) && (t.match(/,/g) ?? []).length === 1 ? t.replace(',', '.') : t.replace(/,/g, '');
  else if ((t.match(/\./g) ?? []).length > 1) t = t.replace(/\./g, '');
  const x = parseFloat(t);
  return Number.isFinite(x) ? r2(x) : 0;
}

/** Legacy `pxN6` (17258): prices with up to 6 decimals. */
export function pxN6(v: unknown): number {
  if (typeof v === 'number') return Math.round(v * 1e6) / 1e6;
  const a = pxNum(v);
  const t = String(v ?? '').replace(/[\s ']/g, '');
  const m = t.match(/[.,](\d+)$/);
  if (m && m[1]!.length > 2 && !(t.match(/[.,]/g) ?? []).slice(1).length) {
    const x = parseFloat(t.replace(',', '.').replace(/[^\d.-]/g, ''));
    if (Number.isFinite(x)) return Math.round(x * 1e6) / 1e6;
  }
  return a;
}

const PX_LAT: Record<string, string> = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', h: 'н', b: 'в', A: 'А', E: 'Е', O: 'О', P: 'Р', C: 'С', X: 'Х', K: 'К', M: 'М', T: 'Т', H: 'Н', B: 'В' };
/** Legacy `pxNorm` (17257): Turkish letters → Latin; Latin look-alikes inside Cyrillic headers → Cyrillic. */
export function pxNorm(x0: unknown): string {
  let x = String(x0 ?? '').replace(/[ \s]+/g, ' ').trim().replace(/İ/g, 'I').replace(/ı/g, 'i').replace(/[şŞ]/g, (m) => (m === 'ş' ? 's' : 'S'))
    .replace(/[ğĞ]/g, (m) => (m === 'ğ' ? 'g' : 'G')).replace(/[çÇ]/g, (m) => (m === 'ç' ? 'c' : 'C')).replace(/[öÖ]/g, (m) => (m === 'ö' ? 'o' : 'O')).replace(/[üÜ]/g, (m) => (m === 'ü' ? 'u' : 'U'));
  if (/[А-Яа-я]/.test(x)) x = x.replace(/[aeopcxykmthbAEOPCXKMTHB]/g, (c) => PX_LAT[c] ?? c);
  return x;
}

/** The header row (most column matches in the first 30 rows) of a sheet. */
export function pxHeaderRow(A: readonly (readonly unknown[])[]): { hi: number; score: number } {
  let hi = 0, bs = -1;
  for (let k = 0; k < Math.min(30, A.length); k++) {
    const sc = Object.values(PX_COLS).filter((re) => (A[k] ?? []).some((x) => re.test(pxNorm(x)))).length;
    if (sc > bs) { bs = sc; hi = k; }
  }
  return { hi, score: bs };
}

/** Legacy `pxAuto` (17259): column auto-mapping; a guessed price column is flagged `_guess`. */
export function pxAuto(row: readonly unknown[], data: readonly (readonly unknown[])[]): PxMap {
  const H = (row ?? []).map(pxNorm);
  const col: PxMap = {};
  for (const [k, re] of Object.entries(PX_COLS) as [PxCol, RegExp][]) {
    const j = H.findIndex((x, ix) => re.test(x) && !Object.values(col).includes(ix) && !(k === 'price' && (PX_COLS.sp.test(x) || /вкупно|износ|total|amount|vlera|вредност/i.test(x))));
    if (j >= 0) col[k] = j;
  }
  if (col.price == null) {
    const used = new Set(Object.values(col));
    const num = (i: number) => data.slice(0, 30).filter((r) => r && r[i] != null && String(r[i]).trim() !== '').every((r) => pxNum(r[i]) !== 0 || /^0([.,]0+)?$/.test(String(r[i]).trim()));
    for (let i = 0; i < H.length; i++) {
      if (used.has(i)) continue;
      if (num(i) && data.slice(0, 30).some((r) => r && pxNum(r[i]) > 0)) { col.price = i; col._guess = true; break; }
    }
  }
  return col;
}

export interface PxLine { code: string; name: string; qty: number; price: number | ''; sp: number; rate: number; barcode: string }

/** Rows → stock lines (legacy `pxBuild` loop): rows without quantity or without code and name are skipped. */
export function pxLines(A: readonly (readonly unknown[])[], hi: number, col: PxMap, vatFirm: boolean): PxLine[] {
  const out: PxLine[] = [];
  for (const r of A.slice(hi + 1)) {
    const code = col.code != null ? String(r[col.code] ?? '').trim() : '';
    const name = col.name != null ? String(r[col.name] ?? '').trim() : '';
    const qty = col.qty != null ? pxNum(r[col.qty]) : 0;
    if (!qty || (!code && !name)) continue;
    const sp = col.sp != null ? pxNum(r[col.sp]) : 0;
    const rate = col.rate != null && String(r[col.rate] ?? '') !== '' ? pxNum(r[col.rate]) : vatFirm ? 18 : 0;
    out.push({ code, name, qty, price: col.price != null ? pxN6(r[col.price]) : '', sp, rate, barcode: col.bar != null && r[col.bar] ? String(r[col.bar]) : '' });
  }
  return out;
}

/** VAT groups of a domestic Excel purchase per rate (legacy `pxBuild` 17271), or the import base (qty × price × fx). */
export function pxGroups(L: readonly (PxLine & { itemRate?: number })[], o: { imp: boolean; fx: number; vatFirm: boolean; konto: string }): { fxAmt: number; groups: { account: string; rate: number; base: number; vat: number }[] } {
  const sumF = r2(L.reduce((a, x) => a + x.qty * (Number(x.price) || 0), 0));
  if (o.imp) return { fxAmt: sumF, groups: [{ account: o.konto, rate: 0, base: r2(sumF * o.fx), vat: 0 }] };
  const by = new Map<number, number>();
  for (const x of L) { const rt = x.itemRate ?? x.rate; by.set(rt, r2((by.get(rt) ?? 0) + x.qty * (Number(x.price) || 0))); }
  return { fxAmt: 0, groups: [...by].map(([rt, b]) => ({ account: o.konto, rate: rt, base: r2(b), vat: o.vatFirm ? r2((b * rt) / 100) : 0 })) };
}
