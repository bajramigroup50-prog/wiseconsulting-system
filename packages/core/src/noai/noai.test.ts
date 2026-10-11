import { describe, expect, it } from 'vitest';
import { statementFromRead } from '../ai/bank';
import { aiErrCodeOf, aiErrText, aiProviderError, AI_ERR_MSG } from '../ai/errors';
import { obFromAi } from '../finpar-ob';
import { statementFromPdf } from './bank';
import { obFromPdf } from './ob';
import { dateIn, mkNum, numsIn, pdfLines, type PdfItem } from './pdf-lines';
import { invoiceFromPdf } from './purchase';

/** Text items of one page: rows of [x, text], top to bottom (14 pt apart), 5 pt per character. */
const page = (rows: [number, string][][], page = 1, top = 800): PdfItem[] =>
  rows.flatMap((r, i) => r.map(([x, s]) => ({ page, x, y: top - i * 14, w: s.length * 5, h: 9, s })));

describe('PDF text → lines and numbers', () => {
  it('groups items into lines and cells by position', () => {
    const L = pdfLines([...page([[[50, 'Датум'], [200, 'Опис']], [[50, '02.03.2026'], [200, 'Плаќање'], [237, 'фактура']]])]);
    expect(L.map((l) => l.cells.map((c) => c.s))).toEqual([['Датум', 'Опис'], ['02.03.2026', 'Плаќање фактура']]);
  });
  it('reads Macedonian amounts and dates', () => {
    expect(mkNum('1.234,56')).toBe(1234.56);
    expect(mkNum('1,234.56')).toBe(1234.56);
    expect(mkNum('12,50-')).toBe(-12.5);
    expect(mkNum('1.000')).toBe(1000);
    expect(numsIn('основица 1.000,00 ддв 180,00')).toEqual([1000, 180]);
    expect(dateIn('Датум: 5.3.2026 г.')).toBe('2026-03-05');
  });
});

describe('bank statement PDF without AI', () => {
  const items = [
    ...page([
      [[50, 'КОМЕРЦИЈАЛНА БАНКА АД СКОПЈЕ']],
      [[50, 'Извод бр. 105'], [300, 'Сметка: 300-0000012345-67']],
      [[50, 'Претходна состојба:'], [300, '10.000,00']],
      [[50, 'Датум'], [130, 'Налогодавач / примач'], [300, 'Цел на дознака'], [430, 'Должи'], [500, 'Побарува']],
      [[50, '02.03.2026'], [130, 'АЛФА ДООЕЛ'], [300, 'Фактура 12/2026'], [500, '12.500,00']],
      [[130, 'Скопје'], [300, 'доплата']],
      [[50, '03.03.2026'], [130, 'Т-Мобиле'], [300, 'Телефон'], [430, '1.234,56']],
      [[50, 'Вкупно'], [430, '1.234,56'], [500, '12.500,00']],
      [[50, 'Нова состојба:'], [300, '21.265,44']],
    ]),
  ];
  it('finds the transaction table, continuation lines and balances', () => {
    const st = statementFromPdf(pdfLines(items))!;
    expect(st).toMatchObject({ number: '105', account: '300000001234567', openingBalance: 10000, closingBalance: 21265.44, balanced: true });
    expect(st.items).toEqual([
      expect.objectContaining({ date: '2026-03-02', name: 'АЛФА ДООЕЛ Скопје', amount: 12500 }),
      expect.objectContaining({ date: '2026-03-03', name: 'Т-Мобиле', amount: -1234.56 }),
    ]);
    expect(st.items![0]!.purpose).toBe('Фактура 12/2026 доплата');
    // the bank screen maps it like an AI read
    expect(statementFromRead(st)!.lines.map((l) => l.amount)).toEqual([1250000, -123456]);
  });
  it('a PDF without a transaction table gives null', () => {
    expect(statementFromPdf(pdfLines(page([[[50, 'Нема ништо']]])))).toBeNull();
  });
});

