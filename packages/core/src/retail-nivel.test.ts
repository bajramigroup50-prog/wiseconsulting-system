import { describe, expect, it } from 'vitest';
import { nivBulkPrice, nivImport, nivRound } from './retail';

describe('нивелација (legacy nvApply / nivImp)', () => {
  it('rounds like legacy', () => {
    expect([nivRound(148.4, 1), nivRound(146, 10), nivRound(146.237, 0.01), nivRound(146, 9), nivRound(3, 9)]).toEqual([148, 150, 146.24, 149, 9]);
  });
  it('bulk price: ▼ / ▲ %, fixed price, no change', () => {
    expect(nivBulkPrice(200, { dir: 'down', pct: '20', rs: 1 })).toBe(160);
    expect(nivBulkPrice(200, { dir: 'up', pct: '−10', rs: 1 })).toBe(180);
    expect(nivBulkPrice(200, { dir: 'up', pct: '12,5', rs: 10 })).toBe(230);
    expect(nivBulkPrice(200, { dir: 'down', fix: '199', rs: 1 })).toBe(199);
    expect(nivBulkPrice(200, { dir: 'down', fix: '200', rs: 1 })).toBeNull();
    expect(nivBulkPrice(200, { dir: 'down', rs: 1 })).toBeNull();
  });
  it('imports code / new / qty / old', () => {
    const I = [{ id: 'a', code: '001', name: 'Кафе', barcodes: ['531'] }];
    const r = nivImport([['Шифра на производ', 'Нова цена', 'Количина', 'Стара цена'], ['001', '99,90', 5, 120], ['531', 80], ['777', 10], ['001', 0]], I);
    expect(r.rows.map((x) => [x.item.id, x.nv, x.q, x.o])).toEqual([['a', 99.9, 5, 120], ['a', 80, 0, 0]]);
    expect(r.miss).toEqual(['777']);
  });
});
