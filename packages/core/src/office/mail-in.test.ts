import { describe, expect, it } from 'vitest';
import { firmKey, mailAddr, mailEdbs, mailFileWanted, mailMatch, mailToCyr, type MailFirm } from './mail-in';

const F: MailFirm[] = [
  { id: 'agro', name: 'АГРО ФАРМА ЛТД ДООЕЛ', edb: 'MK4030000000001', email: 'agro@x.mk; sef@agro.mk' },
  { id: 'trimi', name: 'ТРИМИ МЕТАЛ ДООЕЛ', edb: '4030000000002', email: null },
  { id: 'travel', name: 'ТРАВЕЛ СТОРИ ДООЕЛ СКОПЈЕ', edb: null, email: null },
  { id: 'own', name: 'БАЈРАМИ ГРОУП ДООЕЛ', edb: 'MK4030999999999', email: 'info@wiseconsulting.com.mk' },
];
const base = { subject: '', text: '', fileNames: [], learned: {}, userFirms: new Map<string, string[]>(), firms: F, ownEdb: 'MK4030999999999' };

describe('✉ mail → WISE: which firm', () => {
  it('reads the address', () => {
    expect(mailAddr('"Dame Ristov" <DadiKompani@Yahoo.com>')).toBe('dadikompani@yahoo.com');
    expect(mailAddr('a.b@c.mk')).toBe('a.b@c.mk');
    expect(mailAddr('nobody')).toBe('');
  });
  it('learned sender first, then the firm / client-user e-mail', () => {
    expect(mailMatch({ ...base, from: 'dadikompani@yahoo.com', learned: { 'dadikompani@yahoo.com': 'trimi' } })).toEqual({ firmId: 'trimi', how: 'learned' });
    expect(mailMatch({ ...base, from: 'Шеф <SEF@agro.mk>' })).toEqual({ firmId: 'agro', how: 'email' });
    expect(mailMatch({ ...base, from: 'k@gmail.com', userFirms: new Map([['k@gmail.com', ['travel']]]) })).toEqual({ firmId: 'travel', how: 'email' });
  });
  it('a client user of several firms is not enough – the ЕДБ in the text decides', () => {
    const userFirms = new Map([['k@gmail.com', ['agro', 'trimi']]]);
    expect(mailMatch({ ...base, from: 'k@gmail.com', userFirms })).toEqual({ firmId: null, candidates: [] });
    expect(mailMatch({ ...base, from: 'k@gmail.com', userFirms, text: 'ЕДБ: MK 4030000000002' })).toEqual({ firmId: 'trimi', how: 'edb' });
  });
  it('the office’s own ЕДБ never matches; two ЕДБ → waits with candidates', () => {
    expect(mailMatch({ ...base, from: 'x@y.mk', text: 'MK4030999999999' }).firmId).toBeNull();
    expect(mailMatch({ ...base, from: 'x@y.mk', text: '4030000000001 и 4030000000002' })).toEqual({ firmId: null, candidates: ['agro', 'trimi'] });
  });
  it('the firm name in the subject, Cyrillic or Latin', () => {
    expect(mailMatch({ ...base, from: 'x@y.mk', subject: 'Fwd: Kartici Agro Farma' })).toEqual({ firmId: 'agro', how: 'name' });
    expect(mailMatch({ ...base, from: 'x@y.mk', subject: 'Фактури ТРАВЕЛ СТОРИ октомври' })).toEqual({ firmId: 'travel', how: 'name' });
    expect(mailMatch({ ...base, from: 'x@y.mk', subject: 'Фактури за октомври' }).firmId).toBeNull();
  });
  it('helpers', () => {
    expect(firmKey('АГРО ФАРМА ЛТД ДООЕЛ')).toBe('АГРО ФАРМА');
    expect(firmKey('ДРУШТВО ЗА ТРГОВИЈА СЕМПРА 2023 ДОО')).toBe('СЕМПРА 2023');
    expect(firmKey('АД')).toBe('');
    expect(mailToCyr('Shkendija Gjorgji')).toBe('ШКЕНДИЈА ЃОРГЈИ'.replace('ЃОРГЈИ', 'ЃОРЃИ'));
    expect(mailEdbs('ЕДБ MK4030000000001, тел 070 123 456')).toEqual(['4030000000001']);
  });
  it('skips logos, signatures and invites; keeps documents', () => {
    expect(mailFileWanted({ name: 'logo.png', mime: 'image/png', size: 8000 })).toBe(false);
    expect(mailFileWanted({ name: 'invite.ics', mime: 'text/calendar', size: 900 })).toBe(false);
    expect(mailFileWanted({ name: 'faktura.pdf', mime: 'application/pdf', size: 90_000 })).toBe(true);
    expect(mailFileWanted({ name: 'IMG_1.jpg', mime: 'image/jpeg', size: 900_000 })).toBe(true);
  });
});
