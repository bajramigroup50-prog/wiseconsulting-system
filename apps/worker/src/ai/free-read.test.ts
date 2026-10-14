/**
 * The worker's free reader on real text-layer PDFs (fixtures of the import audit, apps/web/test/import): bank
 * statements of several banks, an invoice, and a statement table that cannot be read (clear reason, not „null“).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { statementFromRead } from '@wise/core/ai/bank';
import type { ObPdfResult } from '@wise/core/noai/ob';
import { TBA_STEPS, tbaFixtureItems, type FxStep } from '@wise/core/noai/tb-analitika.fixtures';
import { freeAccepted, freeRead } from './free-read';

const F = join(__dirname, '../../../web/test/import/fixtures');
const E = JSON.parse(readFileSync(join(F, 'expected.json'), 'utf8')) as Record<string, { lines: { amount: number }[]; closing: number }>;
const pdf = (n: string) => new Uint8Array(readFileSync(join(F, n)));

describe('freeRead (worker) on bank statement PDFs', () => {
  for (const id of ['halk', 'nlb', 'uni', 'stb']) {
    it(id, async () => {
      const r = await freeRead('bank', { name: id + '.pdf', mime: 'application/pdf' }, pdf(id + '.pdf'));
      const st = statementFromRead(r)!;
      expect(st.lines.map((l) => l.amount)).toEqual(E[id]!.lines.map((l) => l.amount));
      expect((r as { balanced: boolean }).balanced).toBe(true);
    });
  }

  it('a table that is found but has no readable rows: the reason with the row and column', async () => {
    const d = await PDFDocument.create();
    const p = d.addPage([595, 842]);
    const f = await d.embedFont(StandardFonts.Helvetica);
    const row = (y: number, cells: [number, string][]) => cells.forEach(([x, s]) => p.drawText(s, { x, y, size: 9, font: f }));
    row(780, [[40, 'Date'], [120, 'Partner'], [430, 'Debit'], [500, 'Credit']]);
    row(766, [[40, '31.02.2026'], [120, 'ALFA DOOEL'], [500, '12.500,00']]);
    await expect(freeRead('bank', { name: 'x.pdf', mime: 'application/pdf' }, await d.save())).rejects.toThrow(/Ред \d+: „31.02.2026“ во колоната „Date“ не е датум/);
  });

  it('invoice PDF with a VAT recapitulation (purchase)', async () => {
    const r = await freeRead('purchase', { name: 'f.pdf', mime: 'application/pdf' }, pdf('inv-recap.pdf'), { ownEdb: '4030999000111' }) as { total: number; groups: unknown[] };
    expect(r.total).toBe(2010);
    expect(r.groups).toHaveLength(4);
  });
});

describe('freeRead (worker) on the old program’s „Бруто биланс со аналитика“ PDF', () => {
  // synthetic fixture with the real layout, drawn in the old 8-bit font's Latin letters (YUSCII) so a standard PDF font
  // can carry it; pdfjs then gives the positioned text runs like the real export
  const build = async (steps = TBA_STEPS) => {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    const items = tbaFixtureItems(steps, { encode: true });
    const pages = Math.max(...items.map((i) => i.page));
    for (let p = 1; p <= pages; p++) {
      const pg = d.addPage([595, 842]);
      for (const it of items.filter((i) => i.page === p)) pg.drawText(it.s, { x: it.x, y: it.y, size: Math.min(it.h ?? 8, 8), font: f });
    }
    return d.save();
  };

  it('read without AI, every printed total checked → accepted (AI not needed)', async () => {
    const r = await freeRead('ob', { name: 'ANALITIKA.pdf', mime: 'application/pdf' }, await build()) as ObPdfResult;
    expect(r.source).toBe('tb-analitika');
    expect(r.warnings).toEqual([]);
    expect(r.balanced).toBe(true);
    expect(r.rows).toHaveLength(12);
    expect(r.rows).toContainEqual(['1200', 'ПОБАРУВАЊЕ ОД КУПУВАЧИ ОД ПРОДАЖБА НА ДОБРА', 'АВТО ШКОЛА АРТ ДООЕЛ САРАЈ', '0589', 4000, 0]);
    expect(r.opening).toMatchObject({ date: '2026-01-01', n: 8, D: 832985, P: 802985 });
    expect(freeAccepted('ob', r)).toBe(true);
    expect(freeAccepted('ob', { ...r, balanced: false })).toBe(false);
    expect(freeAccepted('purchase', r)).toBe(false);
  });

  it('more than 40 pages are read (the page count is checked against „Стр. N од M“)', async () => {
    const steps: FxStep[] = [];
    for (let p = 0; p < 45; p++) {
      steps.push({ row: { k: '1200', name: ['ПОБАРУВАЊЕ'], partner: [`${1000 + p} КУПУВАЧ`], open: 100, turnD: 0, turnP: 0 } });
      steps.push({ pageBreak: true });
    }
    steps.push({ row: { k: '2200', name: ['ОБВРСКИ'], open: -4500, turnD: 0, turnP: 0 } }, { sum: '2200' }, { synth: '220' }, { group: '22' }, { cls: '2' }, { grand: true });
    const r = await freeRead('ob', { name: 'big.pdf', mime: 'application/pdf' }, await build(steps)) as ObPdfResult;
    expect(r.check).toMatchObject({ pages: 46, pagesTotal: 46, rows: 46 });
  }, 30000);
});
