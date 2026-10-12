/**
 * „Бруто биланс со аналитика“ as printed by the old accounting program many clients come from (PDF with a text
 * layer, A4 portrait, one analytic konto / partner per row). Read without AI, by the x positions of the layout:
 *
 *   Конто Опис | Почетна состојба | Само од тековна година Должи / Побарува | Вкупно од тековна год. Должи / Побарува
 *   | Крајно салдо | Комитент
 *
 *  - every row: the konto at the left edge (alone, or followed by the start of the name) and on the same or a 2–3 pt
 *    lower baseline the name start + six amounts (opening and closing saldo signed: negative = credit) + the partner
 *    („0589 АВТО ШКОЛА“); the account name and the partner name continue on the following lines without amounts;
 *  - „Сумарно за <konto>“, „Синтетика NNN“, „Група NN“, „Класа N“ and the final „ВКУПНО“ are control totals: never
 *    rows, but every one of them is compared with the rows read since the previous total of its level;
 *  - the page header (firm, title, period, the two heading lines) and the footer („Стр. N од M“) repeat on every page;
 *  - some exports use the old Macedonian 8-bit font (YUSCII: „Po~etna“, „Dol`i“, „POBARUVAWE“) — decoded to
 *    Cyrillic; a Latin „j“ inside Cyrillic words („Краjно“) is read as „ј“.
 *
 * `tbAnalitikaGrid` gives the same rows as a converter grid (opening / turnover / cumulative / closing as debit-credit
 * blocks, so „Користи: Крајно салдо / Почетна состојба / Промет“ works).
 */
import { parseNumAuto } from '../numfmt';
import type { PdfCell, PdfLine } from './pdf-lines';

export interface TbaRow {
  /** konto as printed (leading zeros kept) */
  k: string;
  name: string;
  /** partner code / name („0589“ / „АВТО ШКОЛА АРТ ДООЕЛ САРАЈ“), '' without partner */
  code: string; partner: string;
  /** opening saldo (signed), turnover of the year D / P, cumulative D / P (opening included), closing saldo (signed) */
  open: number; turnD: number; turnP: number; totD: number; totP: number; close: number;
  page: number;
}
export type TbaLevel = 'konto' | 'synth' | 'group' | 'class' | 'grand';
export interface TbaTotal {
  level: TbaLevel; k: string; label: string; page: number;
  open: number | null; turnD: number | null; turnP: number | null; totD: number | null; totP: number | null; close: number | null;
}
export interface TbaMismatch { label: string; page: number; field: string; doc: number; got: number }
export interface TbaResult {
  /** period of the trial balance (ISO), when printed */
  period: { from: string; to: string } | null;
  /** old 8-bit Macedonian font decoded */
  decoded: boolean;
  pages: number; pagesTotal: number | null;
  rows: TbaRow[];
  totals: TbaTotal[];
  grand: TbaTotal | null;
  /** printed totals that do not match the rows read */
  bad: TbaMismatch[];
  /** rows whose own columns do not add up (closing ≠ cumulative D − P, cumulative ≠ opening + turnover) */
  rowBad: { k: string; page: number; why: string }[];
  /** everything reconciles: every printed total, ВКУПНО present, all pages read */
  ok: boolean;
}

/* ------------------------------------------------------------------ text */

// YUSCII (old „MAC C“ fonts): Latin letters and [ \ ] ^ @ ` { | } ~ stand for the Macedonian Cyrillic letters
const YU: Record<string, string> = {
  a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', '|': 'ѓ', e: 'е', '`': 'ж', z: 'з', y: 'ѕ', i: 'и', j: 'ј', k: 'к', l: 'л', q: 'љ',
  m: 'м', n: 'н', w: 'њ', o: 'о', p: 'п', r: 'р', s: 'с', t: 'т', '}': 'ќ', u: 'у', f: 'ф', h: 'х', c: 'ц', '~': 'ч', x: 'џ', '{': 'ш',
  A: 'А', B: 'Б', V: 'В', G: 'Г', D: 'Д', '\\': 'Ѓ', E: 'Е', '@': 'Ж', Z: 'З', Y: 'Ѕ', I: 'И', J: 'Ј', K: 'К', L: 'Л', Q: 'Љ',
  M: 'М', N: 'Н', W: 'Њ', O: 'О', P: 'П', R: 'Р', S: 'С', T: 'Т', ']': 'Ќ', U: 'У', F: 'Ф', H: 'Х', C: 'Ц', '^': 'Ч', X: 'Џ', '[': 'Ш',
};
export const yusciiDecode = (s: string): string => s.replace(/[A-Za-z[\\\]^@`{|}~]/g, (c) => YU[c] ?? c);
/** Latin „j / J“ inside a Cyrillic word („Краjно“, „СКОПJЕ“) → „ј / Ј“. */
const fixJ = (s: string): string => s.replace(/\S+/g, (w) => (/[Ѐ-ӿ]/.test(w) ? w.replace(/j/g, 'ј').replace(/J/g, 'Ј') : w));

