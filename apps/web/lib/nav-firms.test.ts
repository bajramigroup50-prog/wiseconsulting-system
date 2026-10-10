import { describe, expect, it } from 'vitest';
import { NAV, NAV_LBL, navFlat, viewAllowed } from './nav';

const ids = (g: string) => navFlat(NAV.find(([n]) => n === g)![1]).map(([id]) => id);

describe('firm / office menu items (legacy runtime NAV patches)', () => {
  it('inserts opomeni and mailhist after izlez, payBatch after plati, firmiResh after firmiImp', () => {
    const m = ids('Материјално');
    expect(m.slice(m.indexOf('izlez'), m.indexOf('izlez') + 3)).toEqual(['izlez', 'opomeni', 'mailhist']);
    const f = ids('Финансово');
    expect(f[f.indexOf('plati') + 1]).toBe('payBatch');
    const fi = ids('Фирми');
    expect(fi[fi.indexOf('firmiImp') + 1]).toBe('firmiResh');
    expect(NAV_LBL.opomeni).toBe('⏰ Неплатени фактури и опомени');
  });
  it('every view of this area is reachable by office staff, not by clients', () => {
    for (const v of ['zatvoranje', 'firmiImp', 'firmiResh', 'klProfili', 'klDash', 'mojIzv', 'payBatch', 'mailPotpis', 'mailhist', 'opomeni', 'baranja', 'greski', 'zsDos', 'zsRok']) {
      expect(viewAllowed('admin', v), v).toBe(true);
      expect(viewAllowed('klient', v), v).toBe(false);
    }
  });
});
