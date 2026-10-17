/** Numbered posting schemes: who may edit them (semi) and who may choose one on a document (the document screens). */
import { describe, expect, it } from 'vitest';
import { BOOK_ONLY_VIEWS, bookActionAllowed, restrictedViews } from './route-guard';

const V = restrictedViews({ role: 'acc' }, { on: true, owner: 'no', access: null })!;

describe('scheme profiles and book-only colleagues', () => {
  it('semi (editing schemes) stays hidden; the document screens are open', () => {
    expect(BOOK_ONLY_VIEWS).not.toContain('semi');
    for (const v of ['izlez', 'vlez', 'nalozi', 'partneri', 'uvoz', 'skan', 'masovno']) expect(BOOK_ONLY_VIEWS).toContain(v);
  });
  it('the scheme editor actions are refused, choosing a scheme on documents is allowed', () => {
    expect(bookActionAllowed('app/(app)/semi/profile-actions.ts', V)).toBe(false);
    expect(bookActionAllowed('app/(app)/nalozi/scheme-actions.ts', V)).toBe(true);
    expect(bookActionAllowed('app/(app)/izlez/actions.ts', V)).toBe(true);
    expect(bookActionAllowed('app/(app)/vlez/actions.ts', V)).toBe(true);
    expect(bookActionAllowed('app/(app)/partneri/actions.ts', V)).toBe(true);
    expect(bookActionAllowed('app/(app)/skan/actions.ts', V)).toBe(true);
    expect(bookActionAllowed('app/(app)/_retail/actions.ts', V)).toBe(true);
  });
});
