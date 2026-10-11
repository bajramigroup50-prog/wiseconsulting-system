/**
 * A filled Word template as HTML for the PDF output (legacy `tplHtml` 16070): paragraphs with alignment, indents and
 * spacing, bold/italic/underline/size/caps runs, tabs, line and page breaks, list numbering (numbering.xml + styles),
 * tables (borders, gridSpan), images (media passed in as data URLs) and the default header.
 * Pure string work: a small XML reader instead of the browser DOMParser legacy used.
 */

export interface XNode { n: string; a: Record<string, string>; c: XNode[]; t?: string }

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unent = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m);

/** Minimal XML reader (elements, attributes, text; comments / PIs / doctype skipped). */
export function parseXml(xml: string): XNode {
  const root: XNode = { n: '#root', a: {}, c: [] };
  const st: XNode[] = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!(?:[^>]*)>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = st[st.length - 1]!;
    if (m[1] != null) { top.c.push({ n: '#text', a: {}, c: [], t: m[1] }); continue; }
    if (m[6] != null) { top.c.push({ n: '#text', a: {}, c: [], t: unent(m[6]) }); continue; }
    if (!m[3]) continue;
    if (m[2]) { for (let k = st.length - 1; k > 0; k--) if (st[k]!.n === m[3]) { st.length = k; break; } continue; }
    const a: Record<string, string> = {};
    for (const x of (m[4] ?? '').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) a[x[1]!] = unent(x[2] ?? x[3] ?? '');
    const el: XNode = { n: m[3], a, c: [] };
    top.c.push(el);
    if (!m[5]) st.push(el);
  }
  return root;
}

const local = (n: string) => n.slice(n.indexOf(':') + 1);
const kids = (el: XNode | null | undefined, n: string) => (el ? el.c.filter((x) => local(x.n) === n) : []);
const one = (el: XNode | null | undefined, n: string) => kids(el, n)[0] ?? null;
const attr = (el: XNode | null | undefined, n: string) => (el ? el.a['w:' + n] ?? el.a[n] ?? Object.entries(el.a).find(([k]) => local(k) === n)?.[1] ?? null : null);
const val = (el: XNode | null | undefined) => attr(el, 'val');
const on = (el: XNode | null | undefined) => !!el && !['0', 'false', 'none'].includes(val(el) ?? '');
function* walk(el: XNode, n: string): Generator<XNode> { for (const c of el.c) { if (local(c.n) === n) yield c; yield* walk(c, n); } }
const first = (el: XNode | null | undefined, n: string) => (el ? walk(el, n).next().value ?? null : null);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface DocxParts {
  document: string;
  rels?: string;
  numbering?: string;
  styles?: string;
  /** Header parts by zip name (`word/header1.xml`). */
  headers?: Record<string, string>;
  /** Images by zip name (`word/media/image1.png`) as data URLs. */
  media?: Record<string, string>;
}

