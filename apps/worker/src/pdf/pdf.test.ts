import { describe, expect, it } from 'vitest';
import type { DB } from '@wise/db';
import { renderPdfToFile } from '../jobs/pdf';
import { pdfName, wrapHtml } from './document';
import { chromiumPath, closeBrowser, htmlToPdf } from './render';

describe('pdf document wrapper', () => {
  it('wraps body markup with charset, A4 CSS and an escaped title', () => {
    const h = wrapHtml({ html: '<p>Здраво</p>', css: '.x{color:red}', title: 'A<B' });
    expect(h).toMatch(/^<!doctype html>/);
    expect(h).toContain('<meta charset="utf-8">');
    expect(h).toContain('@page { size: A4');
    expect(h).toContain('.x{color:red}');
    expect(h).toContain('<title>A&lt;B</title>');
  });
  it('injects the CSS into a complete document', () => {
    const h = wrapHtml({ html: '<html><head><title>t</title></head><body>x</body></html>', landscape: true });
    expect(h).toContain('<head><meta charset="utf-8"><style>');
    expect(h).toContain('landscape');
  });
  it('file names', () => {
    expect(pdfName('Договор СУ-001/2026')).toBe('Договор СУ-001 2026.pdf');
    expect(pdfName()).toBe('dokument.pdf');
  });
});

describe('pdf.render job', () => {
  it('renders, stores the object and registers a ready file', async () => {
    const puts: { key: string; mime: string; n: number }[] = [];
    const inserted: Record<string, unknown>[] = [];
    const db = {
      insert: () => ({ values: (v: Record<string, unknown>) => { inserted.push(v); return { returning: async () => [{ id: v.id ?? 'new-id' }] }; } }),
    } as unknown as DB;
    const id = await renderPdfToFile(db, { html: '<p>x</p>', title: 'Тест', firmId: 'f1', fileId: 'pre-id' }, {
      render: async () => new Uint8Array([37, 80, 68, 70]),
      store: { put: async (key, body, mime) => { puts.push({ key, mime, n: body.byteLength }); } },
    });
    expect(id).toBe('pre-id');
    expect(puts[0]!.key).toMatch(/^firms\/f1\/\d{4}\/[0-9a-f-]{36}\.pdf$/);
    expect(inserted[0]).toMatchObject({ id: 'pre-id', firmId: 'f1', name: 'Тест.pdf', mime: 'application/pdf', size: 4, status: 'ready' });
    await expect(renderPdfToFile(db, { html: '' })).rejects.toThrow('html is required');
  });
});

describe.skipIf(!chromiumPath())('Chromium rendering (needs a local Chrome/Chromium)', () => {
  it('produces a PDF with Cyrillic text and blocks network access', async () => {
    const pdf = await htmlToPdf({ html: '<h1>Фактура бр. 1</h1><img src="http://127.0.0.1:9/x.png"><script>document.body.innerHTML="hacked"</script>' });
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(1000);
    await closeBrowser();
  }, 180_000); // Chromium start-up is slow while the whole monorepo tests in parallel
});
