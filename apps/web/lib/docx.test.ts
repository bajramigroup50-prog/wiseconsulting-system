import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';
import { docxText, fillDocx, minimalDocx, scanDocx, zipFiles } from './docx';
import { docxToHtml } from '@wise/core/office';

describe('Word templates', () => {
  // Word often splits a placeholder over several runs: "{{ФИР" + "МА}}".
  const tpl = minimalDocx([['Договор бр. {{ДОГОВОР_БРОЈ}} со {{ФИР', 'МА}}'], ['ЕДБ: {{ фирма едб }}, ЕМБС: {{ФИРМА_ЕМБС}}']]);
  it('scans placeholders across runs and normalises keys', () => {
    expect(scanDocx(tpl).sort()).toEqual(['ДОГОВОР_БРОЈ', 'ФИРМА', 'ФИРМА_ЕДБ', 'ФИРМА_ЕМБС']);
  });
  it('fills values; missing ones become a blank line and are reported', () => {
    const { out, missing } = fillDocx(tpl, { ДОГОВОР_БРОЈ: 'СУ-001/2026', ФИРМА: 'Тест & Син ДОО', ФИРМА_ЕДБ: '4030' });
    const t = docxText(out);
    expect(t).toContain('Договор бр. СУ-001/2026 со Тест &amp; Син ДОО');
    expect(t).toContain('ЕДБ: 4030, ЕМБС: ________');
    expect(missing).toEqual(['ФИРМА_ЕМБС']);
  });
  it('zips files with unique names', () => {
    const z = new PizZip(zipFiles([{ name: 'a.pdf', data: new Uint8Array([1]) }, { name: 'a.pdf', data: new Uint8Array([2]) }, { name: 'x/y.txt', data: 'т' }]));
    expect(Object.keys(z.files).sort()).toEqual(['a (2).pdf', 'a.pdf', 'x_y.txt']);
  });
  it('a filled own template renders as HTML for the PDF (legacy tplHtml)', () => {
    const { out } = fillDocx(tpl, { ДОГОВОР_БРОЈ: 'СУ-002/2026', ФИРМА: 'Бета <ДОО>' });
    const H = docxToHtml({ document: new PizZip(out).file('word/document.xml')!.asText() });
    expect(H).toContain('Договор бр. СУ-002/2026 со Бета &lt;ДОО&gt;');
    expect(H).toContain('ЕМБС: ________');
  });
});
