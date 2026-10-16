/**
 * SYNTHETIC text layer of one PDF that holds THREE incoming invoices scanned / exported one after another (the case of
 * a supplier e-mail or a client's „сите фактури за месецот“ in one file):
 *
 *   page 1      invoice 101/2026 of ПРИМЕР ТРЕЈД ДООЕЛ (title „ФАКТУРА бр. 101/2026“), 18 %
 *   pages 2–3   invoice F-2026-0042 of ТЕСТ ДИСТРИБУЦИЈА ДОО („Фактура број: …“), lines on page 2, the header repeated
 *               on page 3 („продолжение“) with the recapitulation 18 % + 5 % and the total
 *   page 4      invoice 77/26 of ПРОБА УСЛУГИ ДООЕЛ („Број на фактура: 77/26“), 10 %
 *
 * Each invoice is internally consistent (base × rate = VAT, Σ groups = „Вкупно за плаќање“). The buyer is always the
 * same firm (ЕДБ 4030000000001). Positions as pdfjs gives them (y from the bottom, 14 pt per row); every name, number,
 * account and amount is invented.
 */
import type { PdfItem } from './pdf-lines';

export const MULTI_OWN_EDB = '4030000000001';

/** What each of the three invoices must read as. */
export const MULTI_INVOICES = [
  { number: '101/2026', date: '2026-10-05', dueDate: '2026-11-04', supplierEdb: '4030999000111', pages: '1', total: 1180, groups: [{ rate: 18, base: 1000, vat: 180 }] },
  { number: 'F-2026-0042', date: '2026-10-06', dueDate: '2026-10-21', supplierEdb: '4030999000222', pages: '2-3', total: 3370, groups: [{ rate: 18, base: 2500, vat: 450 }, { rate: 5, base: 400, vat: 20 }] },
  { number: '77/26', date: '2026-10-08', dueDate: '', supplierEdb: '5030999000333', pages: '4', total: 330, groups: [{ rate: 10, base: 300, vat: 30 }] },
] as const;

type Row = [number, string][];
/** Text items of one page: rows of [x, text] top to bottom, 14 pt apart, ~5 pt per character. */
const page = (p: number, rows: Row[], top = 800): PdfItem[] =>
  rows.flatMap((r, i) => r.map(([x, s]) => ({ page: p, x, y: top - i * 14, w: s.length * 5, h: 9, s })));

const buyer: Row[] = [[[50, 'Купувач: НАША ФИРМА ДОО Скопје']], [[50, 'ЕДБ купувач: 4030000000001']]];
const head = (cells: string[]): Row => cells.map((s, i): [number, string] => [[50, 80, 260, 320, 400, 480][i]!, s]);

/** The three invoices as the PDF's text items (pages 1–4). */
export function multiInvoiceItems(): PdfItem[] {
  return [
    ...page(1, [
      [[50, 'ПРИМЕР ТРЕЈД ДООЕЛ Скопје']],
      [[50, 'ул. Пробна 1, Скопје · ЕДБ: MK4030999000111']],
      [[50, 'Жиро сметка: 300000000111222 · Пример банка']],
      ...buyer,
      [[50, 'ФАКТУРА бр. 101/2026']],
      [[50, 'Датум на фактура: 05.10.2026'], [300, 'Валута: 04.11.2026']],
      head(['Р.бр.', 'Назив', 'Кол.', 'Цена', 'Износ', 'ДДВ']),
      head(['1', 'Шраф М6', '100', '6,00', '600,00', '18%']),
      head(['2', 'Навртка М6', '100', '4,00', '400,00', '18%']),
      [[50, 'Рекапитулација'], [200, 'Основица'], [300, 'ДДВ']],
      [[50, 'ДДВ 18%'], [200, '1.000,00'], [300, '180,00']],
      [[50, 'Вкупно за плаќање:'], [300, '1.180,00']],
      [[50, 'Фактурирал: ____________'], [300, 'Примил: ____________']],
    ]),
    ...page(2, [
      [[50, 'ТЕСТ ДИСТРИБУЦИЈА ДОО Битола']],
      [[50, 'Даночен број (ЕДБ): 4030999000222']],
      ...buyer,
      [[50, 'Фактура број: F-2026-0042']],
      [[50, 'Датум на издавање: 06.10.2026'], [300, 'Рок на плаќање: 21.10.2026']],
      head(['Р.бр.', 'Назив', 'Кол.', 'Цена', 'Износ', 'ДДВ']),
      head(['1', 'Кабел 3x1,5', '500', '3,00', '1.500,00', '18%']),
      head(['2', 'Прекинувач', '50', '20,00', '1.000,00', '18%']),
      head(['3', 'Прирачник', '4', '100,00', '400,00', '5%']),
      [[50, 'продолжува на следната страна']],
    ]),
    ...page(3, [
      [[50, 'ТЕСТ ДИСТРИБУЦИЈА ДОО Битола']],
      [[50, 'Фактура број: F-2026-0042 (продолжение)']],
      [[50, 'Рекапитулација'], [200, 'Основица'], [300, 'ДДВ']],
      [[50, 'ДДВ 18%'], [200, '2.500,00'], [300, '450,00']],
      [[50, 'ДДВ 5%'], [200, '400,00'], [300, '20,00']],
      [[50, 'Вкупно за плаќање:'], [300, '3.370,00']],
    ]),
    ...page(4, [
      [[50, 'ПРОБА УСЛУГИ ДООЕЛ Охрид']],
      [[50, 'ЕДБ 5030999000333']],
      ...buyer,
      [[50, 'Број на фактура: 77/26']],
      [[50, 'Датум: 08.10.2026']],
      head(['Р.бр.', 'Опис', 'Кол.', 'Цена', 'Износ', 'ДДВ']),
      head(['1', 'Сервис на клима', '1', '300,00', '300,00', '10%']),
      [[50, 'ДДВ 10%'], [200, '300,00'], [300, '30,00']],
      [[50, 'Вкупно за плаќање:'], [300, '330,00']],
    ]),
  ];
}

/**
 * Two invoices on ONE page without a page break (a supplier's „збирен“ print): the second one starts with its own
 * letterhead and ЕДБ right after the first one's total, and its title carries no number (WISE print: „ФАКТУРА“, then
 * „Број | …“).
 */
export function twoOnOnePageItems(): PdfItem[] {
  return page(1, [
    [[50, 'АЛФА ПРОБА ДООЕЛ Куманово · ЕДБ 4030999000444']],
    ...buyer,
    [[50, 'Фактура бр. 5/2026'], [300, 'Датум: 01.10.2026']],
    [[50, 'ДДВ 18%'], [200, '100,00'], [300, '18,00']],
    [[50, 'Вкупно за плаќање:'], [300, '118,00']],
    [[50, 'БЕТА ПРОБА ДОО Штип']],
    [[50, 'ЕДБ: 4030999000555']],
    [[50, 'ФАКТУРА']],
    [[50, 'Број'], [150, '0009/2026']],
    [[50, 'Датум'], [150, '02.10.2026']],
    [[50, 'ДДВ 5%'], [200, '200,00'], [300, '10,00']],
    [[50, 'Вкупно за плаќање:'], [300, '210,00']],
  ]);
}
