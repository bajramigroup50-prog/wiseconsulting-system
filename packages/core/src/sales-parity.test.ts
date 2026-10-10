import { describe, expect, it } from 'vitest';
import { fuelBannerData, fuelInvoiceCheck, fuelPurchaseWarning, isFuel } from './sales';

const R = { rate: 10, else: 18, from: '2026-01-01', to: '2026-12-31', title: 'ДДВ на горива 10%', url: '' };

describe('fuel VAT rule (legacy 14350–14369)', () => {
  it('recognises fuel names', () => {
    expect(isFuel('Еуро дизел БС')).toBe(true);
    expect(isFuel('BMB 95')).toBe(true);
    expect(isFuel('Кафе')).toBe(false);
  });
  it('flags invoice fuel lines with another rate', () => {
    const c = fuelInvoiceCheck([{ name: 'Дизел', rate: '18' }, { name: 'Масло', rate: '18' }], '2026-10-10', R);
    expect(c?.rate).toBe(10);
    expect(c?.bad).toEqual([0]);
    expect(c?.text).toContain('ставката „Дизел“ е гориво со ДДВ 18%');
    expect(c?.text).toContain('намалена стапка до 31.12.2026');
    expect(fuelInvoiceCheck([{ name: 'Дизел', rate: '10' }], '2026-10-10', R)).toBeNull();
    // after the reduced period the else-rate applies
    expect(fuelInvoiceCheck([{ name: 'Дизел', rate: '10' }], '2027-01-05', R)?.rate).toBe(18);
    expect(fuelInvoiceCheck([{ name: 'Дизел', rate: '18' }], '2026-10-10', null)).toBeNull();
  });
  it('warns on fuel purchases booked at another rate', () => {
    const w = fuelPurchaseWarning({ names: ['Макпетрол', 'Еуродизел'], groups: [{ rate: 18, base: 1000 }], date: '2026-10-10' }, R);
    expect(w).toContain('Влезна фактура за гориво со ДДВ 18%');
    expect(fuelPurchaseWarning({ names: ['Еуродизел'], groups: [{ rate: 10, base: 1000 }], date: '2026-10-10' }, R)).toBeNull();
    expect(fuelPurchaseWarning({ names: ['Хартија'], groups: [{ rate: 18, base: 1000 }], date: '2026-10-10' }, R)).toBeNull();
  });
  it('builds the fuel-seller banner', () => {
    const b = fuelBannerData(R, '2026-12-28', true, [{ rate: 18 }, { rate: 10 }]);
    expect(b).toMatchObject({ rate: 10, left: 3, wrong: 1, warn: true });
    expect(fuelBannerData(R, '2026-10-10', false, [])).toBeNull();
  });
});
