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
export function zipFiles(entries: { name: string; data: Uint8Array | string }[]): Uint8Array {
  const zip = new PizZip();
  const used = new Set<string>();
  for (const e of entries) {
    let n = e.name.replace(/[\\/:*?"<>|]+/g, '_');
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