describe('trial balance PDF without AI', () => {
  it('two-row header (Салдо → Должи / Побарува) through the opening-balance parser', () => {
    const L = pdfLines(page([
      [[50, 'БРУТО БИЛАНС 2025']],
      [[50, 'Конто'], [120, 'Назив'], [400, 'Салдо']],
      [[380, 'Должи'], [460, 'Побарува']],
      [[50, '1000'], [120, 'Жиро сметка'], [380, '50.000,00']],
      [[50, '1200'], [120, 'Купувачи'], [380, '12.000,00']],
      [[50, '9000'], [120, 'Капитал'], [460, '62.000,00']],
    ]));
    const r = obFromPdf(L)!;
    expect(r.rows).toEqual([['1000', 'Жиро сметка', '', '', 50000, 0], ['1200', 'Купувачи', '', '', 12000, 0], ['9000', 'Капитал', '', '', 0, 62000]]);
    expect(obFromAi(r, { full: true }).rows).toHaveLength(3);
  });
});

describe('invoice PDF without AI', () => {
  it('reads number, dates, supplier ЕДБ and the VAT recapitulation', () => {
    const L = pdfLines(page([
      [[50, 'ДОБАВУВАЧ ДООЕЛ Скопје, ЕДБ: MK4030999000111']],
      [[50, 'Купувач: НАША ФИРМА ДОО, ЕДБ 4030000000001']],
      [[50, 'ФАКТУРА бр. 123/2026']],
      [[50, 'Датум на фактура: 15.09.2026'], [300, 'Валута: 15.10.2026']],
      [[50, 'Рекапитулација'], [200, 'Основица'], [300, 'ДДВ']],
      [[50, 'ДДВ 18%'], [200, '1.000,00'], [300, '180,00']],
      [[50, 'ДДВ 5%'], [200, '200,00'], [300, '10,00']],
      [[50, 'Вкупно за плаќање:'], [300, '1.390,00']],
    ]));
    expect(invoiceFromPdf(L, { ownEdb: '4030000000001' })).toEqual({
      number: '123/2026', date: '2026-09-15', dueDate: '2026-10-15', supplierEdb: '4030999000111',
      groups: [{ rate: 18, base: 1000, vat: 180, kind: 'other' }, { rate: 5, base: 200, vat: 10, kind: 'other' }], lines: [], total: 1390,
    });
  });
  it('no recapitulation: the total is split with the printed rate', () => {
    const L = pdfLines(page([[[50, 'Фактура број F-77']], [[50, 'Датум: 01.02.2026']], [[50, 'Сите цени се со ДДВ 18%']], [[50, 'Вкупно за плаќање'], [300, '1.180,00']]]));
    expect(invoiceFromPdf(L)!.groups).toEqual([{ rate: 18, base: 1000, vat: 180, kind: 'other' }]);
  });
});

describe('AI provider errors → clear messages', () => {
  it('credit balance exhausted', () => {
    const raw = '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}';
    const e = Object.assign(new Error(raw), { status: 400 });
    expect(aiProviderError(e)).toMatchObject({ code: 'credit', msg: AI_ERR_MSG.credit });
    expect(aiErrText(raw)).toBe(AI_ERR_MSG.credit);
    expect(aiErrCodeOf(AI_ERR_MSG.credit)).toBe('credit');
  });
  it('key, rate limit, overload, timeout', () => {
    expect(aiProviderError(Object.assign(new Error('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'), { status: 401 }))?.code).toBe('auth');
    expect(aiProviderError(Object.assign(new Error('429 rate_limit_error'), { status: 429 }))?.code).toBe('rate');
    expect(aiProviderError(Object.assign(new Error('529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'), { status: 529 }))?.code).toBe('overloaded');
    const t = new Error('Request timed out.'); t.name = 'APIConnectionTimeoutError';
    expect(aiProviderError(t)?.code).toBe('timeout');
  });
  it('own errors are not provider errors; stored codes win', () => {
    expect(aiProviderError(new Error('Документот не е прочитан јасно.'))).toBeNull();
    expect(aiErrCodeOf('било што', 'off')).toBe('off');
    expect(aiErrText('Документот не е прочитан јасно.')).toBe('Документот не е прочитан јасно.');
  });
});
