import { describe, expect, it } from 'vitest';
import { archFileLabel, archPreviewKind, archFilter, archKinds, archXlsxRows, delovodnik, regBookOf, type ArchRow } from './archive';

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
  it('preview kind: PDF / text in a frame, images inline, office files only open / download', () => {
    expect(archPreviewKind('application/pdf')).toBe('frame');
    expect(archPreviewKind('application/octet-stream', 'izvod.PDF')).toBe('frame');
    expect(archPreviewKind('text/csv')).toBe('frame');
    expect(archPreviewKind('image/jpeg')).toBe('img');
    expect(archPreviewKind('image/tiff')).toBe('none');
    expect(archPreviewKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'x.xlsx')).toBe('none');
  });
});

describe('delovodnik', () => {
  const row = (key: string, date: string, kind: string, extra: Partial<ArchRow> = {}): ArchRow => ({ key, date, kind, no: '', pn: '', amt: null, files: [], ...extra });
  it('numbers every document of the year once, per book, in date order', () => {
    const R = delovodnik([
      row('invoice:b', '2026-03-02', 'Излезна фактура'), row('purchase:a', '2026-01-05', 'Влезна фактура'),
      row('invoice:a', '2026-01-10', 'Излезна фактура'), row('dossier_doc:x', '2026-02-01', 'Договор'),
      row('purchase:b', '2026-01-05', 'Фискална сметка'), row('bank_statement:z', '2025-12-31', 'Извод'),
      row('file:l', '2026-04-01', 'Датотека', { loose: true }), row('firm_image:i', '2026-01-01', 'Лого / потпис / печат'),
    ], 2026);
    expect(R.map((r) => `${r.regNo} ${r.key}`)).toEqual([
      '01-1/26 purchase:a', '01-2/26 purchase:b', '02-1/26 invoice:a', '03-1/26 dossier_doc:x', '02-2/26 invoice:b',
    ]);
    expect(regBookOf({ kind: 'Чека одобрување' })).toBe('in');
  });
});
