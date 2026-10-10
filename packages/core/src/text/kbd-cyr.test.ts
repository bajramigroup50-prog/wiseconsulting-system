import { describe, expect, it } from 'vitest';
import { kbdToCyr } from './kbd-cyr';

describe('kbdToCyr', () => {
  it('maps keyboard-Latin firm names', () => {
    expect(kbdToCyr('3T ENERGI GRUP DOOEL SKOPJE')).toBe('3Т ЕНЕРГИ ГРУП ДООЕЛ СКОПЈЕ');
    expect(kbdToCyr('A-FE[N UVOZ IZVOZ DOOEL')).toBe('А-ФЕШН УВОЗ ИЗВОЗ ДООЕЛ');
    expect(kbdToCyr('A.N.P.I IBE PALIKU[I SKOPJE')).toBe('А.Н.П.И ИБЕ ПАЛИКУШИ СКОПЈЕ');
    expect(kbdToCyr('Ul. Ilindenska br.5')).toBe('Ул. Илинденска бр.5');
  });
  it('leaves Cyrillic and digits alone', () => {
    expect(kbdToCyr('БАЈРАМИ ГРОУП ДООЕЛ')).toBe('БАЈРАМИ ГРОУП ДООЕЛ');
    expect(kbdToCyr('12345')).toBe('12345');
    expect(kbdToCyr('')).toBe('');
  });
});
