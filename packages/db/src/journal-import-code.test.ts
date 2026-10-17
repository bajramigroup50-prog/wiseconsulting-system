import { describe, expect, it } from 'vitest';
import { codeAgrees } from './journal-import';

const P = (name: string, edb = '') => ({ id: 'x', name, edb });
const R = (pname: string, pedb = '') => ({ pname, pedb });

describe('journal import: the old program code is taken only for the same company', () => {
  it('another company under the same code is refused (codes WISE gave to scanned partners)', () => {
    for (const [file, wise] of [
      ['STORIBOKS TOJS AND BOOKS DOOEL', 'АПТИВ СЕРВИСЕС МАКЕДОНИЈА ДООЕЛ Скопје'],
      ['KANTINA MTSD DOO', 'Центар за јавно Здравје Велес'],
      ['RIMIN ER DOOEL [TIP', 'Хаилонг ЛИУ ДООЕЛ експорт - импорт Скопје (Звезден Океан Центар)'],
      ['ZVEZDEN OKEAN MEISAN DOOEL SKOPJE', 'ЗВЕЗДЕН ОКЕАН ЛИУ ДООЕЛ Скопје (star ocean)'],
      ['BAKERI-MA DOO - PEKON', 'ЦЕНТАР ЗА ЈАВНО ЗДРАВЈЕ-Скопје'],
      ['RESTORAN BELA VISTA DOOEL', 'КСНМ ТЕЦХНОЛОГИЕС Д.О.О. СКОПЈЕ- casino play 4 win'],
    ]) expect(codeAgrees(P(wise!), R(file!)), file).toBe(false);
  });
  it('the same company passes: Latin ↔ Cyrillic, YUSCII, cut-off name, the same ЕДБ', () => {
    expect(codeAgrees(P('ГУЛЕРМАК АГИР САНАЈИ ИНШААТ ВЕ ТААХХУТ А'), R('GULERMAK AGIR SANAJI IN[AAT VE TAAHHUT A'))).toBe(true);
    expect(codeAgrees(P('ЗВЕЗДЕН ОКЕАН ЛИУ ДООЕЛ'), R('ZVEZDEN OKEAN LIU DOOEL'))).toBe(true);
    expect(codeAgrees(P('БЕХТЕЛ ЕНКА УК2 ЛИМИТЕД'), R('BEHTEL ENKA UK2 LIMITED'))).toBe(true);
    expect(codeAgrees(P('АМБАСАДА НА КИНА СКОПЈЕ'), R('AMBASADA NA KINA SKOPJE'))).toBe(true);
    expect(codeAgrees(P('Друго име', '4030000000001'), R('Something else', '4030000000001'))).toBe(true);
    expect(codeAgrees(P('АМФОРА ДООЕЛ'), R(''))).toBe(true);
    expect(codeAgrees(P('ГУЛЕРМАК АГИР САНАЈИ ИНШААТ ВЕ ТААХХУТ А'), R('GULERMAK'))).toBe(true);
  });
  it('another ЕДБ is another company even with the same name', () => {
    expect(codeAgrees(P('АМФОРА ДООЕЛ', '4030000000001'), R('AMFORA DOOEL', '4030000000002'))).toBe(false);
  });
});
