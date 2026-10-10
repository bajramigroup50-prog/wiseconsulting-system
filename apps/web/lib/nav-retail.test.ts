import { describe, expect, it } from 'vitest';
import { NAV, NAV_LBL, navFlat } from './nav';

describe('retail menu items', () => {
  it('adds rasNorm after prod and uslugiS after artikli', () => {
    const m = navFlat(NAV.find(([g]) => g === 'Материјално')![1]).map(([id]) => id);
    expect(m.indexOf('rasNorm')).toBe(m.indexOf('prod') + 1);
    const s = navFlat(NAV.find(([g]) => g === 'Шифрарник')![1]).map(([id]) => id);
    expect(s.indexOf('uslugiS')).toBe(s.indexOf('artikli') + 1);
    expect(NAV_LBL.rasNorm).toBe('📦 Раздолжување без норматив');
  });
});
