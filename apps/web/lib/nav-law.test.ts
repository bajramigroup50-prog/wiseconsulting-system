import { describe, expect, it } from 'vitest';
import { NAV, NAV_LBL, navFlat, viewAllowed } from './nav';

const ids = (g: string) => navFlat(NAV.find(([x]) => x === g)![1]).map(([id]) => id);

describe('Фирми law / УЈП items (legacy runtime NAV inserts)', () => {
  it('Фирми: … zatvoranje, insp, mpinIn', () => {
    const f = ids('Фирми');
    expect(f.slice(f.indexOf('zatvoranje'), f.indexOf('zatvoranje') + 3)).toEqual(['zatvoranje', 'insp', 'mpinIn']);
    expect(NAV_LBL.mpinIn).toBe('📥 МПИН од УЈП (сите фирми)');
  });
  it('Финансово › Плата: mpinIn right after plati', () => {
    const sub = NAV.find(([g]) => g === 'Финансово')![1].find((x) => x[0] === '>' && x[1] === 'Плата')![2]!.map((x) => x[0]);
    expect(sub.slice(0, 2)).toEqual(['plati', 'mpinIn']);
  });
  it('office roles only', () => {
    expect(viewAllowed('acc', 'mpinIn')).toBe(true);
    expect(viewAllowed('klient', 'mpinIn')).toBe(false);
    expect(viewAllowed('teren', 'mpinIn')).toBe(false);
  });
});
