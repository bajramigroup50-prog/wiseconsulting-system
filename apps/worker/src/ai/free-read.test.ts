/**
 * The worker's free reader on real text-layer PDFs (fixtures of the import audit, apps/web/test/import): bank
 * statements of several banks, an invoice, and a statement table that cannot be read (clear reason, not „null“).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { statementFromRead } from '@wise/core/ai/bank';
import { freeRead } from './free-read';

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
