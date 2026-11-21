import { describe, expect, it } from 'vitest';
import { headerPurchaseData, blankHeader } from './kalk-header';

describe('kalk header → purchase nalog', () => {
  it('the nalog chosen in the dialog is the purchase nalog (posted into it), not only a note', () => {
    const h = { ...blankHeader('2026-11-21'), nalog: '2/10' };
    expect(headerPurchaseData(h)).toMatchObject({ nalogNo: '2/10', hxNalog: '2/10' });
    expect(headerPurchaseData(blankHeader('2026-11-21')).nalogNo).toBeUndefined();
  });
});
