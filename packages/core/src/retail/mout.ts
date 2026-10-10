/**
 * Излез од продавница (legacy `MOUT` 5699, `MO_COL` / `moCols` / `moImport` 5744–5758, `moTplDl` 5759, `moFindItem`
 * 5765): document kinds, the Excel / CSV column recognition, the import into the document lines and the templates.
 */
import { num, r2, r4 } from '../stock/num';

export type MoutKind = 'sale' | 'inv' | 'ret' | 'otp' | 'pop';
export const MOUT: Readonly<Record<MoutKind, { n: string; s: string; p: string; note: string }>> = {
  sale: { n: 'Продажба / парагон (дневен промет)', s: 'Продажба', p: 'ПР', note: 'Продажба по парагон блок или дневен промет по артикли: ја раздолжува залихата и се книжи како дневен промет (каса, приход, ДДВ). Влегува во КДФИ и ЕТМ.' },
  inv: { n: 'Фактура излезна (од продавница)', s: 'Фактура', p: '', note: 'Фактура до купувач (правно лице) од продавницата. Се отвора фактурата со објект = продавницата и залихата се раздолжува од таму.' },
  ret: { n: 'Повратница до добавувач', s: 'Повратница', p: 'ПВ', note: 'Враќање стока на добавувач. Залихата се намалува по продажни цени, добавувачот (2200) се задолжува по набавна вредност. ДДВ корекцијата доаѓа со книжното одобрение од добавувачот (Влез).' },
  otp: { n: 'Отпис (кало, крш, расипување)', s: 'Отпис', p: 'ОТ', note: 'Кало, растур, крш, расипување или истечен рок – со записник. Залихата се намалува, набавната вредност оди на трошок.' },
  pop: { n: 'Контролен попис (кусок / вишок)', s: 'Попис', p: 'ПП', note: 'Контролен попис: внесете ја пописаната количина; кусокот се раздолжува на трошок, вишокот се задолжува на приход.' },
};

const MO_COL = {
  code: ['шифра', 'sifra', 'šifra', 'code', 'код', 'plu', 'арт.бр', 'арт бр', 'шиф'],
  bar: ['баркод', 'bar kod', 'barkod', 'barcode', 'ean', 'бар код'],
  name: ['назив', 'артикл', 'name', 'опис', 'производ', 'emertim', 'emërtim', 'artikull', 'стока'],
  cnt: ['пописано', 'попис', 'избројано', 'popis', 'numeruar', 'fakt'],
  qty: ['количина', 'кол.', 'kolicina', 'qty', 'quantity', 'sasi', 'sasia', 'sasija', 'бр.'],
  price: ['цена', 'price', 'cmim', 'çmim', 'мпц', 'продажна', 'единечна'],
  amt: ['износ', 'вредност', 'amount', 'iznos', 'vlera', 'вкупно', 'total'],
};
export interface MoCols { code: number; bar: number; name: number; cnt: number; qty: number; price: number; amt: number }

/** Legacy `moCols`: column indexes from a header row. */
export function moCols(hdr: readonly unknown[]): MoCols {
  const H = hdr.map((x) => String(x ?? '').toLowerCase().trim());
  const f = (ks: readonly string[], skip: number[] = []) => H.findIndex((x, i) => !!x && !skip.includes(i) && ks.some((k) => x === k || x.startsWith(k) || x.includes(k)));
  const bar = f(MO_COL.bar);
  const code = f(MO_COL.code, [bar]);
  const name = f(MO_COL.name, [code, bar]);
  const cnt = f(MO_COL.cnt);
  const qty = f(MO_COL.qty, [cnt]);
  const price = f(MO_COL.price);
  const amt = f(MO_COL.amt, [price]);
  return { code, bar, name, cnt, qty, price, amt };
}

