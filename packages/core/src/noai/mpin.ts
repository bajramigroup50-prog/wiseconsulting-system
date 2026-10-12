/**
 * МПИН „Декларација за прием“ (УЈП, e-Персонален данок) read WITHOUT AI from the PDF text layer (or a text export).
 * The result has the shape of the `MPIN_ASK` answer, so `mpinNorm` and the МПИН inbox work unchanged.
 *
 * Read: ЕДБ („Идентификација на обврзникот“), name, period, status, submission number / date, insured persons,
 * the contribution table (rows „Бруто основица“ / „Стапка“ / „Месечен износ на придонес“, columns ПИО, Здравство,
 * дополнителен 0,5 %, вработување, стаж со зголемено траење, персонален данок), the printed grand total, due date and
 * folio. Columns are found by the header text (x position in a PDF, order in a text export), never by a fixed layout.
 *
 * Accepted only when the checks pass: ЕДБ (13 digits), period, gross > 0, ПИО and здравство > 0, and
 *   - printed total = sum of the columns (± 1 den.), and / or
 *   - every column = base × printed rate (± 1 den.);
 * at least one of the two controls must be printed. Net = gross − contributions − tax must be > 0.
 * Otherwise `data` is null and `why` says why (the caller then reads it with AI).
 */
import { r2 } from '../money';
import { amountsIn, dateIn, edbIn, percentsIn, up, type FreeParse } from './doc-text';
import type { PdfLine } from './pdf-lines';

/** The `MPIN_ASK` answer (amounts as numbers). */
export interface MpinAsk {
  isMpin: boolean; edb: string; name: string; period: string; status: string; subNo: string; subDate: string;
  gross: number; pio: number; zdr: number; dop: number; vrab: number; staz: number; tax: number; total: number;
  insured: number; due: string; folio: string;
}

const COLS = ['pio', 'zdr', 'dop', 'vrab', 'staz', 'tax'] as const;
type Col = typeof COLS[number];
/** Header keyword per column, tested in this order (the 0,5 % column also says „здравство“). */
const COL_RE: [Col, RegExp][] = [
  ['dop', /ДОПОЛНИТЕЛ|ПРОФЕСИОНАЛ|ПОВРЕДА/],
  ['vrab', /ВРАБОТУВАЊЕ|НЕВРАБОТЕН/],
  ['staz', /СТАЖ/],
  ['tax', /ДАНОК/],
  ['pio', /ПИО|ПЕНЗИСК/],
  ['zdr', /ЗДРАВСТВ/],
];
const colOf = (s: string): Col | null => { const u = up(s); return COL_RE.find(([, re]) => re.test(u))?.[0] ?? null; };

const MONTHS = ['ЈАНУАРИ', 'ФЕВРУАРИ', 'МАРТ', 'АПРИЛ', 'МАЈ', 'ЈУНИ', 'ЈУЛИ', 'АВГУСТ', 'СЕПТЕМВРИ', 'ОКТОМВРИ', 'НОЕМВРИ', 'ДЕКЕМВРИ'];
/** „09/2026“, „9.2026“, „2026-09“, „септември 2026“ → `YYYY-MM` ('' when none). */
export function mpinPeriodIn(s: string): string {
  const u = up(s);
  let m = /(?<![\d./-])(\d{1,2})[./-](\d{4})(?!\d)/.exec(u);
  if (m && +m[1]! >= 1 && +m[1]! <= 12) return `${m[2]}-${m[1]!.padStart(2, '0')}`;
  m = /(?<!\d)(\d{4})[./-](\d{1,2})(?![\d./-])/.exec(u);
  if (m && +m[2]! >= 1 && +m[2]! <= 12) return `${m[1]}-${m[2]!.padStart(2, '0')}`;
  for (let i = 0; i < 12; i++) {
    const x = new RegExp(MONTHS[i]! + '\\s*,?\\s*(\\d{4})').exec(u);
    if (x) return `${x[1]}-${String(i + 1).padStart(2, '0')}`;
  }
  return '';
}

/** One text line with its cells (x centre of each cell when it came from a PDF). */
interface Row { text: string; cells: { s: string; x: number | null }[] }

const fromPdf = (L: readonly PdfLine[]): Row[] => L.map((l) => ({ text: l.cells.map((c) => c.s).join('   '), cells: l.cells.map((c) => ({ s: c.s, x: (c.x0 + c.x1) / 2 })) }));
const fromText = (L: readonly string[]): Row[] => L.map((t) => ({ text: t, cells: t.split(/\s{2,}|\t|;/).map((s) => s.trim()).filter(Boolean).map((s) => ({ s, x: null })) }));

