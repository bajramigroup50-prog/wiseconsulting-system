/**
 * Synthetic „Бруто биланс со аналитика“ (the old program's PDF layout) as pdfjs gives it: invented firm, kontos,
 * partners and amounts, with the coordinates of the real export — page header repeated on every page, konto at
 * x≈31 (alone, or in one run with the name), name at x≈65, six amounts right-aligned at x≈185 / 244 / 303 / 363 / 421
 * / 481, partner at x≈488 continuing at x≈509, names running below the next row's first line, „Сумарно за“ with a
 * name line printed over its label, a konto wrapped onto a second line, „Синтетика“ / „Група“ / „Класа“ / „ВКУПНО“
 * (with three amounts in one run), footer „Стр. N од M“, Latin „j“ inside Cyrillic words.
 */
import type { PdfItem } from './pdf-lines';
import { yusciiDecode } from './tb-analitika';

export interface FxRow {
  k: string; name: string[]; partner?: string[]; open: number; turnD: number; turnP: number;
  /** konto and name start in one text run („100002 ЖИРО СМЕТКА“) */
  oneRun?: boolean;
  /** konto continued on the next line („1300181“ + „1“) */
  kWrap?: string;
  /** distance to the next row (default: after the last name / partner line) */
  pitch?: number;
}
export type FxStep =
  | { row: FxRow }
  | { sum: string; merge?: string; tail?: string[] }
  | { synth: string } | { group: string } | { cls: string }
  | { pageBreak: true }
  | { grand: true };

const AMT_X1 = [185, 244, 303, 363, 421, 481];
const SUB_X1 = [198, 357, 418, 481];
const fmtN = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fxTot = (r: FxRow) => {
  const totD = Math.max(r.open, 0) + r.turnD, totP = Math.max(-r.open, 0) + r.turnP;
  return { totD, totP, close: Math.round((totD - totP) * 100) / 100 };
};