const NUM_CELL = /^-?\d{1,3}(?:[,.]\d{3})*(?:[.,]\d{1,2})?(?:\s+-?\d{1,3}(?:[,.]\d{3})*(?:[.,]\d{1,2})?)*$/;
const TOK = /-?\d{1,3}(?:[,.]\d{3})*(?:[.,]\d{1,2})?/g;
const isNumCell = (s: string) => NUM_CELL.test(s.trim());
const toks = (s: string) => [...s.matchAll(TOK)].map((m) => parseNumAuto(m[0], 'dot') ?? 0);

const SUB_RE = /^(сумарно\s+за|синтетика|група|класа|вкупно)(?=$|[\s\d:])\s*:?\s*(\d*)\s*(.*)$/i;
const LEVEL: Record<string, TbaLevel> = { 'сумарно за': 'konto', синтетика: 'synth', група: 'group', класа: 'class', вкупно: 'grand' };
const LV_ORDER: TbaLevel[] = ['konto', 'synth', 'group', 'class', 'grand'];
const FOOT_RE = /^стр\.?\s*(\d+)\s*од\s*(\d+)/i;
const KONTO_RE = /^(\d{3,10})(?:\s+(\D.*))?$/;
const FIELDS = ['open', 'turnD', 'turnP', 'totD', 'totP', 'close'] as const;
type Six = [number, number, number, number, number, number];

