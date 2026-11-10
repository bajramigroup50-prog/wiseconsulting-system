import { describe, expect, it } from 'vitest';
import { oxRows, REC_IMPORT, recWideToLong } from '../industry';

describe('recurring import: one customer per row with numbered product slots', () => {
  const H = ['Комитент', 'ЕДБ', 'E-mail', 'Телефон', 'Ден во месецот', 'Се повторува',
    'Производ 1', 'Количина 1', 'Цена без ДДВ 1', 'ДДВ % 1', 'Производ 2', 'Количина 2', 'Цена без ДДВ 2', 'ДДВ % 2', 'Производ 3', 'Количина 3', 'Цена без ДДВ 3', 'ДДВ % 3', 'Вкупно со ДДВ'];
  it('turns each filled slot into a row of the same customer', () => {
    const L = recWideToLong([H,
      ['Хотел А', '4030', 'a@b.mk', '070', 5, 'месечно', 'Парфем 1', 3, 1500, 18, 'Парфем 2', '', 1200, 18, 'Апарат', 1, 1000, 18, 9000],
      ['Канцеларија Б', '', '', '', 'последен работен ден', '', 'Парфем 1', 1, 1500, 18, '', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ]);
    expect(L).toHaveLength(5);
    const r = oxRows(L, REC_IMPORT);
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.partner, x.item, x.qty, x.price, x.day])).toEqual([
      ['Хотел А', 'Парфем 1', '3', '1500', '5'], ['Хотел А', 'Парфем 2', '', '1200', '5'], ['Хотел А', 'Апарат', '1', '1000', '5'],
      ['Канцеларија Б', 'Парфем 1', '1', '1500', 'последен работен ден'],
    ]);
    expect(r.rows[0]).toMatchObject({ email: 'a@b.mk', phone: '070' });
  });
  it('leaves a one-product-per-row sheet as it is', () => {
    const S = [['Комитент', 'Ставка', 'Цена без ДДВ'], ['А', 'Услуга', 100]];
    expect(recWideToLong(S)).toEqual(S);
  });
});

describe('recurring import: products as columns (quantity under each product)', () => {
  it('reads the price / VAT rows and one row per customer', () => {
    const L = recWideToLong([
      ['Комитент', 'ЕДБ', 'E-mail', 'Телефон', 'Ден за фактурирање', 'Парфем A', 'Парфем B', 'Апарат', 'Парфем C', 'Вкупно месечно со ДДВ'],
      ['ЦЕНА БЕЗ ДДВ →', '', '', '', '', '1.500,00', 1200, 1000, 900, ''],
      ['ДДВ % →', '', '', '', '', 18, 18, 18, 5, ''],
      ['ЦЕНА СО ДДВ →', '', '', '', '', 1770, 1416, 1180, 945, ''],
      ['ПРИМЕР – Хотел', '', '', '', 1, 1, '', '', '', ''],
      ['Хотел А', '4030', 'a@b.mk', '070', 1, 2, 1, 'x', 3, 9000],
      ['Канцеларија Б', '', '', '', 5, 1, '', '', '', 1770],
    ]);
    const r = oxRows(L, REC_IMPORT);
    expect(r.errors).toEqual([]);
    expect(r.rows.filter((x) => !/^ПРИМЕР/.test(x.partner!)).map((x) => [x.partner, x.item, x.qty, x.price, x.vat, x.day])).toEqual([
      ['Хотел А', 'Парфем A', '2', '1.500,00', '18', '1'], ['Хотел А', 'Парфем B', '1', '1200', '18', '1'], ['Хотел А', 'Апарат', '1', '1000', '18', '1'], ['Хотел А', 'Парфем C', '3', '900', '5', '1'],
      ['Канцеларија Б', 'Парфем A', '1', '1.500,00', '18', '5'],
    ]);
  });
});
