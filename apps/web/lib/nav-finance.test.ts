import { describe, expect, it } from 'vitest';
import { NAV, NAV_LBL, navFlat, viewAllowed } from './nav';

const ids = (g: string) => navFlat(NAV.find(([x]) => x === g)![1]).map(([id]) => id);

describe('finance menu items (legacy runtime NAV patches)', () => {
  it('recFree right after kartici, pozajmici last in Финансово', () => {
    const f = ids('Финансово');
    expect(f.indexOf('recFree')).toBe(f.indexOf('kartici') + 1);
    expect(f[f.length - 1]).toBe('pozajmici');
    expect(NAV_LBL.recFree).toBe('🔍 Споредба на две картици');
  });
  it('efPrep after mpinIn (end of the all-firms checks), codebook screens after the chart', () => {
    const f = ids('Фирми');
    expect(f.indexOf('efPrep')).toBe(f.indexOf('mpinIn') + 1);
    const s = ids('Шифрарник');
    expect(s.slice(s.indexOf('konto'))).toEqual(['konto', 'tarifi', 'terkovi']);
  });
  it('klient and teren do not get them', () => {
    for (const v of ['recFree', 'pozajmici', 'efPrep', 'semi', 'kamati']) expect(viewAllowed('klient', v)).toBe(false);
    expect(viewAllowed('acc', 'pozajmici')).toBe(true);
  });
});