/** Items of the document; `encode` writes the text in the old YUSCII font (Latin letters for Cyrillic). */
export function tbaFixtureItems(steps: readonly FxStep[], o: { encode?: boolean; pages?: number } = {}): PdfItem[] {
  const enc = (s: string) => (o.encode ? yusciiEncode(s) : s);
  const out: PdfItem[] = [];
  let page = 1, y = 0;
  const pagesTotal = o.pages ?? 1 + steps.filter((s) => 'pageBreak' in s).length;
  const put = (x: number, yy: number, s: string, h = 8, w = s.length * 4.4) => out.push({ page, x, y: yy, w, h, s: enc(s) });
  const amt = (x1: number, yy: number, v: number) => { const s = fmtN(v); put(x1 - s.length * 4, yy, s, 8, s.length * 4); };
  const header = () => {
    if (page === 1) {
      put(44, 792.6, 'ПРИМЕР ТРЕЈД ДООЕЛ', 16);
      put(113, 777.0, 'УЛ. ИЗМИСЛЕНА Бр.1 СКОПJЕ * Тел.: 000 000 000 *');
      put(125, 765.8, 'Жиро сметка: 300000000000000 * Банка: БАНКА * ЕДБ: МК4000000000000');
      put(33, 730.2, 'Бруто биланс со аналитика', 16);
      put(33, 715.8, 'За период од 01/01/2025 до 31/12/2025 година', 10);
    }
    const t = page === 1 ? 659.2 : 798.2;
    put(31, t, 'Конто', 10); put(63, t, 'Опис', 10); put(136, t, 'Почетна', 10); put(188, t, 'Само од тековна година', 10, 98);
    put(307, t, 'Вкупно од тековна год.', 10, 96); put(436, t, 'Краjно', 10); put(502, t, 'Комитент', 10);
    const b = t - 11.5;
    put(136, b, 'состоjба', 10); put(190, b, 'Должи', 10); put(255, b, 'Побарува', 10); put(306, b, 'Должи', 10); put(371, b, 'Побарува', 10); put(438, b, 'салдо', 10, 28);
    y = b - 15.1;
  };
  const footer = () => put(444, 32.7, `Стр. ${page} од ${pagesTotal}`, 10);
  // running totals per level: konto, synth, group, class, grand (open, turnD, turnP, totD, totP, close)
  const acc = [0, 1, 2, 3, 4].map(() => [0, 0, 0, 0, 0, 0]);
  const sub = (lvl: number, label: string, x: number, merge?: string) => {
    const a = acc[lvl]!;
    put(x, y, label, 8, 72);
    if (merge) put(65, y, merge);
    [a[0]!, a[3]!, a[4]!, a[5]!].forEach((v, j) => amt(SUB_X1[j]!, y, v));
    for (let i = 0; i <= lvl; i++) acc[i] = [0, 0, 0, 0, 0, 0];
  };
  header();
  for (const st of steps) {
    if ('row' in st) {
      const r = st.row, t = fxTot(r);
      if (r.oneRun) put(31, y, `${r.k} ${r.name[0]}`, 8, 94);
      else { put(31, y, r.k, 8, r.k.length * 4.5); put(65, y - 0.4, r.name[0]!); }
      [r.open, r.turnD, r.turnP, t.totD, t.totP, t.close].forEach((v, j) => amt(AMT_X1[j]!, y - 0.4, v));
      if (r.partner?.[0]) put(488, y - 0.4, r.partner[0]);
      r.name.slice(1).forEach((s, i) => put(65, y - 12.4 - 9.5 * i, s));
      r.partner?.slice(1).forEach((s, i) => put(509, y - 12.4 - 9.5 * i, s));
      if (r.kWrap) put(31, y - 9.5, r.kWrap, 8, r.kWrap.length * 4.5);
      for (const a of acc) [r.open, r.turnD, r.turnP, t.totD, t.totP, t.close].forEach((v, j) => { a[j] = Math.round((a[j]! + v) * 100) / 100; });
      const lines = Math.max(r.name.length, r.partner?.length ?? 1);
      y -= r.pitch ?? (lines > 1 ? 12.4 + 9.5 * (lines - 2) + 10 : 12);
    } else if ('sum' in st) {
      sub(0, `Сумарно за ${st.sum}`, 51, st.merge);
      for (const s of st.tail ?? []) { y -= 9.5; put(65, y, s); }
      y -= 14.4;
    } else if ('synth' in st) { sub(1, `Синтетика ${st.synth}`, 38); y -= 16.9; }
    else if ('group' in st) { sub(2, `Група ${st.group}`, 38); y -= 16.1; }
    else if ('cls' in st) { sub(3, `Класа ${st.cls}`, 38); y -= 17; }
    else if ('pageBreak' in st) { footer(); page++; header(); }
    else if ('grand' in st) {
      const a = acc[4]!;
      put(38, y, 'ВКУПНО', 9, 38);
      amt(171, y, a[0]!);
      const mid = `${fmtN(a[1]!)} ${fmtN(a[2]!)} ${fmtN(a[3]!)}`;
      put(365 - mid.length * 4, y, mid, 9, mid.length * 4);
      amt(432, y, a[4]!);
      const c = fmtN(a[5]!);
      put(480, y, c, 9, c.length * 4);
      y -= 20;
    }
  }
  footer();
  return out;
}

const YU_REV: Record<string, string> = {};
for (const c of 'abvgdezijklmnoprstufhcqwxy|`}~{ABVGDEZIJKLMNOPRSTUFHCQWXY\\@]^['.split('')) YU_REV[yusciiDecode(c)] = c;
/** Cyrillic → the old YUSCII font's Latin letters (what such a PDF's text layer holds). */
export const yusciiEncode = (s: string): string => s.replace(/[Ѐ-ӿ]/g, (c) => YU_REV[c] ?? c).replace(/[ј]/g, 'j');

