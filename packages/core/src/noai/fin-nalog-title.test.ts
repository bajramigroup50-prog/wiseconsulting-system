import { describe, expect, it } from 'vitest';
import { finNalogsFromLines, finNalogJournalGrid } from './fin-nalog';
import type { PdfLine } from './pdf-lines';

const line = (y: number, ...c: [number, string][]): PdfLine => ({ page: 1, y, cells: c.map(([x0, s]) => ({ x0, x1: x0 + s.length * 4, s })) }) as unknown as PdfLine;

describe('„Финансов налог“: number and name of every nalog', () => {
  it('reads „6/1-3“ and „IZVODI“ → ИЗВОДИ (not „Увезен налог“)', () => {
    const L = [
      line(800, [36, 'Finansov nalog broj'], [197, '6/1-3']),
      line(790, [36, 'Od 31/03/2026'], [197, 'IZVODI'], [479, 'Strana 1']),
      line(780, [36, 'Br.'], [60, 'Datum'], [100, 'KONTO'], [183, 'Dol`i'], [278, 'Pobaruva'], [330, 'Komitent'], [396, 'Sodr`ina']),
      line(770, [30, '1 22/01/2026 1000'], [183, '100.00']),
      line(760, [30, '2 22/01/2026 1039'], [278, '100.00']),
      line(750, [39, 'SALDO'], [203, '100.00'], [297, '100.00']),
    ];
    const F = finNalogsFromLines(L);
    expect(F[0]).toEqual(expect.objectContaining({ number: '6/1-3', title: 'ИЗВОДИ' }));
    expect(finNalogJournalGrid(F)[1]!.slice(2, 4)).toEqual(['6/1-3', 'ИЗВОДИ']);
  });
});
