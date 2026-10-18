import { describe, expect, it } from 'vitest';
import { linePartner, partnerByAccount, resolvePartner } from '../bank-match';

const P = [
  { id: 'a', name: 'БЕХТЕЛ ЕНКА ДОО', accs: ['300000001234567', '210000009876543'] },
  { id: 'b', name: 'АСУРА ДООЕЛ', accs: ['MK07250120000058984'] },
  { id: 'c', name: 'КАН ДОО', accs: ['380000005555555'] },
  { id: 'd', name: 'КАН ДООЕЛ', accs: ['380000005555555'] },
];

describe('partnerByAccount', () => {
  it('one company, any of its accounts → the same partner', () => {
    expect(partnerByAccount(P, '300-0000012345-67')).toBe('a');
    expect(partnerByAccount(P, '210 000009876543')).toBe('a');
    expect(partnerByAccount(P, '250120000058984')).toBe('b');
  });
  it('an account two partners share is not a guess; unknown accounts fall back to the name', () => {
    expect(partnerByAccount(P, '380000005555555')).toBe('');
    expect(linePartner(P, { counterAccount: '999000001111111' }, 'АСУРА ДООЕЛ')).toBe('b');
  });
  it('the account wins over a name read differently', () => {
    expect(resolvePartner({ id: 'x', date: '2026-09-01', amount: 100, desc: 'BEHTEL ENKA JV', name: 'BEHTEL ENKA JV', counterAccount: '210000009876543' }, { partners: P, invoices: [], purchases: [] })).toEqual({ partner: 'a' });
  });
});