/** Legacy `impNum`: „1.234,50“ / „1 234.50“ / numbers. */
export function moNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let t = String(v ?? '').replace(/[\s ']/g, '').replace(/[^\d.,-]/g, '');
  if (!t) return 0;
  const lc = t.lastIndexOf(','), ld = t.lastIndexOf('.');
  if (lc > -1 && ld > -1) t = lc > ld ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (lc > -1) t = /,\d{1,2}$/.test(t) && (t.match(/,/g) || []).length === 1 ? t.replace(',', '.') : t.replace(/,/g, '');
  else if ((t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');
  const x = parseFloat(t);
  return Number.isFinite(x) ? x : 0;
}

export interface MoItem { id: string; code?: string | null; name: string; barcodes?: readonly string[] }
export interface MoImportResult { acc: Map<string, { q: number; amt: number; hasP: boolean }>; rows: number; miss: string[] }

/**
 * Legacy `moImport`: header row in the first 15 rows (else Шифра, Назив, Количина, Цена), item by barcode, code
 * (or barcode in the code column) or exact name; „Вкупно“ rows skipped; quantities summed per item, the price from the
 * price column or amount / quantity. For `pop` the „Пописано“ column wins over „Количина“.
 */
export function moImport(rows0: readonly (readonly unknown[])[], kind: MoutKind, items: readonly MoItem[]): MoImportResult {
  const rows = rows0.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  let hi = rows.findIndex((r, i) => i < 15 && (() => { const c = moCols(r); return (c.code >= 0 || c.name >= 0 || c.bar >= 0) && (c.qty >= 0 || c.cnt >= 0 || c.amt >= 0); })());
  let c: MoCols;
  if (hi < 0) { hi = -1; c = { code: 0, name: 1, qty: 2, price: 3, bar: -1, cnt: -1, amt: -1 }; } else c = moCols(rows[hi]!);
  const qc = kind === 'pop' && c.cnt >= 0 ? c.cnt : c.qty >= 0 ? c.qty : c.cnt;
  const miss: string[] = [];
  const acc = new Map<string, { q: number; amt: number; hasP: boolean }>();
  let n = 0;
  for (const r of rows.slice(hi + 1)) {
    const g = (i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '');
    const code = g(c.code), bar = g(c.bar), name = g(c.name);
    if (!code && !bar && !name) continue;
    if (/^вкупно|^total|^vkupno/i.test(code || name)) continue;
    const it = (bar && items.find((x) => (x.barcodes ?? []).includes(bar)))
      || (code && items.find((x) => String(x.code ?? '') === code || (x.barcodes ?? []).includes(code)))
      || (name && items.find((x) => x.name.toLowerCase() === name.toLowerCase()));
    const q = qc >= 0 ? moNum(r[qc]) : 0;
    if (!it) { miss.push((code || bar) + (name ? ' ' + name : '') + (q ? ' (' + q + ')' : '')); continue; }
    let pr: number | null = c.price >= 0 && moNum(r[c.price]) ? moNum(r[c.price]) : null;
    if (pr == null && c.amt >= 0 && q && moNum(r[c.amt])) pr = r2(moNum(r[c.amt]) / q);
    const o = acc.get(it.id) ?? { q: 0, amt: 0, hasP: false };
    o.q = r4(o.q + q);
    if (pr != null) { o.amt = r2(o.amt + pr * q); o.hasP = true; }
    acc.set(it.id, o);
    n++;
  }
  return { acc, rows: n, miss };
}

/** Legacy `moTplDl`: the count list (`pop`) or a 3-item template of the kind. */
export function moTemplate(kind: MoutKind, items: readonly (MoItem & { unit?: string | null })[], sys: (id: string) => number, price: (id: string) => number): (string | number)[][] {
  if (kind === 'pop') return [['Шифра', 'Баркод', 'Назив', 'ЕМ', 'Состојба', 'Пописано'], ...items.filter((it) => Math.abs(sys(it.id)) > 1e-9).map((it) => [it.code ?? '', it.barcodes?.[0] ?? '', it.name, it.unit ?? '', sys(it.id), ''])];
  return [['Шифра', 'Баркод', 'Назив', 'Количина', ...(kind === 'sale' ? ['Цена со ДДВ', 'Износ'] : [])], ...items.slice(0, 3).map((it) => [it.code ?? '', it.barcodes?.[0] ?? '', it.name, 1, ...(kind === 'sale' ? [price(it.id), ''] : [])])];
}

/** Legacy `moFindItem`: „шифра · назив“, code, barcode, exact name, or the only name containing the text. */
export function moFindItem<I extends MoItem>(items: readonly I[], v0: string): I | null {
  const v = String(v0 ?? '').trim().toLowerCase();
  if (!v) return null;
  const lab = (it: I) => ((it.code ? it.code + ' · ' : '') + it.name).toLowerCase();
  const inc = items.filter((it) => it.name.toLowerCase().includes(v));
  return items.find((it) => lab(it) === v) ?? items.find((it) => String(it.code ?? '').toLowerCase() === v) ?? items.find((it) => (it.barcodes ?? []).some((b) => b.toLowerCase() === v))
    ?? items.find((it) => it.name.toLowerCase() === v) ?? (inc.length === 1 ? inc[0]! : null);
}

/** Total of a document of the list (legacy `tv`): count = Σ diff × retail price, else Σ line values. */
export const moTotal = (kind: MoutKind, lines: readonly { diff?: number | null; sp?: number | null; val?: number | null }[]): number =>
  r2(lines.reduce((a, l) => a + (kind === 'pop' ? num(l.diff) * num(l.sp) : num(l.val)), 0));
