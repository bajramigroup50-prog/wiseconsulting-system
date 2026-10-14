import { describe, expect, it } from 'vitest';
import { finNalogFromLines, finNalogGrid } from './fin-nalog';
import { obFromPdf } from './ob';
import type { PdfLine } from './pdf-lines';

// synthetic „Финансов налог“ in the old program's layout (YUSCII Latin headings, x positions as printed)
const ln = (y: number, ...cells: [number, string][]): PdfLine => ({ page: 1, y, cells: cells.map(([x, s]) => ({ x0: x, x1: x + s.length * 4, s })) });
const L: PdfLine[] = [
  ln(790, [41, 'DEMO FIRMA DOOEL']),
  ln(726, [36, 'Finansov nalog broj'], [201, '00126']),
  ln(707, [36, 'Od 01/01/2026'], [479, 'Strana 1']),
  ln(692, [396, 'Sodr`ina'], [460, 'Izv.'], [488, 'Dok. (Kalk. Br.)']),
  ln(683, [37, 'Br.'], [57, 'Datum'], [102, 'KONTO'], [153, 'Dol`i'], [213, 'Pobaruva'], [294, 'Komitent'], [389, '(Faktura broj)']),
  ln(672, [48, '1 01/01/2026 0030'], [155, '200,000.00'], [242, '0.00'], [364, 'САЛДО'], [487, 'O']),
  ln(649, [48, '2 01/01/2026 0192'], [180, '0.00'], [217, '150,000.00'], [364, 'САЛДО'], [487, 'O']),
  ln(637, [48, '3 01/01/2026 1200'], [226, '4,312.00 24'], [487, 'O']),
  ln(636, [281, 'ДРИТОН КОМЕРЦ'], [364, 'П.С.2026 ДРИТОН']),
  ln(635, [180, '0.00']),
  ln(620, [44, '4']),
  ln(619, [54, '01/01/2026 1200'], [487, 'O']),
  ln(618, [242, '0.00 1025'], [281, 'НАЦИОНАЛЕН'], [364, 'П.С.2026']),
  ln(616, [160, '35,000.00']),
  ln(600, [48, '5 01/01/2026 9400'], [217, '80,688.00'], [364, 'САЛДО']),
  ln(598, [180, '0.00']),
  ln(344, [384, 'Saldo']),
  ln(343, [183, 'Dol`i'], [278, 'Pobaruva']),
  ln(328, [39, 'SALDO'], [198, '235,000.00'], [293, '235,000.00'], [423, '0.00']),
];

describe('„Финансов налог“ of the old program, without AI', () => {
  it('cuts records by the row number, splits amount + partner code, checks against the printed totals', () => {
    const r = finNalogFromLines(L)!;
    expect(r.number).toBe('00126');
    expect(r.date).toBe('2026-01-01');
    expect(r.rows).toEqual([
      ['0030', 'САЛДО', '', '', 200000, 0],
      ['0192', 'САЛДО', '', '', 0, 150000],
      ['1200', 'П.С.2026 ДРИТОН', 'ДРИТОН КОМЕРЦ', '24', 0, 4312],
      ['1200', 'П.С.2026', 'НАЦИОНАЛЕН', '1025', 35000, 0],
      ['9400', 'САЛДО', '', '', 0, 80688],
    ]);
    expect(r.sum).toEqual([235000, 235000]);
    expect(r.printed).toEqual([235000, 235000]);
    expect(r.balanced).toBe(true);
    expect(finNalogGrid(r)[0]).toEqual(['Конто', 'Назив на конто', 'Комитент', 'Шифра на комитент / ЕДБ', 'Салдо должи', 'Салдо побарува']);
  });
  it('a wrong amount is not balanced; the opening reader uses it', () => {
    const bad = L.map((l) => (l.y === 616 ? ln(616, [160, '36,000.00']) : l));
    expect(finNalogFromLines(bad)!.balanced).toBe(false);
    const o = obFromPdf(L)!;
    expect(o.balanced).toBe(true);
    expect(o.rows).toHaveLength(5);
  });
  it('other documents are not claimed', () => {
    expect(finNalogFromLines([ln(700, [40, 'Бруто биланс']), ln(680, [40, 'Конто'], [120, 'Салдо'])])).toBeNull();
  });
});
