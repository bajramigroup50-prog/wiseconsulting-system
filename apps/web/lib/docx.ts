/**
 * Word templates (legacy `tplFill` / `tplScan` 16050–16068, which unzipped and edited the XML by hand):
 * docxtemplater with `{{KEY}}` delimiters fills placeholders even when Word splits them across runs.
 * Keys are normalised like legacy `tplNorm` (`{{ фирма едб }}` → `ФИРМА_ЕДБ`); unknown keys print a blank line.
 * Also builds stored ZIPs for document packages (one ZIP implementation — FIX #16).
 */
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { TPL_MISSING, tplNorm, tplScanText } from '@wise/core/office';

const XML_PARTS = /^word\/(document|header\d*|footer\d*)\.xml$/;

/** Placeholders used in a .docx (paragraph text joined across runs, like legacy `tplScan`). */
export function scanDocx(buf: Uint8Array): string[] {
  const zip = new PizZip(buf);
  const out = new Set<string>();
  for (const name of Object.keys(zip.files).filter((n) => XML_PARTS.test(n))) {
    const xml = zip.file(name)!.asText();
    for (const p of xml.split(/<\/w:p>/)) {
      const text = [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
      for (const k of tplScanText(text)) out.add(k);
    }
  }
  return [...out];
}

/** Fill a .docx template; returns the new file and the placeholders that had no value. */
export function fillDocx(buf: Uint8Array, vars: Record<string, string>): { out: Uint8Array; missing: string[] } {
  const zip = new PizZip(buf);
  const missing = new Set<string>();
  const doc = new Docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' },
    paragraphLoop: true,
    linebreaks: true,
    parser: (tag: string) => ({
      get: () => {
        const k = tplNorm(tag);
        if (vars[k] != null && vars[k] !== '') return vars[k];
        missing.add(k);
        return TPL_MISSING;
      },
    }),
  });
  doc.render({});
  const out = doc.getZip().generate({ type: 'uint8array', compression: 'DEFLATE' }) as Uint8Array;
  return { out, missing: [...missing] };
}

/** ZIP of named files (packages: legacy `zipStore` 8121). Duplicate names get a numeric suffix. */
export function zipFiles(entries: { name: string; data: Uint8Array | string }[], opts: { dirs?: boolean } = {}): Uint8Array {
  const zip = new PizZip();
  const used = new Set<string>();
  for (const e of entries) {
    // `dirs`: `/` separates folders inside the zip (each segment sanitised on its own).
    let n = opts.dirs ? e.name.split('/').map((x) => x.replace(/[\\:*?"<>|]+/g, '_')).join('/') : e.name.replace(/[\\/:*?"<>|]+/g, '_');
    for (let i = 2; used.has(n.toLowerCase()); i++) n = e.name.replace(/(\.[^.]*)?$/, (x) => ` (${i})${x}`);
    used.add(n.toLowerCase());
    zip.file(n, e.data, { binary: typeof e.data !== 'string' });
  }
  return zip.generate({ type: 'uint8array', compression: 'DEFLATE' }) as Uint8Array;
}

/** Minimal valid .docx with the given paragraphs (used by tests and the "sample template" download). */
export function minimalDocx(paragraphs: string[][]): Uint8Array {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = paragraphs.map((runs) => `<w:p>${runs.map((r) => `<w:r><w:t xml:space="preserve">${esc(r)}</w:t></w:r>`).join('')}</w:p>`).join('');
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generate({ type: 'uint8array' }) as Uint8Array;
}

/** Plain text of a .docx (for tests / previews). */
export const docxText = (buf: Uint8Array) =>
  [...new PizZip(buf).file('word/document.xml')!.asText().matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');

/** Paragraphs of a printed HTML document: `center` + runs `[text, bold]` (block tags and `<br>` split paragraphs). */
export function htmlParagraphs(html: string): { center: boolean; runs: [string, boolean][] }[] {
  const ent = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const src = html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<img[^>]*>/gi, '');
  const out: { center: boolean; runs: [string, boolean][] }[] = [];
  const parts = src.split(/(<(?:p|h[1-6]|div|li|tr)\b[^>]*>|<\/(?:p|h[1-6]|div|li|tr)>|<br\s*\/?>)/i);
  let center = false, bold = 0, runs: [string, boolean][] = [];
  const flush = () => {
    const R = runs.map(([t, b]) => [t.replace(/\s+/g, ' '), b] as [string, boolean]).filter(([t]) => t !== '');
    if (R.some(([t]) => t.trim())) { R[0]![0] = R[0]![0].replace(/^\s+/, ''); out.push({ center, runs: R }); }
    runs = [];
  };
  for (const p of parts) {
    if (!p) continue;
    const open = /^<(p|h[1-6]|div|li|tr)\b([^>]*)>$/i.exec(p);
    if (open) {
      flush();
      const h = /^h/i.test(open[1]!);
      center = h || /text-align\s*:\s*center/i.test(open[2] ?? '');
      if (h) bold++;
      continue;
    }
    if (/^<\/(p|h[1-6]|div|li|tr)>$/i.test(p)) { flush(); if (/^<\/h/i.test(p)) bold = Math.max(0, bold - 1); center = false; continue; }
    if (/^<br/i.test(p)) { flush(); continue; }
    for (const seg of p.split(/(<\/?(?:b|strong)\b[^>]*>)/i)) {
      if (/^<(b|strong)\b/i.test(seg)) { bold++; continue; }
      if (/^<\/(b|strong)>/i.test(seg)) { bold = Math.max(0, bold - 1); continue; }
      const t = ent(seg.replace(/<[^>]*>/g, ''));
      if (t) runs.push([t, bold > 0]);
    }
  }
  flush();
  return out;
}

/** A .docx from a printed HTML document — the program's own documents as Word when there is no own template. */
export function htmlDocx(html: string): Uint8Array {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rpr = (b: boolean) => `<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>${b ? '<w:b/>' : ''}<w:sz w:val="24"/></w:rPr>`;
  const body = htmlParagraphs(html).map((p) => `<w:p><w:pPr><w:spacing w:after="80"/><w:jc w:val="${p.center ? 'center' : 'both'}"/></w:pPr>${p.runs.map(([t, b]) => `<w:r>${rpr(b)}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`).join('')}</w:p>`).join('');
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1418" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip.generate({ type: 'uint8array', compression: 'DEFLATE' }) as Uint8Array;
}
