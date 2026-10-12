/**
 * Trial balance / opening journal layouts of other programs through all three paths (converter, Excel / CSV import
 * `parseOpeningSheet`, PDF text without AI) — synthetic fixtures for: amounts on their own line (PDF baseline offset,
 * two-line Excel rows), wrapped names, class headings, subtotals, repeated page headers, embedded konto, analytic
 * suffix, multi-block columns, MK and dot-decimal numbers, parentheses / trailing-minus negatives.
 */
import { describe, expect, it } from 'vitest';
import { convApply, convBlocks, convCheck, convGuess, convHeads, convHeaderRow, convTarget, convTotals } from './convert/index';
import { buildOpening, parseOpeningSheet } from './ledger';
import { obFromPdf } from './noai/ob';
import { pdfAutoGrid, pdfLines, type PdfItem } from './noai/pdf-lines';
import { kontoParse, partnerSplit, tbBlocks, tbRebuild, tbTotals } from './tb-rows';

/* ------------------------------------------------------------------ the user's opening journal (Финансов налог) */

const FIRM = [['БАЈРАМИ ГРОУП ДООЕЛ'], ['ул. Илинденска бр. 1, Тетово'], ['Жиро сметка 300000000000000 Банка Стопанска ЕДБ: MK4082015515270'], ['Финансов налог број 00126'], ['Од 01/01/2026']];
const JHEAD = ['Бр.', 'Датум', 'КОНТО', 'Должи', 'Побарува', 'Комитент', 'Содржина (Фактура број)', 'Изв. Бр', 'Док. (Калк. Бр.) + забелешка'];
/** [Бр, konto, debit, credit, partner, content] — dot-decimal numbers with comma thousands, as printed. */
const JROWS: [string, string, string, string, string, string][] = [
  ['1', '0030', '200,000.00', '0.00', '', 'САЛДО'],
  ['2', '0121', '4.00', '0.00', '', 'САЛДО'],
  ['3', '0192', '0.00', '591,411.00', '', 'САЛДО'],
  ['4', '100002', '92,328.00', '0.00', '', 'САЛДО'],
  ['5', '1000051', '313,091.00', '0.00', '', 'САЛДО'],
  ['8', '1200', '0.00', '6,000.00', '1029 МАЈАНЦЕ', 'П.С.2026 МАЈАНЦЕ ТРА'],
  ['13', '1200', '0.00', '4,312.00', '24 ДРИТОН КОМЕРЦ', 'П.С.2026 ДРИТОН'],
  ['32', '1200', '0.00', '3,700.00', '0899 ФКСР-АЛДИ', 'П.С.2026 ФКСР'],
];
const J_EXPECT = [
  ['0030', '', '', '', 200000, 0], ['0121', '', '', '', 4, 0], ['0192', '', '', '', 0, 591411], ['100002', '', '', '', 92328, 0],
  ['1000051', '', '', '', 313091, 0], ['1200', '', 'МАЈАНЦЕ', '1029', 0, 6000], ['1200', '', 'ДРИТОН КОМЕРЦ', '24', 0, 4312], ['1200', '', 'ФКСР-АЛДИ', '0899', 0, 3700],
];
const jRow = (r: (typeof JROWS)[number]) => [r[0], '01/01/2026', r[1], r[2], r[3], r[4], r[5], '', 'o'];

/** PDF text items: amounts `off` pt below the rest of the row; the firm lines and the heading again on page 2. */
function journalPdf(off: number, pitch = 14): PdfItem[] {
  const X = [30, 60, 120, 180, 260, 340, 440, 580, 630];
  const it = (page: number, x: number, y: number, s: string): PdfItem => ({ page, x, y, w: s.length * 5, h: 9, s });
  const out: PdfItem[] = [];
  const pageTop = (page: number) => {
    let y = 800;
    for (const [s] of FIRM) { out.push(it(page, 30, y, s!)); y -= pitch; }
    out.push(it(page, 500, y, `Страна ${page}`)); y -= pitch;
    JHEAD.forEach((h, i) => out.push(it(page, X[i]!, y, h)));
    return y - pitch;
  };
  let y = pageTop(1);
  JROWS.forEach((r, i) => {
    if (i === 5) y = pageTop(2);
    const c = jRow(r);
    c.forEach((s, j) => { if (s) out.push(it(i < 5 ? 1 : 2, X[j]!, j === 3 || j === 4 ? y - off : y, s)); });
    y -= pitch;
  });
  out.push(it(2, 30, y, 'Вкупно:'), it(2, X[3]!, y - off, '605,423.00'), it(2, X[4]!, y - off, '605,423.00'));
  return out;
}

