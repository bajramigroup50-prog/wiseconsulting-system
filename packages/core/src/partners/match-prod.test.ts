/* Production cases (firm ТРУЛИ НОЛЕН): public institutions, synthetic rows mirroring the names. */
import { describe, expect, it } from 'vitest';
import { autoMergeIds, dupMergeSelection, findPartnerMatch, mergedPartnerFields, namesDistinct, nameScore, partnerDuplicates, partnerIdsDiffer, type MatchablePartnerRow } from './match';

const JZU = { a: 'ЈУ ОД ОБЛАСТА НА ЗДРАВ.ЗА ПОТРЕБА НА ЈЗУ', b: 'ЈУ ОД О. НА ЗДРАВ.ЗА ПОТ. НА ЈЗУ УКЦ', c: 'ЈУ од Областа на Здр. за потрбите на ЈЗУ УК завод и Ургентен Центар' };
const PROD: MatchablePartnerRow[] = [
  { id: '0116', code: '0116', name: JZU.a },
  { id: '0220', code: '0220', name: JZU.b },
  { id: '0320', code: '0320', name: JZU.c, embs: '6259960' },
  { id: '0194', code: '0194', name: 'ЗДРАВСТВЕН ДОМ СКОПЈЕ' },
  { id: '0322', code: '0322', name: 'ЈЗУ Здравствен дом на Скопје ЦО Скопје', embs: '4063589' },
  { id: '0206', code: '0206', name: 'ЦЕНТАР ЗА ЈАВНО ЗДРАВЈЕ СКОПЈЕ' },
  { id: '0332', code: '0332', name: 'ЦЕНТАР ЗА ЈАВНО ЗДРАВЈЕ-Скопје', embs: '4708032' },
  { id: 'x1', code: '0001', name: 'Алфа ДООЕЛ Скопје', edb: '4030990123456' },
  { id: 'x2', code: '0002', name: 'Бета ДООЕЛ Скопје', edb: '4030990654321' },
  { id: 'x3', code: '0003', name: 'Здравствен дом Битола' },
];

describe('production duplicates', () => {
  it('abbreviations („О.“, „ПОТ.“, „Здр.“) and typos („потрбите“) match', () => {
    expect(nameScore(JZU.a, JZU.b)).toBeGreaterThanOrEqual(0.85);
    expect(nameScore(JZU.a, JZU.c)).toBeGreaterThanOrEqual(0.85);
    expect(nameScore(JZU.b, JZU.c)).toBeGreaterThanOrEqual(0.85);
    expect(nameScore('ЗДРАВСТВЕН ДОМ СКОПЈЕ', 'ЈЗУ Здравствен дом на Скопје ЦО Скопје')).toBeGreaterThanOrEqual(0.9);
    expect(nameScore('ЦЕНТАР ЗА ЈАВНО ЗДРАВЈЕ СКОПЈЕ', 'ЦЕНТАР ЗА ЈАВНО ЗДРАВЈЕ-Скопје')).toBe(1);
    // another city is another institution
    expect(nameScore('ЗДРАВСТВЕН ДОМ СКОПЈЕ', 'Здравствен дом Битола')).toBeLessThan(0.6);
  });
  it('the three groups are found, the main partner is the one with the ЕМБС', () => {
    const G = partnerDuplicates(PROD, new Map([['0220', 1], ['0320', 5]]));
    expect(G.map((g) => g.members.map((m) => m.id).sort().join(',')).sort()).toEqual(['0116,0220,0320', '0194,0322', '0206,0332']);
    expect(G.find((g) => g.members.length === 3)!.main).toBe('0320');
    expect(G.find((g) => g.members.some((m) => m.id === '0194'))!.main).toBe('0322');
    expect(G.find((g) => g.members.some((m) => m.id === '0206'))).toMatchObject({ main: '0332', sure: true });
  });
  it('different ЕДБ never group, nor do legal words alone', () => {
    const G = partnerDuplicates([...PROD, { id: 'x4', name: 'Алфа ДООЕЛ Скопје', edb: '4030990000001' }]);
    expect(G.some((g) => g.members.some((m) => m.id.startsWith('x')))).toBe(false);
  });
  it('a scan of the abbreviated name finds the existing partner (ЕМБС, else by name)', () => {
    expect(findPartnerMatch(PROD, { name: JZU.c, id: '6259960' })).toMatchObject({ by: 'embs', partner: { id: '0320' } });
    const m = findPartnerMatch(PROD.filter((p) => p.id !== '0320'), { name: JZU.c, id: '6259960' });
    expect(m.partner?.id ?? m.candidates[0]?.id).toMatch(/0116|0220/);
  });
  it('merged fields: missing identifiers filled, names kept as aliases (used by later matching)', () => {
    const f = mergedPartnerFields<MatchablePartnerRow & { address?: string | null }>({ ...PROD[0]!, address: null as string | null }, [{ ...PROD[2]!, address: 'Водњанска 17' }, PROD[1]!]);
    expect(f).toMatchObject({ embs: '6259960', address: 'Водњанска 17' });
    expect(f.aliases).toEqual([JZU.c, JZU.b]);
    const P2 = [{ ...PROD[0]!, embs: f.embs, data: { aliases: f.aliases } }, PROD[3]!];
    expect(findPartnerMatch(P2, { name: JZU.b })).toMatchObject({ by: 'alias', partner: { id: '0116' } });
  });
});