const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: string) => { const m = /(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(d); return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : ''; };

/** Is this the layout? (title or the heading „Почетна … Крајно … Комитент“ with „состојба … салдо“ below) */
function headerAt(L: readonly PdfLine[], i: number, txt: (l: PdfLine) => string): boolean {
  const a = txt(L[i]!).toLowerCase(), b = L[i + 1] ? txt(L[i + 1]!).toLowerCase() : '';
  return /конто/.test(a) && /почетна/.test(a) && /крајно/.test(a) && /состојба/.test(b) && /салдо/.test(b);
}

/**
 * Read the layout; null when the lines are not this program's „Бруто биланс со аналитика“.
 */
export function tbAnalitika(L0: readonly PdfLine[]): TbaResult | null {
  if (!L0.length) return null;
  // decode once: YUSCII when the heading says „Po~etna“ / „Dol`i“ / „sostojba“ in Latin
  const head = L0.slice(0, 40).map((l) => l.cells.map((c) => c.s).join(' ')).join('\n');
  const decoded = /po~etna|dol`i|bruto bilans|sostojba/i.test(head) && !/почетна/i.test(head);
  const conv = (s: string) => fixJ(decoded ? yusciiDecode(s) : s);
  const L: PdfLine[] = L0.map((l) => ({ ...l, cells: l.cells.map((c) => ({ ...c, s: conv(c.s) })) }));
  const txt = (l: PdfLine) => l.cells.map((c) => c.s).join(' ');
  const h0 = L.findIndex((_, i) => i < 60 && headerAt(L, i, txt));
  if (h0 < 0) return null;
  // column geometry from the heading: amounts right of „Почетна“, partner right of the closing column
  const H1 = L[h0]!, H2 = L[h0 + 1]!;
  const pocX0 = H1.cells.find((c) => /почетна/i.test(c.s))?.x0 ?? 136;
  const saldo = H2.cells.find((c) => /салдо/i.test(c.s)) ?? H1.cells.find((c) => /крајно/i.test(c.s));
  const saldoX1 = saldo?.x1 ?? 467;
  const kontoX1 = (H1.cells[0]?.x0 ?? 31) + 25; // konto starts at the left edge, „Сумарно“ / „Класа“ a few pt right
  const amtMinX1 = pocX0 - 2, partnerX0 = saldoX1 + 14;
  let period: TbaResult['period'] = null;
  const pm = /од\s+(\d{1,2}[./]\d{1,2}[./]\d{4})\s+до\s+(\d{1,2}[./]\d{1,2}[./]\d{4})/i.exec(L.slice(0, h0).map(txt).join(' '));
  if (pm) period = { from: iso(pm[1]!), to: iso(pm[2]!) };

  // heading lines of every page: from the top of the page down to the „состојба … салдо“ line
  const bodyFrom = new Map<number, number>();
  L.forEach((l, i) => { if (!bodyFrom.has(l.page) && i + 1 < L.length && headerAt(L, i, txt)) bodyFrom.set(l.page, L[i + 1]!.y); });
  let pagesTotal: number | null = null;
  const pageSet = new Set<number>();
  type Kind = { t: 'skip' } | { t: 'row'; k: string; text: PdfCell[]; amt: PdfCell[]; part: PdfCell[] } | { t: 'kOnly'; k: string; text: PdfCell[]; part: PdfCell[] }
    | { t: 'amt'; text: PdfCell[]; amt: PdfCell[]; part: PdfCell[] } | { t: 'sub'; lv: TbaLevel; k: string; label: string; rest: string; amt: PdfCell[]; part: PdfCell[] } | { t: 'cont'; text: PdfCell[]; part: PdfCell[] };
  const classify = (l: PdfLine): Kind => {
    pageSet.add(l.page);
    const by = bodyFrom.get(l.page);
    if (by != null && l.y >= by - 0.5) return { t: 'skip' };
    const all = txt(l).trim();
    const fm = FOOT_RE.exec(all);
    if (fm) { pagesTotal = Math.max(pagesTotal ?? 0, +fm[2]!); return { t: 'skip' }; }
    const amt = l.cells.filter((c) => c.x1 > amtMinX1 && c.x0 < partnerX0 && isNumCell(c.s));
    const part = l.cells.filter((c) => c.x0 >= partnerX0 && !amt.includes(c));
    const rest = l.cells.filter((c) => !amt.includes(c) && !part.includes(c));
    const first = rest[0];
    const sm = first ? SUB_RE.exec(first.s) : null;
    if (sm && first!.x0 < kontoX1 + 4) {
      const kw = sm[1]!.toLowerCase().replace(/\s+/g, ' ');
      // totals have no partner: an amount printed further right („ВКУПНО … 0.00“ at the partner edge) is still an amount
      const amtS = l.cells.filter((c) => c.x1 > amtMinX1 && isNumCell(c.s));
      const partS = part.filter((c) => !amtS.includes(c));
      return { t: 'sub', lv: LEVEL[kw]!, k: sm[2] ?? '', label: `${sm[1]} ${sm[2] ?? ''}`.trim(), rest: [sm[3] ?? '', ...rest.slice(1).map((c) => c.s)].join(' ').trim(), amt: amtS, part: partS };
    }
    const km = first && first.x0 < kontoX1 ? KONTO_RE.exec(first.s) : null;
    if (km) {
      const text = [...(km[2] ? [{ ...first!, s: km[2] }] : []), ...rest.slice(1)];
      return amt.length ? { t: 'row', k: km[1]!, text, amt, part } : { t: 'kOnly', k: km[1]!, text, part };
    }
    if (amt.length) return { t: 'amt', text: rest, amt, part };
    if (!rest.length && !part.length) return { t: 'skip' };
    return { t: 'cont', text: rest, part };
  };
  const K = L.map(classify);

  // right edges of the six amount columns, learned from the rows that have all six in their own cells
  const edges: number[][] = [[], [], [], [], [], []];
  for (const x of K) if (x.t === 'row' && x.amt.length === 6) x.amt.forEach((c, j) => edges[j]!.push(c.x1));
  const med = (a: number[]) => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]!; };
  const E = edges.every((a) => a.length) ? edges.map(med) : [185, 244, 303, 363, 421, 481];
  /** amounts of a data row in the six columns (merged cells „948,685.00 2,645,155.00“ are split, right-aligned) */
  const six = (cells: PdfCell[]): Six => {
    const out: Six = [0, 0, 0, 0, 0, 0];
    const T = cells.map((c) => ({ c, v: toks(c.s) }));
    if (T.reduce((n, x) => n + x.v.length, 0) === 6) { let j = 0; for (const x of T) for (const v of x.v) out[j++] = v; return out; }
    for (const x of T) {
      let col = 0, best = Infinity;
      E.forEach((e, j) => { const d = Math.abs(e - x.c.x1); if (d < best) { best = d; col = j; } });
      for (let i = x.v.length - 1, j = col; i >= 0 && j >= 0; i--, j--) out[j] = x.v[i]!;
    }
    return out;
  };
  /** amounts of a total line: 4 = opening, cumulative D / P, closing; 6 = all; otherwise the closing only */
  const subSix = (cells: PdfCell[]): (number | null)[] => {
    const v = cells.flatMap((c) => toks(c.s));
    if (v.length === 6) return v;
    if (v.length === 4) return [v[0]!, null, null, v[1]!, v[2]!, v[3]!];
    return [null, null, null, null, null, v.length ? v[v.length - 1]! : null];
  };

  type Row = TbaRow & { nm: string[]; pt: string[]; nmY: number; ptY: number; kY: number };
  const rows: Row[] = [];
  const totals: TbaTotal[] = [];
  const bad: TbaMismatch[] = [];
  const acc: Six[] = LV_ORDER.map(() => [0, 0, 0, 0, 0, 0]);
  let pendK: { k: string; text: PdfCell[]; part: PdfCell[]; i: number; y: number } | null = null;
  let pendA: { text: PdfCell[]; amt: PdfCell[]; part: PdfCell[]; i: number; y: number } | null = null;
  let lastSub: TbaTotal | null = null;
  let lastSubIdx = -9;
  const joinNames = (r: Row) => {
    r.name = r.nm.join(' ').replace(/\s+/g, ' ').trim();
    const p = r.pt.join(' ').replace(/\s+/g, ' ').trim();
    // „0589 АВТО ШКОЛА“, also glued „0020ТОИТОУРЕ“
    const m = /^(\d{1,10})\s*(\D.*)$/.exec(p);
    if (m) { r.code = m[1]!; r.partner = m[2]!; } else if (/^\d{1,10}$/.test(p)) { r.code = p; r.partner = ''; } else { r.code = ''; r.partner = p; }
  };
  const addRow = (k: string, text: PdfCell[], amt: PdfCell[], part: PdfCell[], page: number, y: number, kY = y) => {
    const v = six(amt);
    rows.push({ k, name: '', code: '', partner: '', open: v[0], turnD: v[1], turnP: v[2], totD: v[3], totP: v[4], close: v[5], page, nm: text.map((c) => c.s), pt: part.map((c) => c.s), nmY: y, ptY: y, kY });
    for (const a of acc) for (let j = 0; j < 6; j++) a[j] = r2(a[j]! + v[j]!);
  };
  /**
   * A continuation piece (name / partner / wrapped konto digits) goes to the row whose previous line of that column
   * is one line pitch above (1–2 text heights): the names of a row may run below the next row's first line.
   */
  const attach = (what: 'nm' | 'pt' | 'k', s: string, page: number, y: number, h: number): void => {
    if (!s || !rows.length) return;
    const yKey = what === 'nm' ? 'nmY' : what === 'pt' ? 'ptY' : 'kY';
    let best: Row | null = null, bg = Infinity;
    for (let j = rows.length - 1; j >= Math.max(0, rows.length - 8); j--) {
      const r = rows[j]!;
      if (r.page !== page) continue;
      const g = r[yKey] - y;
      if (g >= 0.9 * h && g <= 1.95 * h && g < bg) { bg = g; best = r; }
    }
    if (!best) {
      if (what === 'k') return attach('nm', s, page, y, h);
      best = rows[rows.length - 1]!;
    }
    if (what === 'k') { best.k += s; best.kY = y; } else if (what === 'nm') { best.nm.push(s); best.nmY = y; } else { best.pt.push(s); best.ptY = y; }
  };
  const closeSub = (s: TbaTotal) => {
    const lv = LV_ORDER.indexOf(s.level);
    const a = acc[lv]!;
    FIELDS.forEach((f, j) => {
      const doc = s[f];
      if (doc != null && Math.abs(doc - a[j]!) >= 0.005) bad.push({ label: s.label, page: s.page, field: f, doc, got: a[j]! });
    });
    for (let i = 0; i <= lv; i++) acc[i] = [0, 0, 0, 0, 0, 0];
  };
  const subAmounts = (s: TbaTotal, cells: PdfCell[]) => { const v = subSix(cells); FIELDS.forEach((f, j) => { s[f] = v[j] ?? null; }); };
  const flushSub = () => { if (lastSub) { closeSub(lastSub); lastSub = null; } };

  K.forEach((x, i) => {
    const { page, y } = L[i]!;
    const h = L[i]!.h ?? 8;
    // a total line without amounts gets the amounts-only line right after it
    if (lastSub && !(x.t === 'amt' && lastSubIdx === i - 1 && lastSub.close == null)) flushSub();
    if (pendA && pendA.i !== i - 1) pendA = null;
    switch (x.t) {
      case 'skip': return;
      case 'row': pendK = null; pendA = null; addRow(x.k, x.text, x.amt, x.part, page, y); return;
      case 'kOnly':
        if (pendA) { addRow(x.k, [...x.text, ...pendA.text], pendA.amt, [...pendA.part, ...x.part], page, Math.min(y, pendA.y), y); pendA = null; return; }
        pendK = { k: x.k, text: x.text, part: x.part, i, y };
        return;
      case 'amt':
        if (lastSub && lastSubIdx === i - 1 && lastSub.close == null) { subAmounts(lastSub, x.amt); flushSub(); return; }
        if (pendK) { addRow(pendK.k, [...pendK.text, ...x.text], x.amt, [...pendK.part, ...x.part], page, y, pendK.y); pendK = null; return; }
        // amounts above the konto line (the reverse offset) or above a total line without amounts
        pendA = { text: x.text, amt: x.amt, part: x.part, i, y };
        return;
      case 'sub': {
        pendK = null;
        const s: TbaTotal = { level: x.lv, k: x.k, label: x.label, page, open: null, turnD: null, turnP: null, totD: null, totP: null, close: null };
        const last = rows[rows.length - 1];
        // „Сумарно за 0192NA POSTROJKI“, „Сумарно за 13001818%“: a name line of the row printed over the total's label
        if (x.lv === 'konto' && last && x.k.length > last.k.length && x.k.startsWith(last.k)) {
          const extra = x.k.slice(last.k.length);
          s.k = last.k; s.label = `Сумарно за ${last.k}`;
          attach('nm', (extra + (x.rest && /^\d/.test(x.rest) ? ' ' : '') + x.rest).trim(), page, y, h);
        } else if (x.rest) attach('nm', x.rest, page, y, h);
        for (const c of x.part) attach('pt', c.s, page, y, h);
        totals.push(s);
        if (x.amt.length) { subAmounts(s, x.amt); lastSub = s; flushSub(); }
        else if (pendA && pendA.i === i - 1) { subAmounts(s, pendA.amt); pendA = null; lastSub = s; flushSub(); }
        else { lastSub = s; lastSubIdx = i; }
        return;
      }
      case 'cont': {
        const kc = x.text.filter((c) => c.x0 < kontoX1 && /^\d{1,4}$/.test(c.s));
        for (const c of kc) attach('k', c.s, page, y, h);
        const t = x.text.filter((c) => !kc.includes(c)).map((c) => c.s).join(' ');
        if (t) attach('nm', t, page, y, h);
        if (x.part.length) attach('pt', x.part.map((c) => c.s).join(' '), page, y, h);
        return;
      }
    }
  });
  flushSub();
  if (!rows.length) return null;
  for (const r of rows) joinNames(r);
  const out: TbaRow[] = rows.map(({ k, name, code, partner, open, turnD, turnP, totD, totP, close, page }) => ({ k, name, code, partner, open, turnD, turnP, totD, totP, close, page }));
  const rowBad: TbaResult['rowBad'] = [];
  for (const r of out) {
    if (Math.abs(r2(r.totD - r.totP) - r.close) >= 0.005) rowBad.push({ k: r.k, page: r.page, why: `крајно салдо ${r.close} ≠ вкупно должи − побарува ${r2(r.totD - r.totP)}` });
    else if (Math.abs(r2(r.open + r.turnD - r.turnP) - r.close) >= 0.005) rowBad.push({ k: r.k, page: r.page, why: `почетна состојба + промет ${r2(r.open + r.turnD - r.turnP)} ≠ крајно салдо ${r.close}` });
  }
  const grand = totals.find((t) => t.level === 'grand') ?? null;
  const pages = pageSet.size;
  const complete = pagesTotal == null || pages >= pagesTotal;
  const ok = !bad.length && !rowBad.length && !!grand && grand.close != null && complete
    && totals.some((t) => t.level === 'class');
  return { period, decoded, pages, pagesTotal, rows: out, totals, grand, bad, rowBad, ok };
}

/** Converter grid of the layout: signed saldos split into debit / credit so every block is a column pair. */
export function tbAnalitikaGrid(R: TbaResult): string[][] {
  const f = (n: number) => (n ? n.toFixed(2) : '');
  const dp = (n: number) => [n > 0 ? f(n) : '', n < 0 ? f(-n) : ''];
  return [
    ['Конто', 'Опис', 'Почетна состојба должи', 'Почетна состојба побарува', 'Промет должи', 'Промет побарува',
      'Вкупно должи', 'Вкупно побарува', 'Крајно салдо должи', 'Крајно салдо побарува', 'Шифра на комитент', 'Комитент'],
    ...R.rows.map((r) => [r.k, r.name, ...dp(r.open), f(r.turnD), f(r.turnP), f(r.totD), f(r.totP), ...dp(r.close), r.code, r.partner]),
  ];
}

/** Day after the trial balance period = date of the next opening („01.01.<year after>“ for a full year). */
export function tbaOpeningDate(R: TbaResult): string {
  const to = R.period?.to;
  if (!to) return '';
  const d = new Date(to + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
