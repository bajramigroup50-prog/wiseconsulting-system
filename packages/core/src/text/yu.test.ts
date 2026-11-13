import { describe, expect, it } from 'vitest';
import { hasYuAscii, yuFix } from './cyr';

describe('yuFix', () => {
  it('turns YU-ASCII signs into letters', () => {
    expect(yuFix('РАМКИ ЗА НАО^АРИ КУЗЕН')).toBe('РАМКИ ЗА НАОЧАРИ КУЗЕН');
    expect(yuFix('ЛЕПЕНКИ ЗА О^И')).toBe('ЛЕПЕНКИ ЗА ОЧИ');
    expect(yuFix('PO[TENSKA BANKA')).toBe('POŠTENSKA BANKA');
    expect(yuFix('REKO IN@ENERING')).toBe('REKO INŽENERING');
    expect(yuFix('FI]O SERVIS')).toBe('FIĆO SERVIS');
  });
  it('keeps signs that are not letters', () => {
    expect(yuFix('Артикл [1]')).toBe('Артикл [1]');
    expect(yuFix('info@firma.mk')).toBe('info@firma.mk');
    expect(hasYuAscii('ВРВКИ')).toBe(false);
    expect(hasYuAscii('НАО^АРИ')).toBe(true);
  });
});