/** The standard synthetic document: 3 pages, classes 0, 1, 2, 4, 7, 9 (see the test for the expected values). */
export const TBA_STEPS: FxStep[] = [
  { row: { k: '0121', name: ['ОПРЕМА'], open: 735657, turnD: 0, turnP: 0 } },
  { sum: '0121' }, { synth: '012' },
  { row: { k: '0192', name: ['АКУМУЛИРАНА', 'АМОРТИЗАЦИJА'], open: -591411, turnD: 0, turnP: 0, pitch: 21.9 } },
  // the third name line is printed over the total's label, the fourth below it
  { sum: '0192', merge: 'НА ПОСТРОЈКИ', tail: ['И ОПРЕМА'] }, { synth: '019' }, { group: '01' }, { cls: '0' },
  { row: { k: '100002', name: ['ЖИРО СМЕТКА', 'КОМЕРЦИJАЛНА', 'БАНКА'], open: 281568, turnD: 4688477, turnP: 4877717, oneRun: true } },
  { sum: '100002' }, { synth: '100' }, { group: '10' },
  { row: { k: '1300181', kWrap: '1', name: ['ДДВ ПРИ УВОЗ', 'НА ВЛЕЗНИ'], open: 0, turnD: 748721, turnP: 748721, pitch: 21.9 } },
  { sum: '13001811', merge: 'ФАКТУРИ 18%' }, { synth: '130' }, { group: '13' },
  // partner rows 25.5 pt apart: the last name line of a row runs below the next row's first line
  { row: { k: '1200', name: ['ПОБАРУВАЊЕ', 'ОД КУПУВАЧИ', 'ОД ПРОДАЖБА', 'НА ДОБРА'], partner: ['0589 АВТО ШКОЛА', 'АРТ ДООЕЛ', 'САРАJ'], open: 0, turnD: 34000, turnP: 30000, pitch: 25.5 } },
  { row: { k: '1200', name: ['ПОБАРУВАЊЕ', 'ОД КУПУВАЧИ', 'ОД ПРОДАЖБА', 'НА ДОБРА'], partner: ['0899 ФКСР-АЛДИ', 'ДООЕЛ'], open: -3700, turnD: 0, turnP: 0, pitch: 45 } },
  { pageBreak: true },
  { row: { k: '1200', name: ['ПОБАРУВАЊЕ', 'ОД КУПУВАЧИ'], partner: ['0020ТОИТОУРЕ', 'ПЕЕТЕРС СПРЛ'], open: 1000, turnD: 0, turnP: 0 } },
  { sum: '1200' }, { synth: '120' }, { group: '12' }, { cls: '1' },
  { row: { k: '2200', name: ['ОБВРСКИ КОН', 'ДОБАВУВАЧИ'], partner: ['0023 СИПА СПРЛ'], open: -10000, turnD: 5000, turnP: 0 } },
  { sum: '2200' }, { synth: '220' },
  { row: { k: '2400', name: ['ОБВРСКИ ЗА', 'ПЛАТИ'], open: -202874, turnD: 0, turnP: 0 } },
  { sum: '2400' }, { synth: '240' }, { group: '22' }, { cls: '2' },
  { pageBreak: true },
  { row: { k: '4000', name: ['ТРОШОЦИ'], open: 0, turnD: 50000, turnP: 0 } },
  { sum: '4000' }, { synth: '400' }, { group: '40' }, { cls: '4' },
  { row: { k: '7000', name: ['ПРИХОДИ'], open: 0, turnD: 0, turnP: 80000 } },
  { sum: '7000' }, { synth: '700' }, { group: '70' }, { cls: '7' },
  { row: { k: '994018', name: ['ОСНОВИЦА ЗА', 'ДДВ 18%'], open: 0, turnD: 1000, turnP: 0, oneRun: true } },
  { sum: '994018' }, { synth: '994' },
  { row: { k: '999018', name: ['ОСНОВИЦА ЗА', 'ДДВ 18%'], open: 0, turnD: 0, turnP: 1000, oneRun: true } },
  { sum: '999018' }, { synth: '999' }, { group: '99' }, { cls: '9' },
  { grand: true },
];
