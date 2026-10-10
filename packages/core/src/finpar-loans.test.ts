import { describe, expect, it } from 'vitest';
import { loanBankKind, loanMovesFromBank } from './finpar-loans';

describe('loans from statement lines (legacy lnBankKind)', () => {
  it('classifies by payment code and text, skips lines already on loan kontos', () => {
    expect(loanBankKind({ id: '1', date: '2026-01-05', amount: -1000, desc: 'позајмица на сопственик', osnov: '' })).toEqual({ dir: 'given', kind: 'out', amt: 1000 });
    expect(loanBankKind({ id: '2', date: '2026-01-05', amount: 500, desc: 'Уплата', osnov: '468' })).toEqual({ dir: 'received', kind: 'out', amt: 500 });
    expect(loanBankKind({ id: '3', date: '2026-01-05', amount: 500, desc: 'поврат на заем', osnov: '' })).toEqual({ dir: 'given', kind: 'back', amt: 500 });
    expect(loanBankKind({ id: '4', date: '2026-01-05', amount: 500, desc: 'фактура 12', osnov: '' })).toBeNull();
    const M = loanMovesFromBank([
      { id: 'a', date: '2026-01-05', amount: -1000, desc: 'позајмица', konto: '2200' },
      { id: 'b', date: '2026-01-06', amount: -1000, desc: 'позајмица', konto: '1600' },
    ]);
    expect(M.map((m) => m.id)).toEqual(['B:a']);
  });
});
