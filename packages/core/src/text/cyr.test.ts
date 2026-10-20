import { describe, expect, it } from 'vitest';
import { isLatinName, latToCyr } from './cyr';

describe('latToCyr', () => {
  it('Macedonian names and legal forms, case kept', () => {
    expect(latToCyr('TRULI NOLEN NM DOOEL Skopje')).toBe('ТРУЛИ НОЛЕН НМ ДООЕЛ Скопје');
    expect(latToCyr('Ljubica Njegoš, ul. Partizanska 12')).toBe('Љубица Његош, ул. Партизанска 12');
    expect(latToCyr('Gjorgji Kjosev')).toBe('Ѓорѓи Ќосев');
    expect(latToCyr('Zhivko Shishkov Chausheski')).toBe('Живко Шишков Чаушески');
  });
  it('Albanian letters in names', () => {
    expect(latToCyr('Xhemaili Qamil Çeliku Ramë')).toBe('Џемаили Ќамил Челику Раме');
    expect(latToCyr('BAJRAMI XHEVAT')).toBe('БАЈРАМИ ЏЕВАТ');
  });
  it('keeps numbers, e-mail and web, Cyrillic', () => {
    expect(latToCyr('info@primer.mk 070123456 www.wise.mk')).toBe('info@primer.mk 070123456 www.wise.mk');
    expect(latToCyr('Метро Holding')).toBe('Метро Холдинг');
    expect(isLatinName('Metro Holding')).toBe(true);
    expect(isLatinName('Метро Holding')).toBe(false);
  });
});
