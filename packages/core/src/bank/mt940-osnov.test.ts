import { describe, expect, it } from 'vitest';
import { mt940Osnov, parseMT940 } from '../bank-parsers';

describe('MT940 payment code (шифра на плаќање)', () => {
  it('reads /PURP/, ?00 and „шифра“, only codes from the official list', () => {
    expect(mt940Osnov('/PURP/GDSV/REMI/фактура 12')).toBe('GDSV');
    expect(mt940Osnov('?00930?20Плаќање ф-ра 5')).toBe('930');
    expect(mt940Osnov('?20Плата октомври шифра 101')).toBe('101');
    expect(mt940Osnov('?20фактура ABCD 2026')).toBe('');
    expect(mt940Osnov('/PURP/ZZZZ')).toBe('');
  });
  it('the line of a statement carries it', () => {
    const t = [':20:1', ':25:270000000012345', ':28C:5', ':60F:C261110MKD1000,00',
      ':61:2611101110D200,00NTRFNONREF//X1', ':86:?00FEES?20Провизија?32ХАЛК БАНКА',
      ':62F:C261110MKD800,00', ''].join('\n');
    const [st] = parseMT940(t);
    expect(st!.lines[0]!.osnov).toBe('FEES');
    expect(st!.lines[0]!.amount).toBe(-20000);
  });
});
