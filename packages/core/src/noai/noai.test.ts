import { describe, expect, it } from 'vitest';
import { statementFromRead } from '../ai/bank';
import { aiErrCodeOf, aiErrText, aiProviderError, AI_ERR_MSG } from '../ai/errors';
import { obFromAi } from '../finpar-ob';
import { statementFromPdf } from './bank';
import { obFromPdf } from './ob';
import { dateIn, mkNum, numsIn, pdfLines, type PdfItem } from './pdf-lines';
import { invoiceFromPdf, invoiceNoIn, notInvoiceNo } from './purchase';
import { invoicePrintHtml } from '../sales/invoice-print';

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
  // the text of an invoice printed by WISE itself (`invoicePrintHtml`): the firm head with „Жиро сметка“ comes before
  // the title „ФАКТУРА“ and the „Број | …“ cell
  const wise = (bank: string, twoCol = false) => pdfLines(page(twoCol ? [
    [[50, 'ДЕМО ТРГОВИЈА ДООЕЛ'], [400, 'ФАКТУРА']],
    [[50, 'бул. Партизански одреди 100'], [400, 'Број'], [470, '0042/2026']],
    [[50, 'ЕДБ: 4030026777001 · ЕМБС: 7777001'], [400, 'Датум'], [470, '05.10.2026']],
    [[50, `Жиро сметка: ${bank} · Комерцијална банка`], [400, 'Рок на плаќање'], [470, '04.11.2026']],
    [[50, 'Купувач'], [300, 'Повикување на број: 0042/2026']],
    [[50, 'ДЕМО ХОТЕЛ ДОО Охрид, ЕДБ: 4020026700014']],
    [[50, 'Стапка'], [200, 'Основица'], [300, 'ДДВ']],
    [[50, '18%'], [200, '8.500,00'], [300, '1.530,00']],
    [[50, 'ЗА ПЛАЌАЊЕ'], [300, '10.030,00 ден.']],
  ] : [
    [[50, 'ДЕМО ТРГОВИЈА ДООЕЛ']],
    [[50, 'бул. Партизански одреди 100']],
    [[50, 'ЕДБ: 4030026777001 · ЕМБС: 7777001']],
    [[50, 'Тел.: 02 3200 200 · info@demo-trgovija.mk']],
    [[50, `Жиро сметка: ${bank} · Комерцијална банка`]],
    [[50, 'ФАКТУРА']],
    [[50, 'Број'], [150, '0042/2026']],
    [[50, 'Датум'], [150, '05.10.2026']],
    [[50, 'Датум на промет'], [150, '05.10.2026']],
    [[50, 'Рок на плаќање'], [150, '04.11.2026']],
    [[50, 'Купувач']],
    [[50, 'ДЕМО ХОТЕЛ ДОО Охрид']],
    [[50, 'ЕДБ: 4020026700014']],
    [[50, 'Повикување на број: 0042/2026']],
    [[50, 'Стапка'], [200, 'Основица'], [300, 'ДДВ']],
    [[50, '18%'], [200, '8.500,00'], [300, '1.530,00']],
    [[50, 'Износ без ДДВ'], [300, '8.500,00']],
    [[50, 'ЗА ПЛАЌАЊЕ'], [300, '10.030,00 ден.']],
    [[50, `Плаќање до 04.11.2026 на жиро сметка ${bank} кај Комерцијална банка, со повикување на број 0042/2026.`]],
  ]));
  it('an invoice printed by WISE: the number is „Број“, never the жиро сметка (valid, invalid control, IBAN)', () => {
    for (const bank of ['300000000777006', '300000000777001', '300-0000007770-06', 'MK07 3000 0000 0777 006']) {
      for (const two of [false, true]) {
        const r = invoiceFromPdf(wise(bank, two), { ownEdb: '4020026700014' })!;
        expect(r.number, `${bank} ${two}`).toBe('0042/2026');
        expect(r).toMatchObject({ date: '2026-10-05', supplierEdb: '4030026777001', total: 10_030 });
      }
    }
  });
  it('the print template itself (`invoicePrintHtml`) read back as text lines', () => {
    const html = invoicePrintHtml({
      kind: 'invoice',
      doc: { kind: 'invoice', number: '0042/2026', date: '2026-10-05', due: '2026-11-04', currency: 'MKD', fx: 1, note: null, data: null },
      firm: { name: 'ДЕМО ТРГОВИЈА ДООЕЛ', address: 'бул. Партизански одреди 100', city: 'Скопје', edb: '4030026777001', embs: '7777001', vatRegistered: true, settings: { bank: '300000000777006', bankName: 'Комерцијална банка' } },
      partner: { name: 'ДЕМО ХОТЕЛ ДОО Охрид', city: 'Охрид', edb: '4020026700014' },
      lines: [{ name: 'Кафе', qty: 10, price: 850, disc: 0, rate: 18, unit: 'kg' }],
    });
    // rows of cells as a PDF text layer gives them: block ends are new lines, table cells sit side by side
    const rows = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<(br|\/div|\/tr|\/p|\/h\d)[^>]*>/gi, '\n').replace(/<\/t[dh]>/gi, '\t')
      .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').split('\n')
      .map((r) => r.split('\t').map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean)).filter((r) => r.length)
      .map((r) => r.map((c, i): [number, string] => [50 + i * 120, c]));
    expect(rows.some((r) => r.some(([, c]) => c.includes('Жиро сметка: 300000000777006')))).toBe(true);
    const r = invoiceFromPdf(pdfLines(page(rows)), { ownEdb: '4020026700014' })!;
    expect(r).toMatchObject({ number: '0042/2026', date: '2026-10-05', supplierEdb: '4030026777001', total: 10_030 });
  });
  it('the number comes from the label, not from accounts / ЕДБ / ЕМБС / dates', () => {
    expect(invoiceNoIn(['Жиро сметка: 300000000777006', 'Фактура бр. 15/2026'])).toBe('15/2026');
    expect(invoiceNoIn(['IBAN: MK07300000000777006', 'Број на фактура: F-77'])).toBe('F-77');
    expect(invoiceNoIn(['ФАКТУРА', 'ЕДБ: MK4030026777001', 'Фактура број', '2026-0815'])).toBe('2026-0815');
    expect(invoiceNoIn(['Сметка бр. 300000000777006', 'Invoice no. INV-9'])).toBe('INV-9');
    expect(invoiceNoIn(['ЕМБС: 7777001', 'Фактура 7777001', 'Број 12'])).toBe('12');
    expect(invoiceNoIn(['ФАКТУРА бр. 5'])).toBe('5');
    expect(invoiceNoIn(['Сметка-фактура бр. 0099'])).toBe('0099');
    expect(invoiceNoIn(['Фактура', 'Жиро сметка 300000000777001'])).toBe('');
    expect(notInvoiceNo('300000000777006')).toBe(true);
    expect(notInvoiceNo('MK07 3000 0000 0777 006')).toBe(true);
    expect(notInvoiceNo('MK4030026777001')).toBe(true);
    expect(notInvoiceNo('4030026777001')).toBe(true);
    expect(notInvoiceNo('05.10.2026')).toBe(true);
    expect(notInvoiceNo('7777001', 'ЕМБС: 7777001')).toBe(true);
    expect(notInvoiceNo('7777001')).toBe(false);
    expect(notInvoiceNo('0042/2026')).toBe(false);
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
