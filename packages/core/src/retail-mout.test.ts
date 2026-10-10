import { describe, expect, it } from 'vitest';
import { moCols, moFindItem, moImport, moNum, moTemplate, moTotal } from './retail';

const I = [
  { id: 'a', code: '001', name: 'Кафе', barcodes: ['5310000000017'], unit: 'ком' },
  { id: 'b', code: '002', name: 'Леб', barcodes: [], unit: 'ком' },
  { id: 'c', code: '003', name: 'Леб интегрален', barcodes: [], unit: 'ком' },
];

describe('Излез од продавница (legacy moImport / moCols / moTplDl)', () => {
  it('recognises the columns', () => {
    expect(moCols(['Шифра', 'Баркод', 'Назив', 'Количина', 'Цена со ДДВ', 'Износ'])).toEqual({ code: 0, bar: 1, name: 2, cnt: -1, qty: 3, price: 4, amt: 5 });
    expect(moCols(['Шифра', 'Баркод', 'Назив', 'ЕМ', 'Состојба', 'Пописано']).cnt).toBe(5);
  });
  it('parses numbers like legacy impNum', () => {
    expect([moNum('1.234,50'), moNum('1 234.50'), moNum('12,5'), moNum(7), moNum('')]).toEqual([1234.5, 1234.5, 12.5, 7, 0]);
  });
  it('imports a sale: barcode / code / name, totals skipped, price from amount, unknown reported', () => {
    const r = moImport([['Продажба'], ['Шифра', 'Баркод', 'Назив', 'Количина', 'Цена', 'Износ'], ['', '5310000000017', '', 2, '', 120], ['002', '', '', 1, 30, ''], ['', '', 'леб', 1, 30, ''], ['999', '', 'Сок', 3], ['Вкупно', '', '', 7]], 'sale', I);
    expect(r.rows).toBe(3);
    expect(r.acc.get('a')).toEqual({ q: 2, amt: 120, hasP: true });
    expect(r.acc.get('b')).toEqual({ q: 2, amt: 60, hasP: true });
    expect(r.miss).toEqual(['999 Сок (3)']);
  });
  it('count list uses „Пописано“; no header → Шифра, Назив, Количина, Цена', () => {
    const r = moImport([['Шифра', 'Назив', 'Состојба', 'Пописано'], ['001', 'Кафе', 10, 8]], 'pop', I);
    expect(r.acc.get('a')!.q).toBe(8);
    expect(moImport([['001', 'Кафе', 4, 50]], 'sale', I).acc.get('a')).toEqual({ q: 4, amt: 200, hasP: true });
  });
  it('templates, item search, totals', () => {
    expect(moTemplate('sale', I, () => 0, () => 59)[0]).toEqual(['Шифра', 'Баркод', 'Назив', 'Количина', 'Цена со ДДВ', 'Износ']);
    expect(moTemplate('pop', I, (id) => (id === 'a' ? 5 : 0), () => 0)).toEqual([['Шифра', 'Баркод', 'Назив', 'ЕМ', 'Состојба', 'Пописано'], ['001', '5310000000017', 'Кафе', 'ком', 5, '']]);
    expect(moFindItem(I, '001 · Кафе')?.id).toBe('a');
    expect(moFindItem(I, 'интегр')?.id).toBe('c');
    expect(moFindItem(I, 'леб')?.id).toBe('b');
    expect(moFindItem(I, 'е')).toBeNull();
    expect(moTotal('pop', [{ diff: -2, sp: 59 }, { diff: 1, sp: 30 }])).toBe(-88);
    expect(moTotal('sale', [{ val: 10.5 }, { val: 2 }])).toBe(12.5);
  });
});
