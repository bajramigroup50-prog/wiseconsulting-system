import { describe, expect, it } from 'vitest';
import { classifyPartnerId, findPartnerMatch, learnPartnerAlias, nameScore, nameTokens, partnerIdLabel, type MatchablePartnerRow } from './match';
import { saleDraftFromScan, purchaseDraftFromScan } from '../sales/scan';

const P: MatchablePartnerRow[] = [
  { id: 'jzu', name: 'ЈУ ОД ОБЛАСТА НА ЗДРАВ.ЗА ПОТРЕБА НА ЈЗУ', code: '120' },
  { id: 'alfa', name: 'Алфа ДООЕЛ Скопје', code: '1', edb: 'MK4030990123456' },
  { id: 'beta', name: 'Бета ДООЕЛ Скопје', code: '2', embs: '6259961' },
  { id: 'kb', name: 'Комерцијална банка АД Скопје', code: '3', data: { accounts: [{ acc: '300000001234555', iban: '', bank: 'КБ' }] } },
  { id: 'cent', name: 'Центар ДООЕЛ', code: '4' },
];

describe('identifiers', () => {
  it('classifies ЕДБ / ЕМБС / bank account', () => {
    expect(classifyPartnerId('MK4030990123456')).toMatchObject({ kind: 'edb', value: '4030990123456', store: 'MK4030990123456' });
    expect(classifyPartnerId('4030990123456').kind).toBe('edb');
    expect(classifyPartnerId('6259960')).toMatchObject({ kind: 'embs', value: '6259960' });
    expect(classifyPartnerId('300-0000012345-55').kind).toBe('bank');
    expect(classifyPartnerId('12345').kind).toBe('');
    expect(partnerIdLabel(classifyPartnerId('6259960').kind)).toBe('ЕМБС');
    expect(partnerIdLabel(classifyPartnerId('MK4030990123456').kind)).toBe('ЕДБ');
  });
  it('a 13-digit ЕДБ matches the partner ЕДБ', () => {
    const m = findPartnerMatch(P, { name: 'нешто друго', id: '4030990123456' });
    expect([m.partner?.id, m.by]).toEqual(['alfa', 'edb']);
  });
  it('a 7-digit ЕМБС matches the ЕМБС (not the end of an ЕДБ)', () => {
    const m = findPartnerMatch(P, { name: 'Бета', id: '6259961' });
    expect([m.partner?.id, m.by, m.id.kind]).toEqual(['beta', 'embs', 'embs']);
    expect(findPartnerMatch(P, { name: 'X', id: '0123456' }).partner).toBeNull();
  });
  it('the bank account matches the partner accounts', () => {
    expect(findPartnerMatch(P, { name: 'X', bankAccount: '300000001234555' }).partner?.id).toBe('kb');
  });
});

describe('names', () => {
  it('abbreviated Cyrillic name ↔ the full (cut) name of the opening balance', () => {
    const m = findPartnerMatch(P, { name: 'ЈУ од Областа на Здр. за потребите на ЈЗУ УК завод и Ургентен Центар', id: '6259960' });
    expect(m.id.kind).toBe('embs');
    expect([m.partner?.id, m.by]).toEqual(['jzu', 'name']);
    expect(m.score).toBeGreaterThanOrEqual(0.85);
  });
  it('Latin ↔ Cyrillic', () => {
    expect(nameScore('JU OD OBLASTA NA ZDRAV.ZA POTREBA NA JZU', 'ЈУ ОД ОБЛАСТА НА ЗДРАВ.ЗА ПОТРЕБА НА ЈЗУ')).toBe(1);
    const m = findPartnerMatch(P, { name: 'JU OD OBLASTA NA ZDRAV.ZA POTREBA NA JZU' });
    expect([m.partner?.id, m.by]).toEqual(['jzu', 'exact']);
    expect(nameScore('ŽITO ŠTIP', 'Жито Штип')).toBe(1);
  });
  it('old-font (YUSCII) characters', () => {
    expect(nameTokens('ДЕЛ^ЕВ ТРАНС')).toEqual(nameTokens('Делчев Транс'));
    expect(nameScore('DEL^EV TRANS', 'ДЕЛЧЕВ ТРАНС')).toBe(1);
  });
  it('legal and stop words never make a match', () => {
    expect(nameScore('Алфа ДООЕЛ Скопје', 'Бета ДООЕЛ Скопје')).toBe(0);
    const m = findPartnerMatch(P, { name: 'Гама ДООЕЛ Скопје' });
    expect(m.partner).toBeNull();
    expect(m.candidates).toEqual([]);
    expect(nameTokens('Д.О.О.Е.Л. Алфа')).toEqual(['alfa']);
  });
  it('one shared word in a long name is no candidate', () => {
    const m = findPartnerMatch([P[4]!], { name: 'Ургентен Центар' });
    expect(m.partner).toBeNull();
    expect(m.candidates).toEqual([]);
  });
  it('two similar partners → candidates, no automatic selection', () => {
    const Q: MatchablePartnerRow[] = [{ id: 'm1', name: 'Мега Маркет 1 ДОО', code: '10' }, { id: 'm2', name: 'Мега Маркет 2 ДОО', code: '11', edb: '4000000000001' }, ...P];
    const m = findPartnerMatch(Q, { name: 'МЕГА МАРКЕТ' });
    expect(m.partner).toBeNull();
    expect(m.candidates.map((c) => c.id).sort()).toEqual(['m1', 'm2']);
    expect(m.candidates.find((c) => c.id === 'm2')).toMatchObject({ code: '11', edb: '4000000000001' });
  });
});

