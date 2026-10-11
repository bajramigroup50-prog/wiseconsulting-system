import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { SPLIT_PROMPT, splitGroups } from './split';

describe('multi-invoice PDF split (legacy invSplit 13685)', () => {
  it('accepts only contiguous groups covering every page', () => {
    expect(splitGroups({ groups: [{ from: 1, to: 2, number: 'A' }, { from: 3, to: 3 }] }, 3)).toEqual([{ from: 1, to: 2, number: 'A' }, { from: 3, to: 3, number: '' }]);
    expect(splitGroups({ groups: [{ from: 1, to: 3 }] }, 3)).toBeNull();
    expect(splitGroups({ groups: [{ from: 1, to: 1 }, { from: 3, to: 3 }] }, 3)).toBeNull();
    expect(splitGroups({ groups: [{ from: 1, to: 1 }, { from: 2, to: 2 }] }, 3)).toBeNull();
    expect(splitGroups(null, 3)).toBeNull();
  });
  it('keeps the legacy prompt', () => {
    expect(SPLIT_PROMPT(4)).toContain('This PDF has 4 pages and may contain SEVERAL separate invoices');
    expect(SPLIT_PROMPT(4)).toContain('covering every page 1..4 in order without gaps.');
  });
  it('pdf-lib copies page ranges', async () => {
    const d = await PDFDocument.create();
    for (let i = 0; i < 3; i++) d.addPage();
    const src = await PDFDocument.load(await d.save());
    const p = await PDFDocument.create();
    (await p.copyPages(src, [1, 2])).forEach((x) => p.addPage(x));
    expect((await PDFDocument.load(await p.save())).getPageCount()).toBe(2);
  });
});
