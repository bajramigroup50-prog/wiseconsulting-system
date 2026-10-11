import { describe, expect, it } from 'vitest';
import { firmShort, isFuel } from './law/fuel-seller';

describe('fuel seller (legacy FUEL_RX / fuelSeller)', () => {
  it('recognises fuel names', () => {
    for (const n of ['Еуро дизел', 'BMB 95', 'Безоловен бензин 98', 'LPG автогас', 'ЕД-1 нафта', 'Eurodiesel']) expect(isFuel(n)).toBe(true);
    for (const n of ['Кафе 200г', 'Масло за мотор']) expect(isFuel(n)).toBe(false);
  });
  it('short firm name', () => {
    expect(firmShort('Петрол Трејд ДООЕЛ Скопје')).toBe('Петрол Трејд');
  });
});
