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
