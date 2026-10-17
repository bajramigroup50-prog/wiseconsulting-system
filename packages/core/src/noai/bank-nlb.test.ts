/**
 * НЛБ „DpsStatement“ PDFs read without AI: the glyph-id text of their font is decoded and the five-line table is cut
 * into orders (synthetic fixture with the real layout, `bank-nlb.fixtures.ts`).
 */
import { describe, expect, it } from 'vitest';
import { statementsFromRead } from '../ai/bank';
import { statementFromPdfItems } from './bank';
import { encodeGlyphText, NLB_ACCOUNT, NLB_STATEMENT, nlbStatementItems } from './bank-nlb.fixtures';
import { nlbDpsGrid } from './bank-nlb';
import { decodeGlyphItems, decodeGlyphText, isGlyphText } from './pdf-glyphs';

describe('glyph-id text (font without ToUnicode)', () => {
  it('decodes Cyrillic, Macedonian letters, digits and punctuation', () => {
    expect(decodeGlyphText('ɋɬɪɚɧɢɰɚ\u0003')).toBe('Страница ');
    expect(decodeGlyphText('ɭɩɥɚɬɚ\u0003ɦɞɛ\u0003\u0013\u0018\u0012\u0015\u0013\u0015\u0019')).toBe('уплата мдб 05/2026');
    expect(decodeGlyphText(encodeGlyphText('Ѓорѓи Ќосе Љубен Њаге Џамија Ѕвезда ј љ њ ќ ѓ ѕ џ: 1,5 - 2.'))).toBe('Ѓорѓи Ќосе Љубен Њаге Џамија Ѕвезда ј љ њ ќ ѓ ѕ џ: 1,5 - 2.');
  });
  it('leaves real text alone', () => {
    for (const s of ['Број на извод: 77', '210-0000123456-52', '[AutoProv]', 'PT-2026-15', 'ɐ']) expect(decodeGlyphText(s)).toBe(s === 'ɐ' ? 'Ц' : s);
    expect(isGlyphText('Извод бр. 12')).toBe(false);
    const I = [{ page: 1, x: 0, y: 0, w: 1, s: 'Износ' }];
    expect(decodeGlyphItems(I)).toBe(I);
  });
});

describe('НЛБ DpsStatement layout', () => {
  it('grid: statement data and one row per order', () => {
    const G = nlbDpsGrid(nlbStatementItems())!;
    expect(G.count).toBe(4);
    expect(G.grid.slice(0, G.hi).flat()).toEqual(expect.arrayContaining(['Број на извод: 77', 'Претходна состојба: 100.000,00', 'Нова состојба: 110.205,00', 'Вкупно задолжување: 14.795,00', 'Вкупно одобрување: 25.000,00']));
    expect(G.grid.slice(G.hi + 1)).toEqual([
      ['1', 'МИНИСТЕРСТВО ЗА ФИНАНСИИ', '100-0000000630-95', '930', 'данок на добивка 02/2026', '84018201234 71111200', '12.345,00', ''],
      ['2', 'НЛБ Банка- Провизии', '210-0000999888-38', '666', '[AutoProv] Месечна провизија за водење сметка 01.02.26-28.02.26', NLB_ACCOUNT, '450,00', ''],
      ['3', 'ПРИМЕР ТРЕЈД ДООЕЛ Скопје', '300-0000555111-96', '220', 'ПО Ф-РА PT-2026-15', '330-0000012345', '2.000,00', ''],
      ['4', 'КЛИЕНТ ПРИМЕР ДООЕЛ Скопје подружница', '270-0000777222-04', '220', 'ПО Ф-РА INV-0042', 'INV-0042', '', '25.000,00'],
    ]);
  });

  it('reads and reconciles: number, date, account, balances, every line', () => {
    const st = statementFromPdfItems(nlbStatementItems())!;
    expect(st).toMatchObject({ number: NLB_STATEMENT.no, account: NLB_ACCOUNT, currency: 'MKD', openingBalance: NLB_STATEMENT.opening, closingBalance: NLB_STATEMENT.closing, totalDebit: NLB_STATEMENT.debit, totalCredit: NLB_STATEMENT.credit, balanced: true });
    expect(st.warnings).toBeUndefined();
    expect(st.blocking).toBeUndefined();
    expect(st.items!.map((l) => [l.date, l.name, l.account, l.code, l.amount])).toEqual([
      ['2026-03-02', 'МИНИСТЕРСТВО ЗА ФИНАНСИИ', '100000000063095', '930', -12345],
      ['2026-03-02', 'НЛБ Банка- Провизии', '210000099988838', '666', -450],
      ['2026-03-02', 'ПРИМЕР ТРЕЈД ДООЕЛ Скопје', '300000055511196', '220', -2000],
      ['2026-03-02', 'КЛИЕНТ ПРИМЕР ДООЕЛ Скопје подружница', '270000077722204', '220', 25000],
    ]);
    // the read maps to the import's statement like any read
    const [S] = statementsFromRead(JSON.parse(JSON.stringify(st)));
    expect(S).toMatchObject({ no: '77', account: NLB_ACCOUNT, opening: 10000000, closing: 11020500 });
  });

  it('an order that is not read is a blocking problem (the count printed under the table)', () => {
    const I = nlbStatementItems().filter((it) => it.s !== '25.000,00' || it.y !== 537.8);
    const st = statementFromPdfItems(I)!;
    expect(st.balanced).toBe(false);
    expect(st.blocking?.join(' ')).toMatch(/Прочитани се 3 ставки, а во изводот пишува 4 налози/);
  });

  it('other layouts are not taken', () => {
    expect(nlbDpsGrid([{ page: 1, x: 0, y: 10, w: 40, s: 'Датум' }, { page: 1, x: 50, y: 10, w: 40, s: 'Износ' }])).toBeNull();
  });
});
