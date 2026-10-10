import { describe, expect, it } from 'vitest';
import { fileImageIds, firmHeadHtml, inlineFileImages, parsePdfSave, parsePrintPdfRequest, withFirmHead } from './print-pdf';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const ALLOWED = { categories: ['Друго', 'Усогласување со комитенти (ИОС)'], roles: ['bs', 'bu', 'bel', 'db'] };

describe('server PDF request (POST /api/pdf)', () => {
  it('validates the body and keeps an optional package id (PKG_REP)', () => {
    expect(parsePrintPdfRequest({ html: ' ' })).toEqual({ error: 'Нема содржина за PDF.' });
    expect(parsePrintPdfRequest({ html: '<p>x</p>', title: 'ДДВ-04\n2026', pkg: ID })).toEqual({ html: '<p>x</p>', css: '', title: 'ДДВ-04 2026', landscape: false, pkg: ID, head: null, save: null });
    expect(parsePrintPdfRequest({ html: '<p>x</p>', pkg: 'nope' })).toMatchObject({ title: 'Документ', pkg: null });
  });
  it('accepts a firm head for captured screens', () => {
    expect(parsePrintPdfRequest({ html: '<p>x</p>', head: { sub: 'Т1\n2026' } })).toMatchObject({ head: { sub: 'Т1 2026' } });
  });
  it('validates where the PDF is filed (dossier / year dossier)', () => {
    expect(parsePdfSave(undefined, ALLOWED.categories, ALLOWED.roles)).toBeNull();
    expect(parsePdfSave({ to: 'dossier', category: 'Усогласување со комитенти (ИОС)', title: 'Записник', date: '2026-12-31', partner: 'Купувач' }, ALLOWED.categories, ALLOWED.roles))
      .toEqual({ to: 'dossier', category: 'Усогласување со комитенти (ИОС)', title: 'Записник', date: '2026-12-31', partner: 'Купувач', note: null });
    expect(parsePdfSave({ to: 'dossier', category: 'Тајно' }, ALLOWED.categories, ALLOWED.roles)).toEqual({ error: 'Непозната категорија во досието.' });
    expect(parsePdfSave({ to: 'dossier', category: 'Друго', date: '31.12.2026' }, ALLOWED.categories, ALLOWED.roles)).toMatchObject({ title: 'Друго', date: null });
    expect(parsePdfSave({ to: 'year', year: 2025, role: 'bs' }, ALLOWED.categories, ALLOWED.roles)).toEqual({ to: 'year', year: 2025, role: 'bs' });
    expect(parsePdfSave({ to: 'year', year: 2025, role: 'oth' }, ALLOWED.categories, ALLOWED.roles)).toHaveProperty('error');
    expect(parsePdfSave({ to: 'disk' }, ALLOWED.categories, ALLOWED.roles)).toHaveProperty('error');
    expect(parsePrintPdfRequest({ html: '<p>x</p>', save: { to: 'year', year: 1, role: 'bs' } }, ALLOWED)).toHaveProperty('error');
  });
  it('builds the legacy firm head (firmHead + ph) and escapes it', () => {
    const h = firmHeadHtml({ name: 'Фирма <ДОО>', address: 'Ул. 1', city: 'Скопје', edb: '4030', embs: '123' }, 'АНАЛИЗА: ПРОДАЖБА', '2026', '2026-10-10T08:00:00Z');
    expect(h).toContain('<div class="fn">ФИРМА &lt;ДОО&gt;</div>');
    expect(h).toContain('ЕДБ: 4030 * ЕМБС: 123');
    expect(h).toContain('<div class="pt">АНАЛИЗА: ПРОДАЖБА</div><div class="ps">2026</div>');
    expect(h).toContain('Отпечатено: 10.10.2026');
    expect(firmHeadHtml(null, 'X', '', '2026-01-02')).not.toContain('class="fh"');
    expect(withFirmHead('<table></table>', '<b>h</b>', true)).toBe('<div id="printArea" style="display:block"><div class="pdfdoc land"><b>h</b><table></table></div></div>');
  });
  it('inlines /api/files images for the worker (no network there)', () => {
    const h = `<img src="/api/files/${ID}"><img src="https://x.mk/api/files/${ID}?v=1">`;
    expect(fileImageIds(h)).toEqual([ID]);
    expect(inlineFileImages(h, new Map([[ID, 'data:image/png;base64,AA']]))).toBe('<img src="data:image/png;base64,AA"><img src="data:image/png;base64,AA">');
  });
});
