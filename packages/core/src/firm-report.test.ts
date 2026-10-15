import { describe, expect, it } from 'vitest';
import { frAiCheck, frConclusion, frScrub, frStatus, type FirmReport, type FrSection } from './office/firm-report';

describe('„🗂 Целосен извештај за фирма“ — pure parts', () => {
  it('scrubs names and identifiers, keeps amounts and dates', () => {
    const t = frScrub('Дупла фактура од Алфа Трејд ДОО, ЕДБ 4030999000001, сметка MK07 3000 0000 0042 425, info@alfa.mk, тел. 070 123 456: 1.234.567,89 ден. на 10.03.2026', ['Алфа Трејд ДОО', 'Алфа']);
    expect(t).not.toMatch(/Алфа|4030999000001|alfa\.mk|070 123 456|0042/);
    expect(t).toContain('1.234.567,89');
    expect(t).toContain('10.03.2026');
  });
  it('status from the findings; the conclusion orders problems before warnings, the same text once', () => {
    expect(frStatus([])).toBe('ok');
    expect(frStatus([], true)).toBe('na');
    expect(frStatus([{ sev: 'info' }, { sev: 'warn' }])).toBe('warn');
    expect(frStatus([{ sev: 'warn' }, { sev: 'bad' }])).toBe('bad');
    const s = (key: string, issues: FrSection['issues'], error?: string) => ({ key, status: frStatus(issues), issues, links: [{ label: 'x', href: `/${key}` }], data: null, error }) as FrSection;
    const R = { sections: {
      osnovni: s('osnovni', [{ sev: 'warn', src: 'osnovni', area: 'Досие', txt: 'истечен' }]), prihodi: s('prihodi', []), finansii: s('finansii', [], 'грешка'),
      ddv: s('ddv', [{ sev: 'bad', src: 'ddv', area: 'ДДВ', txt: 'ДДВ-04 задоцнета', law: 'ЗДДВ чл. 41', go: '/ddv' }]), plati: s('plati', []), zalihi: s('zalihi', []),
      rokovi: s('rokovi', [{ sev: 'bad', src: 'rokovi', area: 'Рок', txt: 'ДДВ-04 задоцнета' }]), zakon: s('zakon', []), dokumenti: s('dokumenti', []), ai: s('ai', []),
    } } as unknown as FirmReport;
    const C = frConclusion(R);
    expect(C.items.map((i) => i.txt)).toEqual(['ДДВ-04 задоцнета', 'истечен']);
    expect(C.items[1]!.go).toBe('/osnovni');
    expect(C.failed).toEqual(['Финансиска состојба: грешка']);
  });
  it('tags articles outside the given context', () => {
    const c = frAiCheck('Чл. 41 ЗДДВ важи; чл. 12 ЗДП исто.', { findings: [{ sev: 'bad', area: 'ДДВ', law: 'ЗДДВ чл. 41', txt: '' }], laws: [] });
    expect(c.unverified).toEqual(['чл. 12 ЗДП']);
    expect(c.text).toContain('чл. 12 ЗДП [треба да се провери]');
  });
});
