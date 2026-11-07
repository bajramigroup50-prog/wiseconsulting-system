import { describe, expect, it } from 'vitest';
import { bundleGroups } from './trip-bundle';

describe('bundleGroups', () => {
  it('splits invoice, CMR, travel order and receipts, joining neighbours of the same kind', () => {
    const r = bundleGroups({ groups: [
      { from: 1, to: 1, kind: 'invoice', number: '12/26' }, { from: 2, to: 2, kind: 'invoice', number: '12/26' },
      { from: 3, to: 3, kind: 'cmr' }, { from: 4, to: 5, kind: 'travel' }, { from: 6, to: 6, kind: 'receipt' }, { from: 7, to: 7, kind: 'receipt' },
    ] }, 7);
    expect(r).toEqual([
      { from: 1, to: 2, kind: 'invoice', number: '12/26' }, { from: 3, to: 3, kind: 'cmr', number: '' },
      { from: 4, to: 5, kind: 'travel', number: '' }, { from: 6, to: 7, kind: 'receipt', number: '' },
    ]);
  });
  it('keeps two invoices with different numbers apart', () => {
    expect(bundleGroups({ groups: [{ from: 1, to: 1, kind: 'invoice', number: '1' }, { from: 2, to: 2, kind: 'invoice', number: '2' }] }, 2)).toHaveLength(2);
  });
  it('refuses gaps or missing pages', () => {
    expect(bundleGroups({ groups: [{ from: 1, to: 1, kind: 'cmr' }, { from: 3, to: 3, kind: 'cmr' }] }, 3)).toBeNull();
    expect(bundleGroups({ groups: [] }, 1)).toBeNull();
  });
  it('maps an unknown kind to other', () => {
    expect(bundleGroups({ groups: [{ from: 1, to: 1, kind: 'weird' }] }, 1)).toEqual([{ from: 1, to: 1, kind: 'other', number: '' }]);
  });
});
