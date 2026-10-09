import { describe, expect, it } from 'vitest';
import { fileImageIds, inlineFileImages, parsePrintPdfRequest } from './print-pdf';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('server PDF request (POST /api/pdf)', () => {
  it('validates the body and keeps an optional package id (PKG_REP)', () => {
    expect(parsePrintPdfRequest({ html: ' ' })).toEqual({ error: 'Нема содржина за PDF.' });
    expect(parsePrintPdfRequest({ html: '<p>x</p>', title: 'ДДВ-04\n2026', pkg: ID })).toEqual({ html: '<p>x</p>', css: '', title: 'ДДВ-04 2026', landscape: false, pkg: ID });
    expect(parsePrintPdfRequest({ html: '<p>x</p>', pkg: 'nope' })).toMatchObject({ title: 'Документ', pkg: null });
  });
  it('inlines /api/files images for the worker (no network there)', () => {
    const h = `<img src="/api/files/${ID}"><img src="https://x.mk/api/files/${ID}?v=1">`;
    expect(fileImageIds(h)).toEqual([ID]);
    expect(inlineFileImages(h, new Map([[ID, 'data:image/png;base64,AA']]))).toBe('<img src="data:image/png;base64,AA"><img src="data:image/png;base64,AA">');
  });
});