const roman = (n: number) => { let r = ''; for (const [v, s] of [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']] as const) while (n >= v) { r += s; n -= v; } return r; };
const fmtN = (n: number, f: string) => f === 'lowerLetter' ? String.fromCharCode(96 + ((n - 1) % 26) + 1) : f === 'upperLetter' ? String.fromCharCode(64 + ((n - 1) % 26) + 1)
  : f === 'lowerRoman' ? roman(n) : f === 'upperRoman' ? roman(n).toUpperCase() : f === 'bullet' ? '•' : f === 'none' ? '' : String(n);

export function docxToHtml(P: DocxParts): string {
  const rel: Record<string, string> = {};
  if (P.rels) for (const r of walk(parseXml(P.rels), 'Relationship')) if (r.a.Id) rel[r.a.Id] = r.a.Target ?? '';
  const img = (id: string) => { const t = rel[id]; if (!t) return ''; const nm = 'word/' + t.replace(/^\.?\//, '').replace(/^\/?word\//, ''); return P.media?.[nm] ?? ''; };

  const NUM: { abs: Record<string, Record<string, { fmt: string; txt: string; start: number }>>; num: Record<string, string> } = { abs: {}, num: {} };
  if (P.numbering) {
    const nd = parseXml(P.numbering);
    for (const a of walk(nd, 'abstractNum')) {
      const L: Record<string, { fmt: string; txt: string; start: number }> = {};
      for (const l of walk(a, 'lvl')) { const g = (n: string) => val(first(l, n)); L[attr(l, 'ilvl') ?? '0'] = { fmt: g('numFmt') || 'decimal', txt: g('lvlText') ?? '%1.', start: +(g('start') || 1) }; }
      NUM.abs[attr(a, 'abstractNumId') ?? ''] = L;
    }
    for (const n of walk(nd, 'num')) NUM.num[attr(n, 'numId') ?? ''] = val(first(n, 'abstractNumId')) ?? '';
  }
  const SNUM: Record<string, XNode> = {};
  if (P.styles) for (const s of walk(parseXml(P.styles), 'style')) { const np = first(s, 'numPr'); const id = attr(s, 'styleId'); if (np && id) SNUM[id] = np; }
  const CNT: Record<string, Record<number, number>> = {};
  const numLbl = (pr: XNode) => {
    let np = one(pr, 'numPr');
    if (!np) { const ps = val(one(pr, 'pStyle')); if (ps && SNUM[ps]) np = SNUM[ps]!; }
    if (!np) return '';
    const id = val(one(np, 'numId')) ?? '', il = +(val(one(np, 'ilvl')) || 0);
    const L = NUM.abs[NUM.num[id] ?? ''];
    if (!L || !L[il] || id === '0') return '';
    const c = (CNT[id] ??= {});
    c[il] = c[il] == null ? L[il]!.start : c[il]! + 1;
    for (const k of Object.keys(c)) if (+k > il) delete c[+k];
    if (L[il]!.fmt === 'bullet') return '• ';
    return L[il]!.txt.replace(/%(\d)/g, (_m, d: string) => { const lv = +d - 1; const v = c[lv] ?? L[lv]?.start ?? 1; return fmtN(v, L[lv]?.fmt ?? 'decimal'); }) + ' ';
  };

  const run = (r: XNode) => {
    const pr = one(r, 'rPr');
    let st = '';
    if (pr) {
      if (on(one(pr, 'b'))) st += 'font-weight:bold;';
      if (on(one(pr, 'i'))) st += 'font-style:italic;';
      if (on(one(pr, 'u'))) st += 'text-decoration:underline;';
      const sz = val(one(pr, 'sz')); if (sz) st += `font-size:${+sz / 2}pt;`;
      if (on(one(pr, 'caps'))) st += 'text-transform:uppercase;';
    }
    let o = '';
    for (const c of r.c) {
      const n = local(c.n);
      if (n === 't') o += esc(c.c.map((x) => x.t ?? '').join(''));
      else if (n === 'tab') o += '&emsp;';
      else if (n === 'br') o += attr(c, 'type') === 'page' ? '</span><div class="pb"></div><span>' : '<br>';
      else if (n === 'drawing') {
        const bl = first(c, 'blip'), ex = first(c, 'extent');
        const src = bl ? img(bl.a['r:embed'] ?? '') : '';
        if (src) { const w = ex ? Math.round(+(ex.a.cx ?? 0) / 9525) : 0, hh = ex ? Math.round(+(ex.a.cy ?? 0) / 9525) : 0; o += `<img src="${src}" style="${w ? `width:${w}px;` : ''}${hh ? `height:${hh}px;` : ''}vertical-align:middle">`; }
      }
    }
    return o ? `<span style="${st}">${o}</span>` : '';
  };
  const para = (p: XNode) => {
    const pr = one(p, 'pPr');
    const al = ({ center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' } as Record<string, string>)[val(one(pr, 'jc')) ?? ''] ?? 'left';
    const ind = one(pr, 'ind');
    const li = ind ? +(attr(ind, 'left') ?? attr(ind, 'start') ?? 0) : 0, fl = ind ? +(attr(ind, 'firstLine') ?? 0) : 0;
    const sp = one(pr, 'spacing');
    const af = sp ? +(attr(sp, 'after') ?? 120) : 120, bf = sp ? +(attr(sp, 'before') ?? 0) : 0;
    const pb = on(one(pr, 'pageBreakBefore'));
    let inner = '';
    for (const c of p.c) {
      const n = local(c.n);
      if (n === 'r') inner += run(c);
      else if (['hyperlink', 'ins', 'smartTag', 'fldSimple', 'sdt'].includes(n)) for (const r of walk(c, 'r')) inner += run(r);
    }
    const nl = pr ? numLbl(pr) : '';
    return (pb ? '<div class="pb"></div>' : '') + `<p style="margin:${bf / 20 || 0}pt 0 ${af / 20 || 0}pt ${li / 20 || 0}pt;text-indent:${fl / 20 || 0}pt;text-align:${al};min-height:1em">${nl ? esc(nl) : ''}${inner || '&nbsp;'}</p>`;
  };
  const tbl = (t: XNode): string => {
    const border = first(t, 'tblBorders') ? '1px solid #444' : 'none';
    return `<table style="width:100%;border-collapse:collapse;margin:4pt 0;font-size:inherit;font-family:inherit">${kids(t, 'tr').map((tr) => `<tr>${kids(tr, 'tc').map((tc) => {
      const s0 = parseInt(val(one(one(tc, 'tcPr'), 'gridSpan')) ?? '', 10);
      const sp = s0 >= 1 && s0 <= 63 ? s0 : 0;
      return `<td${sp ? ` colspan="${sp}"` : ''} style="border:${border};padding:2pt 4pt;vertical-align:top">${blk(tc)}</td>`;
    }).join('')}</tr>`).join('')}</table>`;
  };
  const blk = (el: XNode): string => el.c.map((c) => { const n = local(c.n); return n === 'p' ? para(c) : n === 'tbl' ? tbl(c) : n === 'sdt' ? blk(one(c, 'sdtContent') ?? c) : ''; }).join('');

  const doc = parseXml(P.document);
  const body = first(doc, 'body');
  let hdr = '';
  if (body && P.headers) {
    const sps = [...walk(body, 'sectPr')];
    const sp = sps[sps.length - 1];
    const refs = sp ? kids(sp, 'headerReference') : [];
    const hr = refs.find((x) => !['even', 'first'].includes(attr(x, 'type') ?? '')) ?? refs[0];
    const t = hr ? rel[hr.a['r:id'] ?? ''] : undefined;
    const hx = t ? P.headers['word/' + t.replace(/^\.?\//, '')] : undefined;
    if (hx) {
      const hroot = parseXml(hx).c.find((x) => x.n !== '#text');
      const hh = hroot ? blk(hroot) : '';
      if (hh.replace(/<[^>]+>|&nbsp;/g, '').trim() || /<img/.test(hh)) hdr = `<div style="border-bottom:1px solid #999;margin-bottom:8pt;padding-bottom:4pt">${hh}</div>`;
    }
  }
  return `<div style="font-family:'Times New Roman',serif;font-size:12pt;line-height:1.3">${hdr}${body ? blk(body) : ''}</div>`;
}
