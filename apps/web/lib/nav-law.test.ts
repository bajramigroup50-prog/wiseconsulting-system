import { describe, expect, it } from 'vitest';
import { NAV, NAV_LBL, navFlat, viewAllowed } from './nav';

const ids = (g: string) => navFlat(NAV.find(([x]) => x === g)![1]).map(([id]) => id);

// „класично“ menu (legacy order, unchanged); in the „ново“ menu the five law screens are one „⚖ Закони“ item with
// tabs (P8, `lib/nav-new.test.ts`, `lib/nav-hubs.test.ts`) — the view ids and their access rules stay the same.
describe('Фирми law / УЈП items (legacy runtime NAV inserts)', () => {
  it('Фирми: … izvestuvanja, zakoni, lawAi, zatvoranje, insp, lawrep, ujpZakoni, mpinIn', () => {
    const f = ids('Фирми');
    expect(f.slice(f.indexOf('izvestuvanja'), f.indexOf('izvestuvanja') + 8)).toEqual(['izvestuvanja', 'zakoni', 'lawAi', 'zatvoranje', 'insp', 'lawrep', 'ujpZakoni', 'mpinIn']);
    expect(NAV_LBL.ujpZakoni).toBe('📚 Закони на УЈП (синхронизирано)');
    expect(f[f.indexOf('izvestuvanja') + 1]).toBe('zakoni');
    expect(NAV_LBL.zakoni).toBe('⚖️ Законски промени');
    expect(NAV_LBL.lawrep).toBe('⚖️ Даночен преглед (според законите)');
    expect(NAV_LBL.mpinIn).toBe('📥 МПИН од УЈП (сите фирми)');
  });
  it('Финансово › Плата: plati, payBatch (legacy splice at 1), mpinIn', () => {
    const sub = NAV.find(([g]) => g === 'Финансово')![1].find((x) => x[0] === '>' && x[1] === 'Плата')![2]!.map((x) => x[0]);
    expect(sub.slice(0, 3)).toEqual(['plati', 'payBatch', 'mpinIn']);
  });
  it('office roles only', () => {
    expect(viewAllowed('acc', 'mpinIn')).toBe(true);
    expect(viewAllowed('klient', 'mpinIn')).toBe(false);
    expect(viewAllowed('teren', 'mpinIn')).toBe(false);
    for (const v of ['zakoni', 'lawAi', 'lawrep', 'ujpZakoni']) { expect(viewAllowed('view', v)).toBe(true); expect(viewAllowed('klient', v)).toBe(false); }
  });
});
