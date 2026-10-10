import { describe, expect, it } from 'vitest';
import { fuelBannerData, fuelInvoiceCheck, fuelPurchaseWarning, isFuel, pxAuto, pxGroups, pxHeaderRow, pxLines, pxN6, pxNum } from './sales';

describe('Excel purchase lines (legacy pxBuild 17236–17376)', () => {
  it('parses numbers like legacy fkN / pxN6', () => {
    expect(pxNum('1.333,34')).toBe(1333.34);
    expect(pxNum('1,333.34')).toBe(1333.34);
    expect(pxNum('80,000')).toBe(80000);
    expect(pxN6('0,123456')).toBe(0.123456);
  });
  it('finds the header row and maps the columns', () => {
    const A = [['Фактура бр 5'], ['Шифра', 'Назив на производ', 'Количина', 'Набавна цена', 'Продажна цена', 'ДДВ %'], ['A1', 'Сок', '10', '50,5', '90', '5'], ['', '', '', '', '', '']];
    const { hi } = pxHeaderRow(A);
    expect(hi).toBe(1);
    const col = pxAuto(A[hi]!, A.slice(hi + 1));
    expect(col).toMatchObject({ code: 0, name: 1, qty: 2, price: 3, sp: 4, rate: 5 });
    const L = pxLines(A, hi, col, true);
    expect(L).toEqual([{ code: 'A1', name: 'Сок', qty: 10, price: 50.5, sp: 90, rate: 5, barcode: '' }]);
    expect(pxGroups(L, { imp: false, fx: 1, vatFirm: true, konto: '6600' }).groups).toEqual([{ account: '6600', rate: 5, base: 505, vat: 25.25 }]);
    expect(pxGroups(L, { imp: true, fx: 61.5, vatFirm: true, konto: '6600' })).toEqual({ fxAmt: 505, groups: [{ account: '6600', rate: 0, base: 31057.5, vat: 0 }] });
  });
});

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
