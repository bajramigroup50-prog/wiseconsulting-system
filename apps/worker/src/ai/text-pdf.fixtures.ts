/**
 * Test helper: a minimal PDF WITH A TEXT LAYER in Cyrillic, without font files — Helvetica with a `/Differences`
 * encoding that names the glyphs `uniXXXX` (pdfjs maps them back to Unicode) and fixed widths (600). Used to test the
 * free readers on synthetic „text PDFs“ (МПИН declaration, fiscal report, e-receipt).
 */

/** One text cell at (x, y) in PDF points (y from the bottom). */
export interface Cell { x: number; y: number; s: string }

/** Lines with columns separated by 2+ spaces → cells at monospace positions (5.4 pt per character at size 9). */
export function linesToCells(L: readonly string[], o: { x?: number; top?: number; step?: number } = {}): Cell[] {
  const x0 = o.x ?? 30, top = o.top ?? 800, step = o.step ?? 12;
  const out: Cell[] = [];
  L.forEach((line, i) => {
    for (const m of line.matchAll(/\S+(?: \S+)*/g)) out.push({ x: x0 + m.index! * 5.4, y: top - i * step, s: m[0] });
  });
  return out;
}

export function textPdf(cells: readonly Cell[]): Uint8Array {
  const extra: string[] = [];
  const code = (ch: string): string => {
    const c = ch.codePointAt(0)!;
    if (c >= 32 && c < 127) return ch === '(' || ch === ')' || ch === '\\' ? '\\' + ch : ch;
    let i = extra.indexOf(ch);
    if (i < 0) { extra.push(ch); i = extra.length - 1; }
    if (i > 127) throw new Error('too many distinct characters');
    return '\\' + (128 + i).toString(8);
  };
  const body = cells.map((c) => `BT /F1 9 Tf 1 0 0 1 ${c.x.toFixed(2)} ${c.y.toFixed(2)} Tm (${[...c.s].map(code).join('')}) Tj ET`).join('\n');
  const diff = extra.map((ch) => '/uni' + ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')).join(' ');
  const widths = Array.from({ length: 224 }, () => '600').join(' ');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 32 /LastChar 255 /Widths [${widths}] /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [128 ${diff}] >> >>`,
  ];
  let pdf = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}