/** Value of a label: the rest of its line after the label / colon, else the next line. */
function valueOf(R: readonly Row[], re: RegExp, pick: (s: string) => string): string {
  for (let i = 0; i < R.length; i++) {
    const t = R[i]!.text;
    const m = re.exec(up(t));
    if (!m) continue;
    const rest = t.slice(m.index + m[0].length).replace(/^\s*[:.-]?\s*/, '');
    const v = pick(rest);
    if (v) return v;
    const n = R[i + 1] ? pick(R[i + 1]!.text) : '';
    if (n) return n;
  }
  return '';
}

/** Read the declaration from PDF lines. */
export const mpinFromPdf = (L: readonly PdfLine[]): FreeParse<MpinAsk> => mpinFromRows(fromPdf(L));
/** Read the declaration from a text export (lines; columns separated by 2+ spaces, tab or `;`). */
export const mpinFromText = (L: readonly string[]): FreeParse<MpinAsk> => mpinFromRows(fromText(L));

function mpinFromRows(R: Row[]): FreeParse<MpinAsk> {
  const no = (why: string, checks: string[] = []): FreeParse<MpinAsk> => ({ data: null, ok: false, why, checks });
  const all = up(R.map((r) => r.text).join('\n'));
  if (!/МПИН|ДЕКЛАРАЦИЈА ЗА ПРИЕМ|ПРИДОНЕСИ ОД ЗАДОЛЖИТЕЛНО|ПРЕСМЕТКА ЗА ПЛАТА/.test(all) || !/ПИО|ПЕНЗИСК/.test(all)) return no('не е МПИН декларација');

  // ── the contribution table ─────────────────────────────────────────────────────────────────────────────────────
  const bi = R.findIndex((r) => /БРУТО\s+ОСНОВИЦ|ОСНОВИЦА\s+ЗА\s+ПРЕСМЕТКА/.test(up(r.text)) && amountsIn(r.text).length);
  const ai = R.findIndex((r, i) => i > bi && /МЕСЕЧЕН\s+ИЗНОС|ИЗНОС\s+НА\s+ПРИДОНЕС|ПРЕСМЕТАН\s+ИЗНОС/.test(up(r.text)) && amountsIn(r.text).length);
  if (bi < 0 || ai < 0) return no('не е пронајдена табелата со придонеси');
  const ri = R.findIndex((r, i) => i > bi && i < ai && /СТАПКА/.test(up(r.text)) && percentsIn(r.text).length);
  // header cells: the lines above the base row back to the first line naming a column
  // (the cell closest to the table wins; long cells / „label: value“ lines are titles, not column headers)
  const H = new Map<Col, { col: Col; x: number | null; at: number }>();
  let at = 0;
  for (let i = Math.max(0, bi - 8); i < bi; i++) {
    for (const c of R[i]!.cells) {
      const col = c.s.length <= 70 && !c.s.includes(':') ? colOf(c.s) : null;
      if (col) { H.delete(col); H.set(col, { col, x: c.x, at: at++ }); }
    }
  }
  const head = [...H.values()];
  if (!head.some((h) => h.col === 'pio')) return no('не се препознаени колоните на табелата');
  const byX = head.every((h) => h.x != null);
  const order = byX ? [...head].sort((a, b) => a.x! - b.x!) : [...head].sort((a, b) => a.at - b.at);
  /** Amount cells of a row → column. With x: nearest header; without: header order. */
  const rowVals = (r: Row, nums: (s: string) => number[]): Partial<Record<Col, number>> => {
    const out: Partial<Record<Col, number>> = {};
    if (byX && r.cells.every((c) => c.x != null)) {
      for (const c of r.cells) {
        const v = nums(c.s);
        if (v.length !== 1) continue;
        const h = order.reduce((b, h) => (Math.abs(h.x! - c.x!) < Math.abs(b.x! - c.x!) ? h : b));
        out[h.col] = v[0]!;
      }
      return out;
    }
    const V = nums(r.text);
    order.forEach((h, i) => { if (V[i] != null) out[h.col] = V[i]!; });
    return out;
  };
  const base = rowVals(R[bi]!, amountsIn);
  const amount = rowVals(R[ai]!, amountsIn);
  const rate = ri >= 0 ? rowVals(R[ri]!, percentsIn) : {};

  // ── header fields ──────────────────────────────────────────────────────────────────────────────────────────────
  const edb = valueOf(R, /ИДЕНТИФИКАЦИ\S*\s+НА\s+ОБВРЗНИК\S*|ЕДИНСТВЕН\s+ДАНОЧЕН\s+БРОЈ|ЕДБ|ДАНОЧЕН\s+БРОЈ/, edbIn);
  const name = valueOf(R, /(?:ИМЕ|НАЗИВ)\s+НА\s+(?:ОБВРЗНИК\S*|ИСПЛАТУВАЧ\S*|ПРАВНО\s+ЛИЦЕ)/, (s) => s.replace(/\s{2,}.*$/, '').trim());
  const period = valueOf(R, /ПЕРИОД(?:\s+ЗА\s+КОЈ\s+СЕ\s+ПОДНЕСУВА)?|МЕСЕЦ\s+ЗА\s+КОЈ/, mpinPeriodIn);
  const status = valueOf(R, /СТАТУС(?:\s+НА\s+ДЕКЛАРАЦИЈАТА)?/, (s) => /^[А-ЯЃЌЉЊЏЅЈA-Z ]{4,}/.exec(up(s).trim())?.[0].trim() ?? '');
  const subNo = valueOf(R, /БРОЈ\s+(?:ЗА|НА)\s+ПОДНЕСУВАЊЕ|БРОЈ\s+НА\s+ДЕКЛАРАЦИЈА/, (s) => /^[A-ZА-Я0-9][\w/-]*/i.exec(s.trim())?.[0] ?? '');
  const subDate = valueOf(R, /ДАТУМ\s+(?:НА|ЗА)\s+ПОДНЕСУВАЊЕ|ДАТУМ\s+НА\s+ПРИЕМ/, dateIn);
  const insured = +valueOf(R, /(?:ВКУПНО|БРОЈ\s+НА)\s+(?:ОСИГУРЕНИЦИ|ВРАБОТЕНИ|ЛИЦА)/, (s) => /^\d{1,6}(?![\d.,])/.exec(s.trim())?.[0] ?? '') || 0;
  const totalS = valueOf(R, /ВКУПЕН\s+ИЗНОС\s+НА\s+(?:СОЦИЈАЛНИ\s+)?ПРИДОНЕСИ|ВКУПНО\s+ЗА\s+УПЛАТА|ВКУПНО\s+ПРИДОНЕСИ\s+И\s+ДАНОК/, (s) => { const A = amountsIn(s); return A.length ? String(A[A.length - 1]) : ''; });
  const due = valueOf(R, /(?:ПОСЛЕДЕН\s+)?РОК\s+ЗА\s+ПЛАЌАЊЕ/, dateIn);
  const folio = valueOf(R, /ФОЛИО|БРОЈ\s+НА\s+НАЛОГ/, (s) => /\d{4,}/.exec(s)?.[0] ?? '');

  const v = (c: Col) => r2(amount[c] ?? 0);
  const gross = r2(base.pio ?? Object.values(base)[0] ?? 0);
  const total = totalS ? +totalS : 0;
  const data: MpinAsk = {
    isMpin: true, edb, name, period, status, subNo, subDate, gross,
    pio: v('pio'), zdr: v('zdr'), dop: v('dop'), vrab: v('vrab'), staz: v('staz'), tax: v('tax'), total, insured, due, folio,
  };

  // ── checks ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const checks: string[] = [];
  if (edb.length !== 13) return no('нема ЕДБ (13 цифри)', checks);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return no('нема период', checks);
  if (!(gross > 0) || !(data.pio > 0) || !(data.zdr > 0)) return no('нема бруто основица / ПИО / здравство', checks);
  const sum = r2(COLS.reduce((a, c) => a + v(c), 0));
  let controls = 0;
  if (total) {
    if (Math.abs(total - sum) > 1) return no(`вкупно ${total.toFixed(2)} ≠ збир на колоните ${sum.toFixed(2)}`, checks);
    checks.push('вкупно = збир на колоните'); controls++;
  }
  const rated = COLS.filter((c) => rate[c] != null && amount[c] != null);
  if (rated.length) {
    for (const c of rated) {
      const b = base[c] ?? gross;
      const exp = r2((b * rate[c]!) / 100);
      if (Math.abs(exp - v(c)) > 1) return no(`колона ${c}: ${v(c).toFixed(2)} ≠ основица × ${rate[c]}% (${exp.toFixed(2)})`, checks);
    }
    checks.push('основица × стапка = износ'); controls++;
  }
  if (!controls) return no('нема контролен збир (вкупно / стапки) за проверка', checks);
  const net = r2(gross - sum);
  if (!(net > 0)) return no('нето ≤ 0', checks);
  checks.push('нето = бруто − придонеси − данок > 0');
  return { data, ok: true, why: '', checks };
}
