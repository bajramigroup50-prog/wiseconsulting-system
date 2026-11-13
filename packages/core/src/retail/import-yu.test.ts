import { describe, expect, it } from 'vitest';
import { impAuto, impN } from './import';

describe('import headers in old YU-ASCII / Latin', () => {
  it('normalises the letters', () => {
    expect(impN('KOLI^INA')).toBe('kolicina');
    expect(impN('Količina')).toBe('kolicina');
  });
  it('recognises quantity and cost columns', () => {
    const m = impAuto('in', ['[IFRA', 'NAZIV', 'ED.M', 'KOLI^INA', 'NABAVNA CENA', 'DDV %']);
    expect(m.qty).toBe(3);
    expect(m.cost).toBe(4);
    const s = impAuto('stock', ['Шифра', 'Назив', 'SOSTOJBA']);
    expect(s.qty).toBe(2);
  });
});

describe('old stock list with in / out', () => {
  it('maps quantity, in, out, cost and the financial in / out', () => {
    const H = ['*', 'Шифра', 'Помошна шифра', 'Назив на производ', 'Бренд име', 'Добавувач', 'Е. м.', 'Количина', 'Колич. влез', 'Колич. излез', 'Наб. цена', 'Наб. износ', 'Фин. влез', 'Фин. излез', 'Фин. сост.', 'ВЛ прод. со данок', 'Продажна цена', 'ДДВ %', 'Количина_2', 'Колич. влез_2'];
    const m = impAuto('in', H);
    expect([m.code, m.qty, m.inq, m.outq, m.cost, m.vin, m.vout]).toEqual([1, 7, 8, 9, 10, 12, 13]);
  });
});
