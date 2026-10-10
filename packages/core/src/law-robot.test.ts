import { describe, expect, it } from 'vitest';
import { fuelRate, LAW_SOURCES, lawAskPrompt, lawFilter, lawFirms, lawKey, lawLinks, lawMailHtml, lawNew, lawNewLinks, lawNorm, lawPageText, lawRaw } from './law/robot';

const HTML = `<html><head><script>var a='<a href="/x">no</a>'</script></head><body><nav><a href="/mk">Почетна</a></nav>
<a href="/mk/javnost/soopstenija/pogledni/1291">Измени на Законот за ДДВ &amp; стапки</a>
<a href='https://www.ujp.gov.mk/mk/javnost/soopstenija/pogledni/1290/'><span>Рок за</span> <b>ДБ</b></a>
<a href="/mk/javnost/soopstenija/pogledni/1291#top">дупликат</a><a href="mailto:x@y.mk">пошта</a><a href="#">горе</a></body></html>`;
const SRC = LAW_SOURCES[0]!;

describe('law robot – page parsing and diff', () => {
  it('extracts absolute links with their text, once per URL', () => {
    const L = lawLinks(HTML, 'https://www.ujp.gov.mk/mk');
    expect(L.map((l) => l.url)).toEqual(['https://www.ujp.gov.mk/mk', 'https://www.ujp.gov.mk/mk/javnost/soopstenija/pogledni/1291', 'https://www.ujp.gov.mk/mk/javnost/soopstenija/pogledni/1290/']);
    expect(L[1]!.text).toBe('Измени на Законот за ДДВ & стапки');
    expect(L[2]!.text).toBe('Рок за ДБ');
    expect(lawKey('https://www.UJP.gov.mk/a/b/#x')).toBe('ujp.gov.mk/a/b');
  });
  it('first check is a baseline; later only links not seen before', () => {
    const L = lawLinks(HTML, SRC.url);
    expect(lawNewLinks(SRC, L, null)).toMatchObject({ fresh: [] });
    expect(lawNewLinks(SRC, L, null).items).toHaveLength(2);
    const r = lawNewLinks(SRC, L, ['http://ujp.gov.mk/mk/javnost/soopstenija/pogledni/1290']);
    expect(r.fresh.map((l) => l.url)).toEqual(['https://www.ujp.gov.mk/mk/javnost/soopstenija/pogledni/1291']);
  });
  it('page text without scripts / navigation', () => {
    expect(lawPageText('<nav>мени</nav><p>Од 1 јануари</p><p>ДДВ 10%</p><script>x</script>')).toBe('Од 1 јануари\nДДВ 10%');
  });
});

describe('law robot – model answer', () => {
  const items = [{ url: 'https://www.ujp.gov.mk/mk/javnost/soopstenija/pogledni/1291', text: 'Измени на ЗДДВ' }];
  it('keeps relevant items whose URL is in the list; restricts institutions and impact', () => {
    const E = lawNorm({ items: [
      { url: 'https://ujp.gov.mk/mk/javnost/soopstenija/pogledni/1291/', relevant: true, inst: 'XYZ', title: 'ДДВ на горива 10%', what: 'Намалена стапка', impact: ['ddv', 'gorivo', 'bogus'], date: '05.10.2026', from: '2026-10-01', to: '2026-12-31' },
      { url: 'https://evil.example/invented', relevant: true, title: 'измислено' },
      { url: items[0]!.url, relevant: false, title: 'вработување' },
    ] }, SRC, items, '2026-10-10');
    expect(E).toEqual([{ key: 'ujp.gov.mk/mk/javnost/soopstenija/pogledni/1291', inst: 'UJP', title: 'ДДВ на горива 10%', what: 'Намалена стапка', who: null, impact: ['ddv', 'gorivo'], date: '2026-10-05', from: '2026-10-01', to: '2026-12-31', urls: [items[0]!.url], verified: true }]);
    expect(lawNorm([{ url: items[0]!.url }], SRC, items, '2026-10-10')[0]!.title).toBe('Измени на ЗДДВ');
    expect(lawNorm('garbage', SRC, items, '2026-10-10')).toEqual([]);
  });
  it('without the model: raw entries to be confirmed', () => {
    expect(lawRaw(SRC, items, '2026-10-10')[0]).toMatchObject({ title: 'Измени на ЗДДВ', verified: false, inst: 'UJP', date: '2026-10-10' });
  });
});

describe('law list (legacy lawNew / lawFirms / filter / fuelRate / ask)', () => {
  const L = [
    { inst: 'UJP', title: 'ДДВ на горива 10%', impact: ['gorivo', 'ddv'], from: '2026-10-01', to: '2026-12-31', urls: ['u1'], at: '2026-10-05T07:00:00.000Z', date: '2026-10-05' },
    { inst: 'SV', title: 'Минимална плата', what: 'нов износ', impact: ['site'], at: '2026-09-01T07:00:00.000Z', date: '2026-09-01' },
  ];
  it('new since the mark, firms concerned, filters', () => {
    expect(lawNew(L, '2026-09-15T00:00:00.000Z')).toHaveLength(1);
    expect(lawNew(L, null)).toHaveLength(2);
    expect(lawFirms(L[0]!, [{ vat: true }, { vat: false }])).toBe(1);
    expect(lawFirms(L[1]!, [{ vat: true }, { vat: false }])).toBe(2);
    expect(lawFilter(L, 'SV', '').map((x) => x.title)).toEqual(['Минимална плата']);
    expect(lawFilter(L, '', 'служб')).toHaveLength(1); // institution name „Службен весник“
    expect(lawFilter(L, '', 'износ')).toHaveLength(1);
  });
  it('fuel VAT rate from the entries', () => {
    expect(fuelRate(L, '2026-11-01')).toMatchObject({ rate: 10, inR: true });
    expect(fuelRate(L, '2027-01-02')).toMatchObject({ rate: 18, inR: false });
    expect(fuelRate([{ ...L[0]!, rule: { kind: 'vatRate', match: 'gorivo', rate: 5, else: 18, to: '2026-10-31' } }], '2026-10-20')!.rate).toBe(5);
    expect(fuelRate([L[1]!], '2026-10-20')).toBeNull();
  });
  it('ask prompt (legacy text) and office e-mail', () => {
    const p = lawAskPrompt(L, 'До кога?', '2026-10-10');
    expect(p).toContain('Денес е 2026-10-10.');
    expect(p).toContain('[1] УЈП | 2026-10-05 | ДДВ на горива 10% |  | важи 2026-10-01 до 2026-12-31 | u1');
    expect(p.endsWith('ПРАШАЊЕ: До кога?')).toBe(true);
    const m = lawMailHtml([{ inst: 'UJP', title: 'A <b>', what: null, urls: ['https://x.mk'], from: '2026-10-01', to: null }], 'https://app.mk');
    expect(m.subject).toBe('⚖️ 1 нови законски промени');
    expect(m.html).toContain('A &lt;b&gt;');
    expect(m.html).toContain('Важи од 01.10.2026');
    expect(m.html).toContain('https://app.mk/zakoni');
  });
});
