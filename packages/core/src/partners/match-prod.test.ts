/* Production cases (firm ТРУЛИ НОЛЕН): public institutions, synthetic rows mirroring the names. */
import { describe, expect, it } from 'vitest';
import { findPartnerMatch, mergedPartnerFields, nameScore, partnerDuplicates, type MatchablePartnerRow } from './match';

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
