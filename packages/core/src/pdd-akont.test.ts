import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAkontativna } from './pdd-akont';
import type { PdfItem } from './noai/pdf-lines';

// the text layer of a real „Аконтативна пресметка“ with invented persons, accounts and payer (УЈП е-ПДД, landscape: its text runs along y)
const ITEMS = JSON.parse(readFileSync(new URL('./pdd-akont.fixture.json', import.meta.url), 'utf8')) as PdfItem[];

describe('аконтативна пресметка (PDF)', () => {
  it('reads the header and every recipient', () => {
    const A = parseAkontativna(ITEMS)!;
    expect(A).toMatchObject({ number: '011026000001', date: '2026-10-01', payDate: '2026-10-05', edb: '4000000000001' });
    expect(A.rows.map((r) => [r.name, r.embg, r.acct, r.code, r.gross, r.tax, r.net])).toEqual([
      ['ПЕТАР ПЕТРОВСКИ', '0101990450011', '200000000000011', 'S1.15', 44444, 4444, 40000],
      ['АНА АНОВСКА', '0202991450022', '200000000000022', 'S1.15', 28889, 2889, 26000],
      ['МАРКО МАРКОВСКИ', '0303992450033', '200000000000033', 'S1.15', 33333, 3333, 30000],
      ['ЕЛЕНА ЕЛЕНОВСКА', '0404993450044', '200000000000044', 'S1.15', 33333, 3333, 30000],
    ]);
  });
  it('the same page with the axes swapped (another PDF producer)', () => {
    const A = parseAkontativna(ITEMS.map((i) => ({ ...i, x: i.y, y: i.x })))!;
    expect(A.rows.length).toBe(4);
    expect(A.rows[2]).toMatchObject({ name: 'МАРКО МАРКОВСКИ', net: 30000 });
  });
  it('anything else is not an аконтативна пресметка', () => {
    expect(parseAkontativna([{ page: 1, x: 1, y: 1, w: 1, s: 'Фактура' }])).toBeNull();
  });
});
