import { describe, expect, it } from 'vitest';
import { bankByText, bankCodeOf, ibanValid, mkAccountValid, ppAccTxt, ppIban } from './payment-order';

describe('payment-order accounts', () => {
  it('ppIban builds a valid MK IBAN', () => {
    const iban = ppIban('100000000063095');
    expect(iban).toMatch(/^MK\d{2}100000000063095$/);
    expect(ibanValid(iban)).toBe(true);
    expect(ppIban('123')).toBe('');
  });
  it('ibanValid (mod-97)', () => {
    expect(ibanValid('DE89 3704 0044 0532 0130 00')).toBe(true);
    expect(ibanValid('DE89370400440532013001')).toBe(false);
    expect(ibanValid('MK07250120000058984')).toBe(true); // published MK example
    expect(ibanValid('MK0725012000005898')).toBe(false); // MK must be 19 chars
    expect(ibanValid('')).toBe(false);
  });
  it('mkAccountValid (ISO 7064 MOD 97-10 control digits)', () => {
    expect(mkAccountValid('100000000063095')).toBe(true); // Budget of RNM (NBRM)
    expect(mkAccountValid('100-0000000630-95')).toBe(true);
    expect(mkAccountValid('100000000063096')).toBe(false);
    expect(mkAccountValid('10000000006309')).toBe(false);
    expect(mkAccountValid(ppIban('100000000063095'))).toBe(true);
    expect(mkAccountValid('MK07250120000058984')).toBe(true);
    expect(mkAccountValid('abc')).toBe(false);
  });
  it('ppAccTxt switches to IBAN from 2026-11-01', () => {
    expect(ppAccTxt('100000000063095', '2026-10-31')).toBe('100-0000000630-95');
    expect(ppAccTxt('100000000063095', '2026-11-01')).toBe(ppIban('100000000063095'));
    expect(ppAccTxt('x', '2026-11-01')).toBe('x');
  });
  it('bank detection', () => {
    expect(bankCodeOf('MK07 270 0000 1234 5678')).toBe('270');
    expect(bankCodeOf('300000000299999')).toBe('300');
    expect(bankCodeOf('0123456789012')).toBe('300');
    expect(bankByText('BIC: KOBSMK2X')).toBe('300');
    expect(bankByText('Халк Банка')).toBe('270');
    expect(bankByText('nothing')).toBe('');
  });
});
