import { describe, expect, it } from 'vitest';
import { nextCode } from './codes';
import { fmt, fq, toCsv } from './fmt';

describe('fmt / fq (mk-MK style, runtime independent)', () => {
  it('formats amounts', () => {
    expect(fmt(1234567.891)).toBe('1.234.567,89');
    expect(fmt(-2360)).toBe('-2.360,00');
    expect(fmt('0')).toBe('0,00');
    expect(fmt(-0.001)).toBe('0,00');
    expect(fmt(null)).toBe('0,00');
    expect(fq(1234.5)).toBe('1.234,5');
    expect(fq(2)).toBe('2');
  });
  it('csv quotes separators', () => {
    expect(toCsv([['a;b', 1], ['x"y', null]])).toBe('﻿"a;b";1\r\n"x""y";');
  });
  it('nextCode keeps zero padding (legacy nextCode)', () => {
    expect(nextCode([])).toBe('1');
    expect(nextCode(['1', '7', 'x'])).toBe('8');
    expect(nextCode(['0007', '0010'])).toBe('0011');
  });
});