describe('opening journal export (Финансов налог) — the user\'s layout', () => {
  it('PDF: amounts on a lower baseline join their row; page headers, „Страна 2“ and the total are skipped', () => {
    for (const off of [5, 6]) {
      const r = obFromPdf(pdfLines(journalPdf(off)))!;
      expect(r.rows).toEqual(J_EXPECT);
    }
  });

  it('PDF: amounts further away than a text height (own line) are joined by the row reconstruction', () => {
    const L = pdfLines(journalPdf(9, 20));
    // the lines really are separate here
    expect(L.some((l) => l.cells.length === 2 && /\d/.test(l.cells[0]!.s) && !/\//.test(l.cells.map((c) => c.s).join('')))).toBe(true);
    expect(obFromPdf(L)!.rows).toEqual(J_EXPECT);
  });

  it('converter: PDF grid → Почетна состојба, all rows, partners split, debit = credit, the importer reads it back', () => {
    const g = pdfAutoGrid(pdfLines(journalPdf(5)));
    const hi = convHeaderRow(g);
    expect(g[hi]).toEqual(JHEAD);
    const t = convTarget('ob')!;
    const H = convHeads(g, hi);
    const map = convGuess(t, H.head, g.slice(H.start));
    const res = convApply(t, g.slice(H.start), map, { firstRow: H.start + 1, pre: g.slice(0, hi) });
    expect(res.errors).toEqual([]);
    expect(res.recs.map((r) => [r.konto, r.partner ?? '', r.code ?? '', r.debit, r.credit])).toEqual(J_EXPECT.map((e) => [e[0], e[2], e[3], e[4], e[5]]));
    expect(res.skippedRows.map((x) => x.why)).toEqual(expect.arrayContaining(['наслов', 'збир']));
    const c = convCheck(t, res);
    expect(c.error).toBeUndefined();
    expect(c.diff).toEqual([]);
    expect(convTotals(t, res.recs)).toMatchObject({ D: 605423, P: 605423, balanced: true });
  });

  it('converter: the same PDF as a journal (Налог) — konto, date and amounts per row, balanced', () => {
    const g = pdfAutoGrid(pdfLines(journalPdf(9, 20)));
    const hi = convHeaderRow(g);
    const t = convTarget('imp:journal')!;
    const H = convHeads(g, hi);
    const res = convApply(t, g.slice(H.start), convGuess(t, H.head, g.slice(H.start)), { firstRow: H.start + 1, pre: g.slice(0, hi) });
    expect(res.errors).toEqual([]);
    expect(res.recs.map((r) => [r.date, r.k, r.d, r.p])).toEqual(JROWS.map((r) => ['01.01.2026', r[1], +r[2].replace(/,/g, ''), +r[3].replace(/,/g, '')]));
    expect(convTotals(t, res.recs)).toMatchObject({ balanced: true, D: 605423 });
    expect(convCheck(t, res).error).toBeUndefined();
  });

  it('Excel / CSV of the same table (firm lines above, numbers as text) → Почетна состојба', () => {
    const grid = [...FIRM, JHEAD, ...JROWS.map(jRow), ['', '', 'Вкупно:', '605,423.00', '605,423.00']];
    const P = parseOpeningSheet(grid)!;
    expect(P.rows).toEqual(J_EXPECT);
    const { rows, control } = buildOpening(P, { partners: [{ id: 'p1', name: 'Мајанце ДООЕЛ', code: '1029' }] });
    expect(control.D).toBe(control.P);
    expect(rows.find((r) => r.partnerId === 'p1')).toMatchObject({ account: '1200', credit: 6000 });
    expect(rows.filter((r) => r.partnerName).map((r) => [r.partnerName, r.partnerCode])).toEqual([['ДРИТОН КОМЕРЦ', '24'], ['ФКСР-АЛДИ', '0899']]);
  });

  it('Excel two-line rows (amounts in the row below / above the konto) → same rows', () => {
    const below = [JHEAD, ...JROWS.flatMap((r) => { const c = jRow(r); return [[c[0], c[1], c[2], '', '', c[5], c[6]], ['', '', '', c[3], c[4]]]; })];
    expect(parseOpeningSheet(below)!.rows).toEqual(J_EXPECT);
    const above = [JHEAD, ...JROWS.flatMap((r) => { const c = jRow(r); return [['', '', '', c[3], c[4]], [c[0], c[1], c[2], '', '', c[5], c[6]]]; })];
    expect(parseOpeningSheet(above)!.rows).toEqual(J_EXPECT);
    const t = convTarget('ob')!;
    const res = convApply(t, below.slice(1), convGuess(t, JHEAD, below.slice(1)), { firstRow: 2 });
    expect(res.errors).toEqual([]);
    expect(res.recs).toHaveLength(8);
    expect(res.skippedRows.filter((x) => x.why === 'продолжение')).toHaveLength(8);
  });
});

/* ------------------------------------------------------------------ trial balance (бруто биланс) layouts */

const TB_TOP = [['БРУТО БИЛАНС за 2025'], ['Фирма: АЛФА ДООЕЛ Скопје']];
const TB_HEAD = [['Конто', 'Назив', 'Почетно салдо', '', 'Промет', '', 'Салдо', ''], ['', '', 'Д', 'П', 'Д', 'П', 'Д', 'П']];
const TB = [
  ...TB_TOP, ...TB_HEAD,
  ['Класа 0', 'НЕТЕКОВНИ СРЕДСТВА'],
  ['020', 'Згради', '1.000,00', '', '', '', '1.000,00', ''],
  ['Класа 1'],
  ['1 000', 'Жиро сметка во', '', '', '5.000,00', '3.000,00', '2.000,00', ''],
  ['', 'Стопанска банка'],
  ['10', 'Вкупно парични средства', '', '', '5.000,00', '3.200,00', '1.800,00', ''],
  ['1200-001', 'Купувачи АЛФА', '', '', '500,00', '', '500,00', ''],
  ...TB_TOP, ['Страна 2'], ...TB_HEAD,
  ['1200 Купувачи БЕТА', '', '', '', '700,00', '', '700,00', ''],
  ['', '1300 ДДВ побарување', '', '', '', '', '(300,00)', ''],
  ['100.0', 'Благајна', '', '', '', '', '200,00-', ''],
  ['2200', 'Добавувачи', '', '1.000,00', '', '1.700,00', '', '2.700,00'],
  ['9000', 'Основна главнина', '', '1.000,00', '', '', '', '1.000,00'],
  ['', 'Вкупно', '1.000,00', '2.000,00', '6.200,00', '4.700,00', '3.700,00', '3.700,00'],
];
const TB_EXPECT = [
  ['020', 'Згради', '', '', 1000, 0], ['1000', 'Жиро сметка во Стопанска банка', '', '', 2000, 0], ['1200', 'Купувачи АЛФА', '', '001', 500, 0],
  ['1200', 'Купувачи БЕТА', '', '', 700, 0], ['1300', 'ДДВ побарување', '', '', -300, 0], ['1000', 'Благајна', '', '', -200, 0],
  ['2200', 'Добавувачи', '', '', 0, 2700], ['9000', 'Основна главнина', '', '', 0, 1000],
];

describe('trial balance layouts (Пантеон / Ажур / УЈП-style бруто биланс)', () => {
  it('Excel: multi-block columns → the closing saldo, class headings / subtotals / page headers skipped, two-line names joined', () => {
    const P = parseOpeningSheet(TB)!;
    expect(P.rows).toEqual(TB_EXPECT);
    // the printed group total „10“ is kept as a control total, never as an account
    expect(P.totals).toEqual([['10', 1800, 0]]);
    const { control } = buildOpening(P, { full: true });
    expect(control.bad).toEqual([]);
    expect(control.D).toBe(control.P);
  });

  it('converter: blocks offered for „Користи“, closing saldo by default; skipped rows are listed, not errors', () => {
    const t = convTarget('ob')!;
    const hi = convHeaderRow(TB);
    const H = convHeads(TB, hi);
    expect(H.head.slice(0, 8)).toEqual(['Конто', 'Назив', 'Почетно салдо Д', 'Почетно салдо П', 'Промет Д', 'Промет П', 'Салдо Д', 'Салдо П']);
    expect(convBlocks(t, H.head).map((b) => b.id)).toEqual(['open', 'turn', 'saldo']);
    const data = TB.slice(H.start);
    const map = convGuess(t, H.head, data);
    expect([map.debit, map.credit, map.saldo]).toEqual([6, 7, undefined]);
    const res = convApply(t, data, map, { firstRow: H.start + 1, pre: TB.slice(0, hi) });
    expect(res.errors).toEqual([]);
    expect(res.recs.map((r) => [r.konto, r.name, r.code ?? '', r.debit ?? 0, r.credit ?? 0])).toEqual(TB_EXPECT.map((e) => [e[0], e[1], e[3], e[4], e[5]]));
    const why = res.skippedRows.map((x) => x.why);
    expect(why.filter((w) => w === 'збир')).toHaveLength(2);
    expect(why).toContain('продолжение');
    expect(why).toContain('наслов');
    expect(convTotals(t, res.recs)).toMatchObject({ D: 3700, P: 3700, balanced: true });
    expect(convTotals(t, res.recs)!.byClass.map((c) => c.c)).toEqual(['0', '1', '2', '9']);
    const c = convCheck(t, res);
    expect(c.error).toBeUndefined();
    expect(c.diff).toEqual([]);
    // the user switches to the opening block
    const open = convBlocks(t, H.head).find((b) => b.id === 'open')!;
    const r2 = convApply(t, data, { ...map, debit: open.d, credit: open.p }, { pre: TB.slice(0, hi) });
    expect(r2.recs.map((r) => r.konto)).toEqual(['020', '2200', '9000']);
  });

  it('a synthetic account equal to the sum of its analytic rows is skipped (збир), not imported', () => {
    const t = convTarget('ob')!;
    const G = [['Конто', 'Назив', 'Салдо должи', 'Салдо побарува'], ['120', 'Купувачи', '1.200,00', ''], ['1200', 'Купувачи во земјата', '1.000,00', ''], ['1201', 'Купувачи странство', '200,00', ''], ['9000', 'Капитал', '', '1.200,00']];
    const res = convApply(t, G.slice(1), convGuess(t, G[0]!, G.slice(1)));
    expect(res.recs.map((r) => r.konto)).toEqual(['1200', '1201', '9000']);
    expect(res.skippedRows).toEqual([expect.objectContaining({ why: 'збир', text: expect.stringContaining('120') })]);
  });

  it('account heading with partner rows below (analytic card layout)', () => {
    const G = [['Конто', 'Назив / партнер', 'Шифра', 'Салдо Д', 'Салдо П'], ['1200', 'Купувачи', '', '', ''], ['', 'АЛФА ДООЕЛ', '4030000000011', '1.000,00', ''], ['', 'БЕТА ДОО', '', '500,00', ''], ['9000', 'Капитал', '', '', '1.500,00']];
    expect(parseOpeningSheet(G)!.rows).toEqual([['1200', '', 'АЛФА ДООЕЛ', '4030000000011', 1000, 0], ['1200', '', 'БЕТА ДОО', '', 500, 0], ['9000', 'Капитал', '', '', 0, 1500]]);
  });

  it('no recognisable headings: konto column and amount columns by their values (row numbers are not kontos)', () => {
    const G = [['1', '1000', 'Жиро сметка', '1.500,00', '0,00'], ['2', '2200', 'Добавувачи', '0,00', '1.500,00'], ['3', '1200', 'Купувачи', '250,00', '0,00']];
    expect(parseOpeningSheet(G)!.rows.map((r) => [r[0], r[4], r[5]])).toEqual([['1000', 1500, 0], ['2200', 0, 1500], ['1200', 250, 0]]);
    const t = convTarget('ob')!;
    const map = convGuess(t, ['A', 'B', 'C', 'D', 'E'], G);
    expect([map.konto, map.debit, map.credit]).toEqual([1, 3, 4]);
  });
});

describe('row reconstruction helpers', () => {
  it('konto forms', () => {
    expect(kontoParse('1000')).toEqual({ k: '1000', sub: '', rest: '' });
    expect(kontoParse('100.0').k).toBe('1000');
    expect(kontoParse('1 000').k).toBe('1000');
    expect(kontoParse('1200-001')).toEqual({ k: '1200', sub: '001', rest: '' });
    expect(kontoParse('1000 Жиро сметка')).toEqual({ k: '1000', sub: '', rest: 'Жиро сметка' });
    expect(kontoParse('1200 - Купувачи').rest).toBe('Купувачи');
    expect(kontoParse('0030').k).toBe('0030');
    expect(kontoParse('01.01.2026').k).toBe('');
    expect(kontoParse('01/01/2026').k).toBe('');
    expect(kontoParse('12.500').k).toBe('');
    expect(kontoParse('1.234,56').k).toBe('');
    expect(kontoParse('Вкупно').k).toBe('');
  });
  it('partner code + name', () => {
    expect(partnerSplit('1029 МАЈАНЦЕ')).toEqual({ code: '1029', name: 'МАЈАНЦЕ' });
    expect(partnerSplit('АЛФА ДООЕЛ')).toEqual({ code: '', name: 'АЛФА ДООЕЛ' });
    expect(partnerSplit('2026')).toEqual({ code: '', name: '2026' });
  });
  it('a partner called TOTAL is data, a „Вкупно“ row is a total', () => {
    const R = tbRebuild([['1200', 'TOTAL MK', '100,00'], ['Вкупно', '', '100,00']], { k: 0, partner: 1, amt: [2] });
    expect(R.items.map((x) => x.kind)).toEqual(['data']);
    expect(R.skipped.map((x) => x.why)).toEqual(['збир']);
  });
  it('blocks and totals in cents', () => {
    expect(tbBlocks(['Конто', 'Почетно салдо должи', 'Почетно салдо побарува', 'Салдо должи', 'Салдо побарува']).map((b) => [b.id, b.d, b.p])).toEqual([['open', 1, 2], ['saldo', 3, 4]]);
    expect(tbTotals([{ k: '1000', d: 0.1, p: 0 }, { k: '1001', d: 0.2, p: 0 }, { k: '9000', d: 0, p: 0.3 }])).toMatchObject({ D: 0.3, P: 0.3, balanced: true });
  });
});