describe('duplicates: no chaining, distinctive words', () => {
  const STAR: MatchablePartnerRow[] = [
    { id: '0331', code: '0331', name: 'ЗВЕЗДЕН ОКЕАН ЛИУ ДООЕЛ Скопје (star ocean)', embs: '7475071' },
    { id: '0324', code: '0324', name: 'Хаилонг ЛИУ ДООЕЛ увоз-извоз Скопје (Звезден Океан Центар)', embs: '7739680' },
    { id: '0377', code: '0377', name: 'ХАИЈАН ЛИУ ДООЕЛ СКОПЈЕ (Звезден Океан СЕГ)', embs: '7661878' },
    { id: '0248', code: '0248', name: 'ЗВЕЗДЕН ОКЕАН ЛИУ ДООЕЛ' },
    { id: '0305', code: '0305', name: 'ХАИЛОНГ ЛИУ ДООЕЛ' },
  ];
  it('Звезден Океан: one group {0331, 0248}; Хаилонг and Хаијан never with it', () => {
    for (const mv of [new Map<string, number>(), new Map([['0324', 50], ['0377', 40]])]) {
      const G = partnerDuplicates(STAR, mv);
      const sets = G.map((g) => g.members.map((m) => m.id).sort().join(','));
      expect(sets).toContain('0248,0331');
      for (const g of G) {
        const ids = g.members.map((m) => m.id);
        // never two different ЕМБС in one group; every member similar to the main one
        expect(ids.filter((x) => ['0331', '0324', '0377'].includes(x)).length).toBeLessThanOrEqual(1);
        expect(g.members.every((m) => m.sameId || m.score >= 0.85)).toBe(true);
      }
      expect(G.find((g) => g.members.some((m) => m.id === '0331'))).toMatchObject({ main: '0331', sure: true });
    }
  });
  it('a chain A ~ B ~ C does not put C with A', () => {
    const G = partnerDuplicates([
      { id: 'a', code: '1', name: 'Алфа Бета Гама', edb: '4030990000011' },
      { id: 'b', code: '2', name: 'Алфа Бета Гама Делта Епсилон' },
      { id: 'c', code: '3', name: 'Гама Делта Епсилон', edb: '4030990000022' },
    ]);
    for (const g of G) expect(g.members.map((m) => m.id).sort().join(',')).not.toMatch(/a.*c/);
  });
  it('ТРУЛИ НОЛЕН ШПК vs ТРУЛИ НОЛЕН ИНТЕРНАТИО НАЛ: at most „проверете“', () => {
    expect(namesDistinct('ТРУЛИ НОЛЕН ШПК', 'ТРУЛИ НОЛЕН ИНТЕРНАТИО НАЛ')).toBe(true);
    expect(namesDistinct('TRULI NOLEN SH.P.K.', 'ТРУЛИ НОЛЕН ДООЕЛ')).toBe(true);
    expect(namesDistinct('ТРУЛИ НОЛЕН', 'ТРУЛИ НОЛЕН ИНТЕРНАЦИОНАЛ')).toBe(true);
    expect(namesDistinct('ЦЕНТАР ЗА ЈАВНО ЗДРАВЈЕ СКОПЈЕ', 'ЦЕНТАР ЗА ЈАВНО ЗДРАВЈЕ-Скопје')).toBe(false);
    expect(namesDistinct('Макпетрол АД Скопје', 'МАКПЕТРОЛ')).toBe(false);
    expect(namesDistinct('Макпетрол АД', 'MAKPETROL AD')).toBe(false);
    const G = partnerDuplicates([{ id: '0091', code: '0091', name: 'ТРУЛИ НОЛЕН ШПК' }, { id: '0074', code: '0074', name: 'ТРУЛИ НОЛЕН ИНТЕРНАТИО НАЛ' }]);
    expect(G.length).toBe(1);
    expect(G[0]!.sure).toBe(false);
    expect(G[0]!.members.find((m) => m.id !== G[0]!.main)).toMatchObject({ distinct: true });
    // the same ЕДБ is still „сигурно“
    const H = partnerDuplicates([{ id: '1', name: 'ТРУЛИ НОЛЕН ШПК', edb: '4030990111111' }, { id: '2', name: 'TRULI NOLEN', edb: '4030990111111' }]);
    expect(H).toMatchObject([{ sure: true }]);
  });
  it('the „спои“ ticks: only the ticked members (and the main one), only of the group', () => {
    expect(dupMergeSelection('0331', ['0331', '0248', '0249'], ['0331', '0248'])).toEqual({ ids: ['0331', '0248'] });
    expect(dupMergeSelection('0248', ['0331', '0248', '0249'], ['0249'])).toEqual({ ids: ['0248', '0249'] });
    expect(dupMergeSelection('0331', ['0331', '0248'], ['0331'])).toHaveProperty('error');
    expect(dupMergeSelection('0331', ['0331', '0248'], ['0248', '0324'])).toHaveProperty('error');
    expect(dupMergeSelection('0324', ['0331', '0248'], ['0248'])).toHaveProperty('error');
  });
  it('automatic merge: the same ЕДБ or a ≥ 95% name with nothing distinctive; never other legal forms, chains or parentheses', () => {
    const one = (P: MatchablePartnerRow[]) => partnerDuplicates(P).map(autoMergeIds).filter((x) => x.length).map((x) => [...x].sort().join(','));
    expect(one([{ id: 'a', name: 'Алфа ДООЕЛ', edb: '4030990000101' }, { id: 'b', name: 'Нешто Друго', edb: '4030990000101' }])).toEqual(['a,b']);
    expect(one([{ id: 'a', name: 'Макпетрол АД Скопје' }, { id: 'b', name: 'MAKPETROL AD' }])).toEqual(['a,b']);
    // ≥ 95% name, but conflicting legal forms
    expect(nameScore('Макпетрол ДООЕЛ', 'Макпетрол АД')).toBeGreaterThanOrEqual(0.95);
    expect(one([{ id: 'a', name: 'Макпетрол ДООЕЛ' }, { id: 'b', name: 'Макпетрол АД' }])).toEqual([]);
    expect(one([{ id: '0091', name: 'ТРУЛИ НОЛЕН ШПК' }, { id: '0074', name: 'ТРУЛИ НОЛЕН ИНТЕРНАТИО НАЛ' }])).toEqual([]);
    // Звезден Океан: only the certain pair; a match through a parenthesis never
    // (Хаилонг with its own short name „ХАИЛОНГ ЛИУ ДООЕЛ“ is its own pair)
    expect(one(STAR)).toEqual(['0248,0331', '0305,0324']);
    expect(one([STAR[1]!, { id: 'zc', name: 'Звезден Океан Центар' }])).toEqual([]);
  });
  it('partnerIdsDiffer: ЕДБ or ЕМБС on both sides and different', () => {
    expect(partnerIdsDiffer(STAR[0]!, STAR[1]!)).toBe(true);
    expect(partnerIdsDiffer(STAR[0]!, STAR[3]!)).toBe(false);
  });
});
