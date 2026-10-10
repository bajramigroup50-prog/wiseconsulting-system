import { describe, expect, it } from 'vitest';
import { NAV, NAV_LBL, navFlat, viewAllowed } from './nav';

const ids = (g: string) => navFlat(NAV.find(([x]) => x === g)![1]).map(([id]) => id);

describe('Фирми law / УЈП items (legacy runtime NAV inserts)', () => {
  it('Фирми: … zatvoranje, insp, lawrep, mpinIn', () => {
    const f = ids('Фирми');
    expect(f.slice(f.indexOf('zatvoranje'), f.indexOf('zatvoranje') + 4)).toEqual(['zatvoranje', 'insp', 'lawrep', 'mpinIn']);
    expect(f[f.indexOf('izvestuvanja') + 1]).toBe('zakoni');
    expect(NAV_LBL.zakoni).toBe('⚖️ Законски промени');
    expect(NAV_LBL.lawrep).toBe('⚖️ Даночен преглед (според законите)');
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
    for (const v of ['zakoni', 'lawrep']) { expect(viewAllowed('view', v)).toBe(true); expect(viewAllowed('klient', v)).toBe(false); }
  });
});
