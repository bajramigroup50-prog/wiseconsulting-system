'use client';
/** Read the first sheet of an Excel / CSV / XML file into rows of cells (legacy `impRead0` 5402, `xmlRows` 5394). */
import * as XLSX from 'xlsx';

function xmlRows(txt: string): unknown[][] {
  const doc = new DOMParser().parseFromString(txt, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('xml');
  let best: { el: Element; k: string; n: number } | null = null;
  const walk = (el: Element) => {
    const cnt: Record<string, number> = {};
    for (const c of el.children) cnt[c.localName] = (cnt[c.localName] ?? 0) + 1;
    for (const [k, n] of Object.entries(cnt)) if (n >= 2 && (!best || n > best.n)) best = { el, k, n };
    for (const c of el.children) walk(c);
  };
  walk(doc.documentElement);
  if (!best) return [];
  const b = best as { el: Element; k: string };
  const flat = (el: Element, pre: string, o: Record<string, string>) => {
    for (const a of el.attributes) o[pre + a.name] = a.value;
    if (!el.children.length) { o[pre.replace(/\.$/, '') || el.localName] = el.textContent?.trim() ?? ''; return; }
    for (const c of el.children) flat(c, pre + c.localName + '.', o);
  };
  const objs = [...b.el.children].filter((c) => c.localName === b.k).map((r) => {
    const o: Record<string, string> = {};
    for (const c of r.children) { if (c.children.length) flat(c, c.localName + '.', o); else o[c.localName] = c.textContent?.trim() ?? ''; }
    for (const a of r.attributes) o[a.name] = a.value;
    return o;
  });
  const hdr = [...new Set(objs.flatMap(Object.keys))];
  return [hdr, ...objs.map((o) => hdr.map((k) => o[k] ?? ''))];
}

export async function readRows(file: File): Promise<unknown[][]> {
  const nm = file.name.toLowerCase();
  if (/\.xml$/.test(nm)) return xmlRows(await file.text());
  if (/\.(csv|txt)$/.test(nm)) {
    const t = (await file.text()).replace(/^﻿/, '');
    const L = t.split(/\r?\n/).filter((l) => l.trim());
    const dl = [';', '\t', ',', '|'].sort((a, b) => (L[0] ?? '').split(b).length - (L[0] ?? '').split(a).length)[0]!;
    return L.map((l) => l.split(dl).map((c) => c.replace(/^"|"$/g, '').trim()));
  }
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true });
  const sh = wb.Sheets[wb.SheetNames[0]!]!;
  return XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: '', raw: true });
}

/** Download a one-sheet workbook (template). */
export function downloadXlsx(name: string, aoa: unknown[][]): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Податоци');
  XLSX.writeFile(wb, name);
}
