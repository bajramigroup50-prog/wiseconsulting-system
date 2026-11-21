import { describe, expect, it } from 'vitest';
import { rcCheck, rcFilter, rcFind, rcKontoMatch, rcPath, rcPreview, rcUndoItems, type RcLine } from './reclass';

const L = (o: Partial<RcLine>): RcLine => ({
  id: 1, journalId: 'j', lineNo: 1, date: '2026-05-10', kind: 'manual', number: '1', jdesc: null, sourceType: null, jlocked: false,
  account: '4030', partnerId: null, debit: 100, credit: 0, note: null, doc: null, locationId: null, ...o,
});

describe('reclass rules', () => {
  it('konto prefix and range', () => {
    expect(rcKontoMatch('40300', '403')).toBe(true);
    expect(rcKontoMatch('4040', '403')).toBe(false);
    expect(rcKontoMatch('4100', '40', '41')).toBe(true);
    expect(rcKontoMatch('41999', '40', '41')).toBe(true);
    expect(rcKontoMatch('4200', '40', '41')).toBe(false);
  });

  it('filter by period, partner, text, amount and location', () => {
    const X = [L({ id: 1 }), L({ id: 2, date: '2026-07-01', partnerId: 'p', note: 'Закуп магацин', debit: 0, credit: 5000 }), L({ id: 3, locationId: 'm2' })];
    expect(rcFilter(X, { from: '2026-06-01' }).map((l) => l.id)).toEqual([2]);
    expect(rcFilter(X, { partnerId: 'p' }).map((l) => l.id)).toEqual([2]);
    expect(rcFilter(X, { text: 'закуп' }).map((l) => l.id)).toEqual([2]);
    expect(rcFilter(X, { amtMin: 1000 }).map((l) => l.id)).toEqual([2]);
    expect(rcFilter(X, { locationId: 'm2' }).map((l) => l.id)).toEqual([3]);
  });

  it('paths and refusals', () => {
    expect(rcPath('bank', 'bank_statement')).toBe('bank');
    expect(rcPath('izlez', 'invoice')).toBe('doc');
    expect(rcPath('manual', null)).toBe('manual');
    expect(rcCheck(L({}), { account: '4460' }, { lockDate: '2026-05-31' })).toMatchObject({ ok: false, reason: expect.stringMatching(/Заклучен период/) });
    expect(rcCheck(L({ kind: 'close' }), { account: '4460' })).toMatchObject({ ok: false });
    expect(rcCheck(L({ jlocked: true }), { account: '4460' })).toMatchObject({ ok: false });
    expect(rcCheck(L({}), { account: '4030' })).toMatchObject({ ok: false, reason: expect.stringMatching(/Без промена/) });
    expect(rcCheck(L({ kind: 'izlez', sourceType: 'invoice', account: '1200', partnerId: 'a' }), { partnerId: 'b' })).toMatchObject({ ok: false });
    expect(rcCheck(L({}), { account: '2200' })).toMatchObject({ ok: false, reason: expect.stringMatching(/бара комитент/) });
    expect(rcCheck(L({}), { account: '9999' }, { kontos: new Set(['4460']) })).toMatchObject({ ok: false });
    expect(rcCheck(L({}), { account: '4460' })).toMatchObject({ ok: true, account: '4460', path: 'manual' });
  });

  it('preview totals per konto before / after', () => {
    const P = rcPreview([L({ id: 1, debit: 100 }), L({ id: 2, debit: 50 }), L({ id: 3, debit: 25, date: '2026-01-05' })], { account: '4460' }, { lockDate: '2026-01-31' });
    expect(P.ok).toBe(2);
    expect(P.blocked).toBe(1);
    expect(P.totals).toEqual([
      { konto: '4030', debitBefore: 175, creditBefore: 0, debitAfter: 25, creditAfter: 0, diff: -150 },
      { konto: '4460', debitBefore: 0, creditBefore: 0, debitAfter: 150, creditAfter: 0, diff: 150 },
    ]);
  });

  it('undo swaps old and new; the current line is found by its values', () => {
    const it0 = { path: 'manual' as const, journalId: 'j', number: '1', date: '2026-05-10', lineNo: 2, debit: 100, credit: 0, old: { account: '4030', partnerId: null }, new: { account: '4460', partnerId: null } };
    const [u] = rcUndoItems([it0]);
    expect(u!.old.account).toBe('4460');
    const cur = [L({ lineNo: 1, account: '4460' }), L({ lineNo: 2, account: '4460' }), L({ lineNo: 3, account: '4030' })];
    expect(rcFind(cur, u!)!.lineNo).toBe(2);
    expect(rcFind(cur, { ...u!, debit: 7 })).toBeNull();
  });
});
