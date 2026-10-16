/** UX Phase 3 (P28/P29): the one-pass proposals (reference → matching → FIFO) and their confidence, pure. */
import { describe, expect, it } from 'vitest';
import type { BankRow, MatchContext, OpenDoc } from '../bank-match';
import { autoSteps, refNumbers, reviewConfidence, reviewMatch } from './review';

const inv = (id: string, number: string, date: string, total: number, partner = 'c'): OpenDoc => ({ id, number, date, total, partner });
const ctx = (rows: BankRow[], invoices: OpenDoc[]): MatchContext => ({
  rows, accounts: [{ id: 'main', name: 'Банка', konto: '1000', cur: 'MKD' }], invoices, purchases: [], year: 2026, firmName: 'Фирма ДООЕЛ',
  partners: [{ id: 'c', name: 'Купувач ДОО' }, { id: 'a', name: 'Алфа ДОО' }],
});

describe('reviewMatch', () => {
  it('reference („Повикување на број“) → the document, before any amount rule', () => {
    const r: BankRow = { id: 'l1', date: '2026-05-01', amount: 50_000, desc: 'уплата', name: 'Алфа ДОО', bref: '17/2026' };
    const C = reviewMatch(ctx([r], [inv('x', '16/2026', '2026-01-01', 50_000, 'a'), inv('y', '17/2026', '2026-02-01', 118_000, 'a')]));
    expect(C.get('l1')).toMatchObject({ how: 'ref', partnerOk: true, refs: [{ id: 'y', amt: 50_000 }] });
    expect(reviewConfidence({ how: 'ref', konto: C.get('l1')!.row.konto!, partnerOk: true })).toBe('sure');
  });

  it('FIFO over three open invoices: the oldest first, the last partially; a second payment sees the rest', () => {
    const rows: BankRow[] = [
      { id: 'p1', date: '2026-05-01', amount: 300_000, desc: 'уплата', name: 'Купувач ДОО' },
      { id: 'p2', date: '2026-05-02', amount: 54_000, desc: 'уплата', name: 'Купувач ДОО' },
    ];
    const C = reviewMatch(ctx(rows, [inv('c3', '3', '2026-03-01', 118_000), inv('c1', '1', '2026-01-01', 118_000), inv('c2', '2', '2026-02-01', 118_000)]));
    expect(C.get('p1')).toMatchObject({ how: 'fifo', refs: [{ id: 'c1', amt: 118_000 }, { id: 'c2', amt: 118_000 }, { id: 'c3', amt: 64_000 }] });
    expect(C.get('p2')).toMatchObject({ how: 'fifo', refs: [{ id: 'c3', amt: 54_000 }] });
    expect(C.get('p1')!.row).toMatchObject({ konto: '1200', partner: 'c' });
  });

  it('an unknown counterparty gets no FIFO; an overpayment keeps the excess as an advance', () => {
    const rows: BankRow[] = [
      { id: 'u', date: '2026-05-01', amount: 10_000, desc: 'непознато' },
      { id: 'o', date: '2026-05-01', amount: 200_000, desc: 'уплата', name: 'Алфа ДОО' },
    ];
    const C = reviewMatch(ctx(rows, [inv('a1', '9', '2026-01-01', 118_000, 'a')]));
    expect(C.has('u')).toBe(false);
    expect(C.get('o')).toMatchObject({ how: 'fifo', excess: 82_000, refs: [{ id: 'a1', amt: 118_000 }] });
  });

  it('reference numbers and the default switches', () => {
    expect(refNumbers({ purpose: 'Плаќање по фактура бр. 12/2026' }).map((k) => k.n)).toEqual([12]);
    expect(refNumbers({ bref: '' })).toEqual([]);
    expect(autoSteps(undefined)).toEqual({ book: false, link: false, repost: false });
  });
});
