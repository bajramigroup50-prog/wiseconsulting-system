import { describe, expect, it } from 'vitest';
import { firmKey, mailOrigin, mailAddr, mailEdbs, mailFileWanted, mailMatch, mailToCyr, type MailFirm } from './mail-in';

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
  it('the office’s own ЕДБ only when no client’s; two ЕДБ → waits with candidates', () => {
    expect(mailMatch({ ...base, from: 'x@y.mk', text: 'Купувач MK4030999999999' })).toEqual({ firmId: 'own', how: 'edb' });
    expect(mailMatch({ ...base, from: 'x@y.mk', text: 'MK4030999999999 / клиент 4030000000001' })).toEqual({ firmId: 'agro', how: 'edb' });
    expect(mailMatch({ ...base, from: 'x@y.mk', subject: 'БАЈРАМИ ГРОУП фактура' }).firmId).toBeNull();
    expect(mailMatch({ ...base, from: 'x@y.mk', text: '4030000000001 и 4030000000002' })).toEqual({ firmId: null, candidates: ['agro', 'trimi'] });
  });
  it('the firm name in the subject, Cyrillic or Latin', () => {
    expect(mailMatch({ ...base, from: 'x@y.mk', subject: 'Fwd: Kartici Agro Farma' })).toEqual({ firmId: 'agro', how: 'name' });
    expect(mailMatch({ ...base, from: 'x@y.mk', subject: 'Фактури ТРАВЕЛ СТОРИ октомври' })).toEqual({ firmId: 'travel', how: 'name' });
    expect(mailMatch({ ...base, from: 'x@y.mk', subject: 'Фактури за октомври' }).firmId).toBeNull();
  });
  it('a forwarded mail: the client is the sender in the text', () => {
    const office = ['info@wiseconsulting.com.mk', 'vbkonsalting@hotmail.com'];
    const t = ['Get Outlook', '________________________________', 'From: Marijana K <Marijana.K@procredit-group.com>', 'Sent: x'].join('\n');
    expect(mailOrigin('vbkonsalting@hotmail.com', 'Fw: Заклучен лист', t, office)).toBe('marijana.k@procredit-group.com');
    expect(mailOrigin('tunaliskopje@gmail.com', 'Fwd: фактури', ['---------- Forwarded message ---------', 'Gönderen: Stefkovski <Zoran@telekom.mk>'].join('\n'), office)).toBe('zoran@telekom.mk');
    expect(mailOrigin('shef@agro.mk', 'фактури', 'From: x@y.mk', office)).toBe('shef@agro.mk');
    expect(mailOrigin('vbkonsalting@hotmail.com', 'нешто', 'без адреса', office)).toBe('vbkonsalting@hotmail.com');
  });
  it('the document itself: anyone can send it for one of our firms', () => {
    const FA: MailFirm[] = F.map((f) => (f.id === 'travel' ? { ...f, accounts: ['270-0740123001-72'] } : f.id === 'own' ? { ...f, accounts: ['MK07 2700 7043 7160 114'] } : f));
    const b = { ...base, firms: FA };
    // a supplier (learned for ТРИМИ) sends an invoice whose buyer is АГРО ФАРМА → АГРО ФАРМА
    expect(mailMatch({ ...b, from: 'dadikompani@yahoo.com', learned: { 'dadikompani@yahoo.com': 'trimi' }, content: 'Фактура бр. 12 Купувач: АГРО ФАРМА ЕДБ MK4030000000001' })).toEqual({ firmId: 'agro', how: 'doc' });
    // the client sends its supplier's invoice (both our firms): the sender's firm stays
    expect(mailMatch({ ...b, from: 'sef@agro.mk', content: 'Продавач 4030000000002 Купувач 4030000000001' })).toEqual({ firmId: 'agro', how: 'email' });
    // the bank: only the account in the head; the other side's accounts further down do not count
    const stmt = 'HALKBANK Дневен извод Сметка: 270074012300172 ' + 'x'.repeat(2100) + ' 270070437160114';
    expect(mailMatch({ ...b, from: 'halkbank.notification@halkbank.mk', content: stmt })).toEqual({ firmId: 'travel', how: 'account' });
    expect(mailMatch({ ...b, from: 'x@y.mk', content: 'Извод за сметка MK07270070437160114' })).toEqual({ firmId: 'own', how: 'account' });
    // a supplier's invoice to the office itself
    expect(mailMatch({ ...b, from: 'x@y.mk', content: 'Купувач БАЈРАМИ ГРОУП ЕДБ 4030999999999' })).toEqual({ firmId: 'own', how: 'doc' });
    // nothing in the document → the sender rules
    expect(mailMatch({ ...b, from: 'sef@agro.mk', content: 'скениран' })).toEqual({ firmId: 'agro', how: 'email' });
    expect(mailMatch({ ...b, from: 'x@y.mk', content: '4030000000001 и 4030000000002' })).toEqual({ firmId: null, candidates: ['agro', 'trimi'] });
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
