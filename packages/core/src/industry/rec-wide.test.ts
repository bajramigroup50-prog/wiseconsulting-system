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
