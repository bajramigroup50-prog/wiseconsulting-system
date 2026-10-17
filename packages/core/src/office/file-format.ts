/** File format by name / type, for the shared `<Uvoz>` import component (browser side, no parsers). */

export interface IncomingFile { name: string; mime: string }

export const isImageFile = (f: IncomingFile) => /^image\//.test(f.mime) || /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i.test(f.name);
export const isPdfFile = (f: IncomingFile) => f.mime === 'application/pdf' || /\.pdf$/i.test(f.name);
export const isXmlFile = (f: IncomingFile) => /\.xml$/i.test(f.name) || /^(text|application)\/([\w.-]+\+)?xml$/i.test(f.mime);
export const isDocxFile = (f: IncomingFile) => /\.docx$/i.test(f.name) || /wordprocessingml/.test(f.mime);

/** Short label of the format (the `<Uvoz>` chip): PDF, слика, XML, Excel, CSV/TXT, MT940, КБ, Word. */
export function fileFormatLabel(f: IncomingFile): string {
  const n = f.name.toLowerCase();
  if (isPdfFile(f)) return 'PDF';
  if (isImageFile(f)) return 'слика';
  if (isXmlFile(f)) return 'XML';
  if (/\.(xlsx|xls|xlsm|ods)$/.test(n)) return 'Excel';
  if (/\.(sta|940|mt940|swi)$/.test(n)) return 'MT940';
  if (/\.\d{3}$/.test(n)) return 'КБ';
  if (/\.(csv|txt|tsv)$/.test(n)) return 'CSV/TXT';
  if (isDocxFile(f) || /\.doc$/.test(n)) return 'Word';
  if (/\.zip$/.test(n)) return 'ZIP';
  if (/\.json$/.test(n)) return 'JSON';
  return 'непознат';
}

/** Does a file match an `accept` attribute (`.pdf,image/*,application/pdf`)? Empty accept = everything. */
export function acceptsFile(accept: string | null | undefined, f: IncomingFile): boolean {
  const A = String(accept ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!A.length) return true;
  const n = f.name.toLowerCase(), m = (f.mime || '').toLowerCase();
  return A.some((a) => (a.startsWith('.') ? n.endsWith(a) : a.endsWith('/*') ? m.startsWith(a.slice(0, -1)) : m === a));
}
