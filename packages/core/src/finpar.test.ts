import { describe, expect, it } from 'vitest';
import { applyOverride, diffOverride, overrideRows, type OvLine } from './finpar';

const base: OvLine[] = [
  { account: '1200', debit: 1180, credit: 0, partnerId: 'p1', doc: 'Ф-1' },
  { account: '7600', debit: 0, credit: 1000 },
  { account: '2300', debit: 0, credit: 180 },
  { account: '4400', debit: 0, credit: 0 },
];

describe('journal overrides (legacy nalSaveRows / ed / edAdd)', () => {
  it('round-trips editor rows → override → lines', () => {
    const rows = overrideRows(base.slice(0, 3), null);
    expect(rows).toHaveLength(3);
    rows[1] = { ...rows[1]!, account: '7610' };
    rows[2] = { ...rows[2]!, del: true };
    rows.push({ i: null, account: '2301', debit: 0, credit: 180, partnerId: null, note: 'ДДВ 18%', doc: '', del: false });
    const ov = diffOverride(base.slice(0, 3), rows);
    expect(ov.edits).toEqual([{ i: 1, k0: '7600', d0: 0, p0: 1000, account: '7610' }, { i: 2, k0: '2300', d0: 0, p0: 180, del: true }]);
    expect(ov.adds).toHaveLength(1);
    const r = applyOverride(base, ov);
    expect(r.changed).toBe(true);
    expect(r.lines.map((l) => [l.account, l.debit, l.credit])).toEqual([['1200', 1180, 0], ['7610', 0, 1000], ['2301', 0, 180]]);
    expect(overrideRows(base.slice(0, 3), ov).map((x) => [x.account, x.del])).toEqual([['1200', false], ['7610', false], ['2300', true], ['2301', false]]);
  });

  it('drops an edit when the document line changed (legacy: correction cancelled)', () => {
    const ov = { edits: [{ i: 1, k0: '7600', d0: 0, p0: 1000, account: '7610' }], adds: [] };
    const changed = [base[0]!, { account: '7600', debit: 0, credit: 900 }, base[2]!];
    const r = applyOverride(changed, ov);
    expect(r.applied).toBe(0);
    expect(r.dropped).toBe(1);
    expect(r.lines[1]!.account).toBe('7600');
  });

  it('no override = generated lines without zero rows', () => {
    expect(applyOverride(base, null).lines).toHaveLength(3);
    expect(diffOverride(base.slice(0, 3), overrideRows(base.slice(0, 3), null))).toEqual({ edits: [], adds: [] });
  });
});
