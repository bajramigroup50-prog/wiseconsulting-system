import { describe, expect, it } from 'vitest';
import { archFileLabel, archFilter, archKinds, archXlsxRows, type ArchRow } from './archive';

const R: ArchRow[] = [
  { key: 'purchase:1', date: '2026-03-01', kind: 'Влезна фактура', no: '12', pn: 'Алфа', amt: '1180.00', files: [{ id: 'a', name: 'f12.pdf', mime: 'application/pdf' }] },
  { key: 'dossier_doc:2', date: '2025-12-01', kind: 'Решение', no: '5/25', pn: 'ЦРМ', amt: null, files: [{ id: 'b', name: 'res.jpg', mime: 'image/jpeg' }], archId: '2' },
  { key: 'file:c', date: '', kind: 'Датотека', no: '', pn: '', amt: null, files: [{ id: 'c', name: 'x.xlsx', mime: 'application/vnd' }] },
];

describe('archive (legacy archRows / arhiva)', () => {
  it('filters by year, kind, range and text', () => {
    expect(archFilter(R, { year: 2026 }).map((r) => r.key)).toEqual(['purchase:1', 'file:c']);
    expect(archFilter(R, { kind: 'Решение' })).toHaveLength(1);
    expect(archFilter(R, { from: '2026-01-01' }).map((r) => r.key)).toEqual(['purchase:1']);
    expect(archFilter(R, { q: 'RES.JPG' }).map((r) => r.key)).toEqual(['dossier_doc:2']);
    expect(archKinds(R, 2026)).toEqual(['Влезна фактура', 'Датотека']);
  });
  it('Excel rows oldest first, amounts numeric', () => {
    const x = archXlsxRows(R);
    expect(x[0]).toEqual(['Датум', 'Вид', 'Број', 'Комитент', 'Износ', 'Датотеки']);
    expect(x[3]).toEqual(['2026-03-01', 'Влезна фактура', '12', 'Алфа', 1180, 'f12.pdf']);
  });
  it('file labels', () => {
    expect(archFileLabel(R[0]!.files[0]!)).toBe('PDF · f12.pdf');
    expect(archFileLabel(R[1]!.files[0]!)).toBe('Слика · res.jpg');
  });
});
