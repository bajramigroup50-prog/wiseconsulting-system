import { describe, expect, it } from 'vitest';
import { NAV, NAV_LBL, navFlat, viewAllowed } from './nav';
import { routeVerdict } from './route-guard';

const ids = (g: string) => navFlat(NAV.find(([n]) => n === g)![1]).map(([id]) => id);

describe('firm / office menu items (legacy runtime NAV patches)', () => {
  it('inserts opomeni and mailhist after the documents (Влез, Излез, Услуги, Профактури, Одобренија, Е-Фактура together), payBatch after plati, firmiResh after firmiImp', () => {
    const m = ids('Материјално');
    expect(m.slice(m.indexOf('izlez'), m.indexOf('izlez') + 8)).toEqual(['izlez', 'uslugi', 'profakturi', 'odobrenija', 'povratDob', 'efaktura', 'opomeni', 'mailhist']);
    const f = ids('Финансово');
    expect(f[f.indexOf('plati') + 1]).toBe('payBatch');
    const fi = ids('Фирми');
    expect(fi[fi.indexOf('firmiImp') + 1]).toBe('firmiResh');
    expect(NAV_LBL.opomeni).toBe('⏰ Неплатени фактури и опомени');
  });
  it('„🤖 AI читање“ follows „🔄 Конвертор на датотеки“ in Систем; office staff only', () => {
    const s = ids('Систем');
    expect(s.slice(s.indexOf('uvoz'), s.indexOf('uvoz') + 3)).toEqual(['uvoz', 'konvertor', 'aiCitanje']);
    expect(NAV_LBL.aiCitanje).toBe('🤖 AI читање');
    expect(viewAllowed('admin', 'aiCitanje')).toBe(true);
    expect(viewAllowed('klient', 'aiCitanje')).toBe(false);
    expect(viewAllowed('teren', 'aiCitanje')).toBe(false);
    expect(routeVerdict('klient', '/aiCitanje', ['klHome'])).toBe('/klHome');
    expect(routeVerdict('teren', '/aiCitanje', [])).toBe('/mojzad');
  });
  it('every view of this area is reachable by office staff, not by clients', () => {
    for (const v of ['zatvoranje', 'firmiImp', 'firmiResh', 'klProfili', 'klDash', 'mojIzv', 'payBatch', 'mailPotpis', 'mailhist', 'opomeni', 'baranja', 'greski', 'zsDos', 'zsRok']) {
      expect(viewAllowed('admin', v), v).toBe(true);
      expect(viewAllowed('klient', v), v).toBe(false);
    }
  });
});
