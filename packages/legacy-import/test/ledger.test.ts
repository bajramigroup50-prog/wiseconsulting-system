import { describe, expect, it } from 'vitest';
import { parseBackupJson } from '../src/format';
import { legacyLedger, pddEntries, trialBalanceOf } from '../src/ledger';
import { fixtureBackup } from './fixture';

const fb = () => parseBackupJson(fixtureBackup(), 'x.json').firms[0]!;
const src = (key: string, opts = {}) => legacyLedger(fb(), opts).sources.find((s) => s.key === key)!;
const sum = (L: { d: number; p: number }[]) => L.reduce((a, l) => ({ d: a.d + l.d, p: a.p + l.p }), { d: 0, p: 0 });

describe('legacy ledger port', () => {
  it('keeps stored invoice lines and adds the VAT-base (994/999) lines', () => {
    const s = src('invoice:inv1');
    expect(s.journalKind).toBe('izlez');
    expect(s.lines.map((l) => [l.k, l.d, l.p])).toEqual([
      ['1200', 2360, 0], ['7400', 0, 2000], ['230018', 0, 360], ['994018', 2000, 0], ['999018', 0, 2000],
    ]);
    expect(s.lines.every((l) => l.doc === '1/2026')).toBe(true);
    expect(src('invoice:inv1', { vatBaseLines: false }).lines).toHaveLength(3);
  });

  it('books credit notes as red storno and applies the nalog correction overlay (ed)', () => {
    const s = src('invoice:inv2');
    expect(s.journalKind).toBe('odobr');
    const main = s.lines.slice(0, 3).map((l) => [l.k, l.d, l.p]);
    expect(main).toEqual([['1200', -118, 0], ['7401', 0, -100], ['230018', 0, -18]]);
    // negative VAT base in storno mode → negative amounts on the same sides
    expect(s.lines.slice(3).map((l) => [l.k, l.d, l.p])).toEqual([['994018', -100, 0], ['999018', 0, -100]]);
  });

  it('skips client-submitted (pend) documents like legacy', () => {
    expect(legacyLedger(fb()).sources.some((s) => s.key === 'invoice:inv3')).toBe(false);
  });

  it('recomputes bank lines and groups them per statement (account + date)', () => {
    const s = src('bank:b1|2026-02-05');
    expect(s.lines.map((l) => [l.k, l.d, l.p, l.partner])).toEqual([
      ['1000', 2360, 0, undefined], ['1200', 0, 2360, 'p1'], ['2200', 7080, 0, 'p2'], ['1000', 0, 7080, undefined],
    ]);
  });

  it('posts cash vouchers live (blgEntries) and moves per source document', () => {
    const b = src('blg:blg1');
    expect(sum(b.lines)).toEqual({ d: 118, p: 118 });
    expect(b.lines.some((l) => l.k === '1020' && l.p === 118)).toBe(true);
    expect(src('moves:inv-inv1-0').lines.map((l) => l.k)).toEqual(['7000', '6600']);
  });

  it('every source is balanced and the trial balance totals match', () => {
    const { sources } = legacyLedger(fb());
    for (const s of sources) { const t = sum(s.lines); expect(Math.round(t.d * 100)).toBe(Math.round(t.p * 100)); }
    const tb = trialBalanceOf(sources.flatMap((s) => s.lines));
    expect(tb.get('1000')).toEqual({ account: '1000', debit: 52360, credit: 7080 });
  });

  it('ports ПДД (rent / author fees) with the default types', () => {
    const L = pddEntries({ id: 'x', rows: [{ tid: 's6_1', amt: 10000, name: 'Закуп', pid: 'p9' }] }, { id: 'f' });
    expect(L.map((l) => [l.k, l.d, l.p])).toEqual([['4143', 10000, 0], ['22052', 0, 9100], ['23502', 0, 900]]);
  });
});
