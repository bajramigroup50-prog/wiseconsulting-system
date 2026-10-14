/**
 * The old program's „Бруто биланс со аналитика“ PDF (synthetic fixture with the real layout, `tb-analitika.fixtures.ts`).
 * Production failure: a 39-page export returned null from `obFromPdf` (the heading has no „должи / салдо“ on the
 * „Конто“ line), the free read failed and AI then refused the file as too large.
 */
import { describe, expect, it } from 'vitest';
import { convBlocks, convGuess, convTarget } from '../convert/index';
import { tbPreferredBlock } from '../tb-rows';
import { obFromPdf } from './ob';
import { pdfAutoGrid, pdfLines, type PdfLine } from './pdf-lines';
import { tbAnalitika, yusciiDecode } from './tb-analitika';
import { TBA_STEPS, tbaFixtureItems, type FxStep } from './tb-analitika.fixtures';

const lines = (o?: { encode?: boolean }) => pdfLines(tbaFixtureItems(TBA_STEPS, o));

describe('tbAnalitika (Бруто биланс со аналитика)', () => {
  it('reads one row per analytic konto + partner, every printed total reconciles', () => {
    const R = tbAnalitika(lines())!;
    expect(R).not.toBeNull();
    expect(R.bad).toEqual([]);
    expect(R.rowBad).toEqual([]);
    expect(R.ok).toBe(true);
    expect(R.period).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect([R.pages, R.pagesTotal]).toEqual([3, 3]);
    expect(R.rows.map((r) => r.k)).toEqual(['0121', '0192', '100002', '13001811', '1200', '1200', '1200', '2200', '2400', '4000', '7000', '994018', '999018']);
    const by = (i: number) => R.rows[i]!;
    // leading zeros kept, names joined (also the line printed over „Сумарно за“ and the one below it)
    expect(by(0)).toMatchObject({ k: '0121', name: 'ОПРЕМА', open: 735657, close: 735657, code: '', partner: '' });
    expect(by(1)).toMatchObject({ name: 'АКУМУЛИРАНА АМОРТИЗАЦИЈА НА ПОСТРОЈКИ И ОПРЕМА', open: -591411, totP: 591411, close: -591411 });
    // konto and name in one run; Latin „j“ in a Cyrillic word → „ј“
    expect(by(2)).toMatchObject({ k: '100002', name: 'ЖИРО СМЕТКА КОМЕРЦИЈАЛНА БАНКА', open: 281568, turnD: 4688477, turnP: 4877717, totD: 4970045, totP: 4877717, close: 92328 });
    // konto wrapped onto the next line, the last name line glued to the total's label
    expect(by(3)).toMatchObject({ k: '13001811', name: 'ДДВ ПРИ УВОЗ НА ВЛЕЗНИ ФАКТУРИ 18%', close: 0 });
    // names of a row running below the next row's first line stay with their row; partner code + name
    expect(by(4)).toMatchObject({ name: 'ПОБАРУВАЊЕ ОД КУПУВАЧИ ОД ПРОДАЖБА НА ДОБРА', code: '0589', partner: 'АВТО ШКОЛА АРТ ДООЕЛ САРАЈ', close: 4000 });
    expect(by(5)).toMatchObject({ name: 'ПОБАРУВАЊЕ ОД КУПУВАЧИ ОД ПРОДАЖБА НА ДОБРА', code: '0899', partner: 'ФКСР-АЛДИ ДООЕЛ', open: -3700, close: -3700 });
    // page 2 after the repeated header; code glued to the name
    expect(by(6)).toMatchObject({ code: '0020', partner: 'ТОИТОУРЕ ПЕЕТЕРС СПРЛ', page: 2, close: 1000 });
    expect(R.grand).toMatchObject({ open: 210240, close: 0, totD: R.grand!.totP });
    expect(R.totals.filter((t) => t.level === 'class').map((t) => t.k)).toEqual(['0', '1', '2', '4', '7', '9']);
  });

  it('obFromPdf: closing saldo → debit / credit, carry rules for the next year, accepted without AI', () => {
    const O = obFromPdf(lines())!;
    expect(O.balanced).toBe(true);
    expect(O.warnings).toEqual([]);
    expect(O.source).toBe('tb-analitika');
    // zero closing (13001811) is not a row; negative closing = credit
    expect(O.rows).toContainEqual(['0192', 'АКУМУЛИРАНА АМОРТИЗАЦИЈА НА ПОСТРОЈКИ И ОПРЕМА', '', '', 0, 591411]);
    expect(O.rows).toContainEqual(['1200', 'ПОБАРУВАЊЕ ОД КУПУВАЧИ ОД ПРОДАЖБА НА ДОБРА', 'ФКСР-АЛДИ ДООЕЛ', '0899', 0, 3700]);
    expect(O.rows.some((r) => r[0] === '13001811')).toBe(false);
    expect(O.rows).toHaveLength(12);
    // opening: classes 0/1/2 (and non-statistical 9), Σ D vs Σ P = the unclosed result of classes 4 / 7
    expect(O.opening).toMatchObject({ date: '2026-01-01', n: 8, D: 832985, P: 802985, diff: 30000, balanced: false });
    expect(O.opening!.excluded.map((x) => [x.k, x.d, x.p])).toEqual([['4000', 50000, 0], ['7000', 0, 80000], ['994018', 1000, 0], ['999018', 0, 1000]]);
    expect(O.opening!.excluded[0]!.why).toMatch(/класа 4/);
    expect(O.opening!.excluded[2]!.why).toMatch(/статистичка/);
    // printed synthetic totals for the screen's control (statistical ones left out)
    expect(O.totals).toContainEqual(['019', 0, 591411]);
    expect(O.totals.some((t) => t[0] === '994')).toBe(false);
    expect(O.check).toMatchObject({ rows: 13, pages: 3, pagesTotal: 3, grandClose: 0 });
  });

  it('the old 8-bit font (YUSCII „Po~etna“, „Dol`i“, „POBARUVAWE“) gives the same rows in Cyrillic', () => {
    const A = tbAnalitika(lines())!, B = tbAnalitika(lines({ encode: true }))!;
    expect(B.decoded).toBe(true);
    expect(B.ok).toBe(true);
    expect(B.rows).toEqual(A.rows);
    expect(yusciiDecode('POBARUVAWE OD KUPUVA^I, Dol`i, Po~etna, ]EMAQ, \\OKO, [TIP')).toBe('ПОБАРУВАЊЕ ОД КУПУВАЧИ, Должи, Почетна, ЌЕМАЉ, ЃОКО, ШТИП');
  });

  it('konto alone on its line with the amounts line 2–3 pt lower (not merged into one line)', () => {
    const L = lines();
    const split: PdfLine[] = [];
    for (const l of L) {
      const c0 = l.cells[0];
      if (c0 && /^\d{3,10}$/.test(c0.s) && c0.x0 < 40 && l.cells.length > 3) {
        split.push({ ...l, cells: [c0] }, { ...l, y: l.y - 2.6, cells: l.cells.slice(1) });
      } else split.push(l);
    }
    const R = tbAnalitika(split)!;
    expect(R.ok).toBe(true);
    expect(R.rows).toEqual(tbAnalitika(L)!.rows);
  });

  it('a printed total that does not match → not balanced, with the reason', () => {
    const steps: FxStep[] = TBA_STEPS.map((s) => s);
    const items = tbaFixtureItems(steps);
    // corrupt the „Класа 0“ closing amount
    const i = items.findIndex((x) => x.s === 'Класа 0');
    const cl = items.filter((x) => x.page === items[i]!.page && x.y === items[i]!.y && /\d,\d{3}\.\d\d$/.test(x.s));
    cl[cl.length - 1]!.s = '144,247.00';
    const O = obFromPdf(pdfLines(items))!;
    expect(O.balanced).toBe(false);
    expect(O.warnings!.join('\n')).toMatch(/Класа 0.*крајно салдо во документот 144247, прочитано 144246/);
  });

  it('missing pages (fewer read than „Стр. N од M“) → not balanced', () => {
    const items = tbaFixtureItems(TBA_STEPS).filter((x) => x.page < 3);
    const O = obFromPdf(pdfLines(items))!;
    expect(O.balanced).toBe(false);
    expect(O.warnings!.join('\n')).toMatch(/2 од 3 страници|ВКУПНО/);
  });

  it('40 pages parse fast', () => {
    const page: FxStep[] = [];
    for (let i = 0; i < 12; i++) page.push({ row: { k: '1200', name: ['ПОБАРУВАЊЕ', 'ОД КУПУВАЧИ'], partner: [`${1000 + i} КУПУВАЧ ${i}`, 'ДООЕЛ'], open: 100 + i, turnD: 10, turnP: 5 } });
    const steps: FxStep[] = [];
    for (let p = 0; p < 40; p++) { steps.push(...page); if (p < 39) steps.push({ pageBreak: true }); }
    steps.push({ sum: '1200' }, { synth: '120' }, { group: '12' }, { cls: '1' }, { grand: true });
    const items = tbaFixtureItems(steps);
    const t0 = Date.now();
    const R = tbAnalitika(pdfLines(items))!;
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(R.rows).toHaveLength(480);
    expect(R.bad).toEqual([]);
    expect(R.pages).toBe(40);
  });

  it('converter grid: opening / turnover / cumulative / closing blocks, closing saldo preferred', () => {
    const G = pdfAutoGrid(lines());
    expect(G[0]).toEqual(['Конто', 'Опис', 'Почетна состојба должи', 'Почетна состојба побарува', 'Промет должи', 'Промет побарува',
      'Вкупно должи', 'Вкупно побарува', 'Крајно салдо должи', 'Крајно салдо побарува', 'Шифра на комитент', 'Комитент']);
    expect(G).toHaveLength(14);
    const t = convTarget('ob')!;
    const B = convBlocks(t, G[0]!);
    expect(B.map((b) => b.id)).toEqual(['open', 'turn', 'total', 'saldo']);
    expect(tbPreferredBlock(B)!.id).toBe('saldo');
    const map = convGuess(t, G[0]!, G.slice(1));
    expect([map.konto, map.debit, map.credit]).toEqual([0, 8, 9]);
    expect(G[2]).toEqual(['0192', 'АКУМУЛИРАНА АМОРТИЗАЦИЈА НА ПОСТРОЈКИ И ОПРЕМА', '', '591411.00', '', '', '', '591411.00', '', '591411.00', '', '']);
  });

  it('other trial balances are not taken for this layout', () => {
    const L = pdfLines([
      { page: 1, x: 30, y: 700, w: 30, h: 8, s: 'Конто' }, { page: 1, x: 100, y: 700, w: 30, h: 8, s: 'Назив' },
      { page: 1, x: 300, y: 700, w: 30, h: 8, s: 'Должи' }, { page: 1, x: 400, y: 700, w: 30, h: 8, s: 'Побарува' },
      { page: 1, x: 30, y: 680, w: 20, h: 8, s: '1000' }, { page: 1, x: 100, y: 680, w: 40, h: 8, s: 'Жиро сметка' },
      { page: 1, x: 300, y: 680, w: 30, h: 8, s: '1.000,00' }, { page: 1, x: 400, y: 680, w: 30, h: 8, s: '0,00' },
    ]);
    expect(tbAnalitika(L)).toBeNull();
    expect(obFromPdf(L)!.rows).toEqual([['1000', 'Жиро сметка', '', '', 1000, 0]]);
  });
});
