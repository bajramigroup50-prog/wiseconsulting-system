import { describe, expect, it } from 'vitest';
import { costPerPortion, monthDays, monthSummary, parseRegister, sameBeneficiary } from './meals';
import { klAllowedViews } from './office/portal';
import { nkdProfiles, suggestedModules, viewEnabled } from './industry/modules';

describe('🍲 meals', () => {
  it('reads the association register (Albanian headers, empty rows, multi-line cells)', () => {
    const rows = [
      ['Nr.', 'Emri dhe Mbiemri', 'Anëtarë', 'Nacionaliteti', 'Përshkrimi / Gjendja', 'Numri Amë', 'Vendbanimi', 'Kontakt'],
      [1, 'Ramush Emini', 5, 'Shqiptarë', 'Rast social.', '1501968450045', 'Fushë Topane', '070755163'],
      [8, 'Rexhep Berisha', '2', 'Shqiptarë', 'invalid', '1602975450094', 'Fushe Topane\nTeneqe Mahalle', '071476020'],
      [9, '', '', '', '', '', '', ''],
      [11, 'Kimete Llokmani', '', 'Shqiptarë', 'Nëna me 4 fëmijë', '', 'Gazibabë', '079270183'],
    ];
    const r = parseRegister(rows);
    expect(r.list).toHaveLength(3);
    expect(r.list[0]).toMatchObject({ no: 1, name: 'Ramush Emini', members: 5, embg: '1501968450045', place: 'Fushë Topane', phone: '070755163' });
    expect(r.list[1]!.place).toBe('Fushe Topane Teneqe Mahalle');
    expect(r.list[2]).toMatchObject({ members: 1, embg: null });
    expect(r.skipped).toBe(1);
  });

  it('finds no register without a name column', () => {
    expect(parseRegister([['PËRMBLEDHJE', ''], ['Numri i familjeve', 59]]).list).toEqual([]);
  });

  it('matches the same person by ЕМБГ, else by name', () => {
    expect(sameBeneficiary({ name: 'A', embg: '1' }, { name: 'B', embg: '1' })).toBe(true);
    expect(sameBeneficiary({ name: 'Zia  Iseni', embg: null }, { name: 'zia iseni', embg: '2' })).toBe(true);
    expect(sameBeneficiary({ name: 'A', embg: '1' }, { name: 'A', embg: '2' })).toBe(false);
  });

  it('sums meals, portions and days per beneficiary', () => {
    const S = monthSummary([{ id: 'a', members: 5 }, { id: 'b', members: 1 }, { id: 'c', members: 3 }], [
      { beneficiaryId: 'a', date: '2026-11-01', meal: 'l' }, { beneficiaryId: 'a', date: '2026-11-01', meal: 'd' },
      { beneficiaryId: 'a', date: '2026-11-02', meal: 'l' }, { beneficiaryId: 'b', date: '2026-11-02', meal: 'b' },
      { beneficiaryId: 'x', date: '2026-11-02', meal: 'b' }, { beneficiaryId: 'b', date: '2026-11-02', meal: 'z' },
    ]);
    expect(S.rows.find((r) => r.id === 'a')).toMatchObject({ days: 2, l: 2, d: 1, meals: 3, portions: 15 });
    expect(S.rows.find((r) => r.id === 'c')).toMatchObject({ meals: 0, portions: 0 });
    expect(S.tot).toEqual({ b: 1, l: 2, d: 1, meals: 4, portions: 16, served: 2 });
    expect(costPerPortion(16000, 16)).toBe(1000);
    expect(costPerPortion(100, 0)).toBe(0);
    expect(monthDays('2026-02')).toHaveLength(28);
  });

  it('is a module of associations, also in the client portal when switched on', () => {
    expect(nkdProfiles('94.99 Дејности на други организации')).toEqual(['npo']);
    expect(suggestedModules(['npo'])).toContain('meals');
    expect(viewEnabled('obroci', ['meals'], { hasFirm: true, client: true })).toBe(true);
    expect(viewEnabled('obroci', [], { hasFirm: true, client: true })).toBe(false);
    expect(klAllowedViews({ on: { obr: true } }, ['meals'])).toContain('obroci');
    expect(klAllowedViews({ on: { obr: true } }, [])).not.toContain('obroci');
  });
});