describe('learning', () => {
  it('the picked partner remembers the name and the identifier', () => {
    const doc = { name: 'ЈУ Здр. Ургентен', id: '6259960' };
    const before = findPartnerMatch(P, doc);
    expect(before.partner).toBeNull();
    const L = learnPartnerAlias(P[0]!, doc);
    expect(L.changed).toBe(true);
    expect(L.saveId).toEqual({ kind: 'embs', value: '6259960' });
    const P2 = P.map((p) => (p.id === 'jzu' ? { ...p, data: L.data } : p));
    expect(findPartnerMatch(P2, { name: 'ЈУ ЗДР. УРГЕНТЕН' })).toMatchObject({ by: 'alias', partner: { id: 'jzu' } });
    // a partner with another ЕМБС learns the document's as an alias id
    const L2 = learnPartnerAlias({ ...P[0]!, embs: '1111111' }, doc);
    expect(L2.saveId).toBeUndefined();
    const P3 = P.map((p) => (p.id === 'jzu' ? { ...p, embs: '1111111', data: L2.data } : p));
    expect(findPartnerMatch(P3, { name: 'X', id: '6259960' })).toMatchObject({ by: 'embs', partner: { id: 'jzu' } });
  });
});

describe('scan drafts', () => {
  it('the sale draft selects the partner by name and labels the ЕМБС', () => {
    const d = saleDraftFromScan({ buyerName: 'ЈУ од Областа на Здр. за потребите на ЈЗУ УК завод и Ургентен Центар', buyerEdb: '6259960', lines: [{ name: 'x', qty: 1, price: 10 }] },
      { partners: P, items: [], revKonto: '7600', today: '2026-10-17', nextNumber: '1' });
    expect(d.partnerId).toBe('jzu');
    expect(d.match).toMatchObject({ by: 'name', idKind: 'embs', id: '6259960' });
  });
  it('the purchase draft gives candidates and no partner', () => {
    const Q: MatchablePartnerRow[] = [{ id: 'm1', name: 'Мега Маркет 1' }, { id: 'm2', name: 'Мега Маркет 2' }];
    const d = purchaseDraftFromScan({ supplierName: 'Мега Маркет', total: 118 }, { partners: Q, items: [], today: '2026-10-17', accounts: { goods: '6600', material: '3100', other: '4000' } });
    expect(d.partnerId).toBe('');
    expect(d.match?.candidates).toHaveLength(2);
  });
  it('a new buyer with a 7-digit ЕМБС: no match, no candidates', () => {
    const d = saleDraftFromScan({ buyerName: 'Гиро Мамас ДООЕЛ', buyerEdb: '6558500', lines: [{ name: 'x', qty: 1, price: 10 }] },
      { partners: P, items: [], revKonto: '7600', today: '2026-10-17', nextNumber: '1' });
    expect(d.partnerId).toBe('');
    expect(d.match).toMatchObject({ by: '', idKind: 'embs', id: '6558500', candidates: [] });
  });
});
