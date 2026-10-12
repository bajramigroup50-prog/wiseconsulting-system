import { describe, expect, it } from 'vitest';
import { articlesIn, kontrolaFromPdf, kontrolaFromText, remedyDeadline } from './kontrola';
import { DIT_RESHENIE, UJP_ZAPISNIK } from './kontrola.fixtures';
import { pdfLines, type PdfItem } from './pdf-lines';

const lines = (t: string) => t.split('\n');

describe('kontrola without AI — УЈП записник (ДДВ)', () => {
  const r = kontrolaFromText(lines(UJP_ZAPISNIK))!;
  it('reads the header', () => {
    expect(r).toMatchObject({
      auth: 'ujp', doc: 'zapisnik', docNo: '13-2451/4', docDate: '2026-03-14', periodFrom: '2025-01-01', periodTo: '2025-12-31',
      subject: 'Даночна контрола на данокот на додадена вредност', noai: true, note: 'прочитано без AI – проверете ги наодите',
    });
  });
  it('splits the numbered findings with amounts, articles and tax type', () => {
    expect(r.findings).toHaveLength(3);
    const [a, b, c] = r.findings!;
    expect(a).toMatchObject({ no: 1, area: 'vat', claimed: '90000.00', interest: '4250.00', fine: '0.00', article: 'член 53 став 8 од Законот за ДДВ' });
    expect(a!.text).toMatch(/^Со увид во евиденцијата/);
    expect(b).toMatchObject({ no: 2, area: 'vat', claimed: '21600.00', interest: '0.00', fine: '0.00' });
    expect(b!.article).toBe('член 34 од Законот за данокот на додадена вредност; член 35 од Законот за данокот на додадена вредност');
    expect(c).toMatchObject({ no: 3, area: 'vat', claimed: '0.00', fine: '30750.00', article: 'член 187 од Законот за даночна постапка' });
  });
  it('takes the remedy deadline from the „правна поука“', () => {
    expect(r).toMatchObject({ remedyDays: 8, remedyUnit: 'days' });
  });
});

describe('kontrola without AI — ДИТ решение', () => {
  const r = kontrolaFromText(lines(DIT_RESHENIE))!;
  it('reads the header and the dispositive points as findings', () => {
    expect(r).toMatchObject({ auth: 'dit', doc: 'reshenie', docNo: '21-387/2', docDate: '2026-04-02', periodFrom: '', periodTo: '' });
    expect(r.findings).toHaveLength(2);
    expect(r.findings![0]).toMatchObject({ area: 'labour', claimed: '0.00', article: 'член 13 став 1 од Законот за работните односи' });
    expect(r.findings![1]).toMatchObject({ area: 'labour', article: 'член 116 од Законот за работните односи' });
  });
  it('the appeal deadline is 15 days (not the 8 days of the measure)', () => {
    expect(r.remedyDays).toBe(15);
  });
});

describe('kontrola without AI — details', () => {
  it('articles with abbreviated laws and shared law names', () => {
    expect(articlesIn('спротивно на чл. 31 ст. 1 од ЗДДВ')).toBe('член 31 ст. 1 од Законот за ДДВ');
    expect(articlesIn('член 5 и член 6 став 2 од Законот за трговските друштва')).toBe('член 5 од Законот за трговските друштва; член 6 став 2 од Законот за трговските друштва');
  });
  it('amounts in dot format and findings without numbering', () => {
    const r = kontrolaFromText(['УПРАВА ЗА ЈАВНИ ПРИХОДИ', 'РЕШЕНИЕ бр. 08-77/1 од 05.05.2026', '',
      'Утврдено е дека не е платен данокот на добивка во износ од 1,250,000.50 MKD за 2025 година, спротивно на член 30 од Законот за данокот на добивка.'])!;
    expect(r.findings).toHaveLength(1);
    expect(r.findings![0]).toMatchObject({ area: 'cit', claimed: '1250000.50' });
    expect(r.doc).toBe('reshenie');
  });
  it('workdays and word numbers in the legal remedy', () => {
    expect(remedyDeadline(['Правна поука', 'Жалба се изјавува во рок од петнаесет работни дена.'])).toEqual({ n: 15, unit: 'workdays' });
    expect(remedyDeadline(['Нема рок.'])).toBeNull();
  });
  it('no text → null (a scan needs AI or manual entry)', () => {
    expect(kontrolaFromText(['', '  '])).toBeNull();
    expect(kontrolaFromPdf([])).toBeNull();
  });
  it('PDF text layer: lines by y, paragraph breaks by the gap', () => {
    const T = lines(UJP_ZAPISNIK).filter(Boolean);
    let y = 800;
    const I: PdfItem[] = [];
    T.forEach((t, i) => {
      if (i && /^(\d\.|II\.|I\.)/.test(t)) y -= 14; // paragraph spacing before the points
      // the number in its own item, a little higher (y tolerance), like many PDF generators
      const m = /^(\d\.)\s(.*)$/.exec(t);
      if (m) { I.push({ page: 1, x: 50, y: y + 0.6, w: 10, h: 10, s: m[1]! }, { page: 1, x: 64, y, w: m[2]!.length * 5, h: 10, s: m[2]! }); } else I.push({ page: 1, x: 50, y, w: t.length * 5, h: 10, s: t });
      y -= 14;
    });
    const r = kontrolaFromPdf(pdfLines(I))!;
    expect(r.auth).toBe('ujp');
    expect(r.findings!.map((f) => f.claimed)).toEqual(['90000.00', '21600.00', '0.00']);
    expect(r.remedyDays).toBe(8);
  });
});
