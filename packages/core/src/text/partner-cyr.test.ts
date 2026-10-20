import { describe, expect, it } from 'vitest';
import { cyrMode, foreignReason, isKbdLatin, partnerCyrFix, partnerToCyr } from './partner-cyr';

describe('partnerToCyr', () => {
  it('keyboard Latin (a key inside a word) goes key by key', () => {
    expect(isKbdLatin('MA[INSKA RABOTILNICA DOOEL')).toBe(true);
    expect(partnerToCyr('MA[INSKA RABOTILNICA DOOEL')).toBe('МАШИНСКА РАБОТИЛНИЦА ДООЕЛ');
    expect(partnerToCyr('KU;E DOOEL')).toBe('КУЧЕ ДООЕЛ');
    expect(partnerToCyr('Ul. Kosta Novakovi\' 5')).toBe('Ул. Коста Новакови\' 5');
    expect(partnerToCyr('SRE\'A TRADE')).toBe('СРЕЌА ТРАДЕ');
  });
  it('other Latin goes letter by letter with the digraphs', () => {
    expect(cyrMode('Xhemaili Shpk')).toBe('lat');
    expect(partnerToCyr('Bajrami DOOEL Shtip')).toBe('Бајрами ДООЕЛ Штип');
    expect(partnerToCyr('Skopje; Centar')).toBe('Скопје; Центар');
  });
  it('YUSCII leftovers in Cyrillic are repaired, Cyrillic and digits stay', () => {
    expect(cyrMode('ГОЦЕ ДЕЛ^ЕВ 12')).toBe('yuscii');
    expect(partnerToCyr('ГОЦЕ ДЕЛ^ЕВ 12')).toBe('ГОЦЕ ДЕЛЧЕВ 12');
    expect(partnerToCyr('БАЈРАМИ ГРУП ДООЕЛ')).toBe('БАЈРАМИ ГРУП ДООЕЛ');
    expect(cyrMode('12345')).toBeNull();
    expect(partnerToCyr(null)).toBe('');
  });
  it('e-mail and web addresses are not keyboard Latin', () => {
    expect(isKbdLatin('info@firma.mk')).toBe(false);
  });
});

describe('foreignReason', () => {
  it('flags real foreign companies', () => {
    expect(foreignReason({ name: 'Microsoft Ireland Operations Ltd' })).toMatch(/microsoft/);
    expect(foreignReason({ name: 'Google LLC' })).toMatch(/google|llc/);
    expect(foreignReason({ name: 'KFC', edb: 'IE6388047V' })).toMatch(/IE6388047V/);
    expect(foreignReason({ name: 'Wolt', country: 'Germany' })).toMatch(/Germany/);
    expect(foreignReason({ name: 'X', foreign: true })).toBe('странски комитент');
  });
  it('keeps domestic partners convertible', () => {
    expect(foreignReason({ name: 'BAJRAMI GROUP DOOEL', edb: '4030000000000' })).toBeNull();
    expect(foreignReason({ name: 'KAN INTERNATIONAL TRADING DOO' })).toBeNull();
    expect(foreignReason({ name: 'MA[INI SERVICES' })).toBeNull();
    expect(foreignReason({ name: 'Petrovski', edb: 'MK 4030000000000', country: 'Македонија' })).toBeNull();
  });
});

describe('partnerCyrFix', () => {
  it('converts the three fields and reports the foreign hint only when something changes', () => {
    const f = partnerCyrFix({ name: 'TRULI NOLEN DOOEL', address: 'ul. Partizanska 3', city: 'Skopje', edb: '4030000000000' });
    expect(f).toEqual({ name: 'ТРУЛИ НОЛЕН ДООЕЛ', address: 'ул. Партизанска 3', city: 'Скопје', changed: true, foreign: null });
    expect(partnerCyrFix({ name: 'Microsoft Ireland', city: 'Dublin' }).foreign).toMatch(/microsoft/);
    expect(partnerCyrFix({ name: 'ТРУЛИ НОЛЕН', city: 'Скопје' }).changed).toBe(false);
  });
});
