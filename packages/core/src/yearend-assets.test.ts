import { describe, expect, it } from 'vitest';
import { OS_XLSX_HEAD, osCmp, osExpiry, osParse, osQrText, osScanCode } from './yearend/assets-io';

describe('fixed-asset register extras (legacy os)', () => {
  it('expiry within 30 days, expired = bad', () => {
    const E = osExpiry({ veh: true, regExp: '2026-10-01', insExp: '2026-10-25', techExp: '2027-05-01' }, [{ fileId: 'x', type: 'Гарантен лист', validTo: '2026-11-05' }], '2026-10-10');
    expect(E).toEqual([
      { what: 'Регистрација', date: '2026-10-01', bad: true },
      { what: 'Осигурување', date: '2026-10-25', bad: false },
      { what: 'Гарантен лист', date: '2026-11-05', bad: false },
    ]);
  });
  it('QR text, scan and sort', () => {
    expect(osQrText({ id: 'u1', invNo: '0007', name: 'Лаптоп' })).toBe('OS|0007|Лаптоп');
    expect(osScanCode('OS|0007|Лаптоп')).toBe('0007');
    expect(osScanCode('лаптоп')).toBeNull();
    expect([{ invNo: '0010', name: 'a' }, { invNo: '0002', name: 'b' }, { invNo: '10', name: 'c' }].sort(osCmp).map((x) => x.name)).toEqual(['b', 'a', 'c']);
  });
  it('imports the register template', () => {
    const R = osParse([[...OS_XLSX_HEAD], ['0001', 'Возило Шкода', 'VIN1', '', '0136', '15.03.2024', '1.200.000,00', '25', 'Авто ДОО', 'Ф-12', 'Скопје', 'SK-1234-AB'], ['', '', '', '', '', '', '', '', '', '', '', '']]);
    if ('error' in R) throw new Error(R.error);
    expect(R).toEqual([{ invNo: '0001', name: 'Возило Шкода', serial: 'VIN1', barcode: '', konto: '0136', date: '2024-03-15', cost: 1200000, rate: 25, supplier: 'Авто ДОО', invDoc: 'Ф-12', location: 'Скопје', plate: 'SK-1234-AB' }]);
    expect(osParse([['x']])).toHaveProperty('error');
  });
});
