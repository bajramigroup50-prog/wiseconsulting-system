/**
 * Minimal XML reader for UBL import (no DOM in Node / the worker). Elements, attributes, text, CDATA and the five
 * predefined entities plus numeric character references; namespace prefixes are dropped (`localName`).
 */
export interface XmlEl { name: string; attrs: Record<string, string>; children: XmlEl[]; text: string }

const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e: string) => {
  const l = e.toLowerCase();
  if (l === 'lt') return '<';
  if (l === 'gt') return '>';
  if (l === 'amp') return '&';
  if (l === 'quot') return '"';
  if (l === 'apos') return "'";
  return String.fromCodePoint(l.startsWith('#x') ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10));
});
const local = (n: string) => n.slice(n.indexOf(':') + 1);

/** Parse an XML document; throws on malformed input. Returns the root element. */
export function parseXml(src: string): XmlEl {
  const root: XmlEl = { name: '#doc', attrs: {}, children: [], text: '' };
  const stack: XmlEl[] = [root];
  let i = 0;
  const top = () => stack[stack.length - 1]!;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { top().text += decode(src.slice(i)); break; }
    if (lt > i) top().text += decode(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt); if (e < 0) throw new Error('xml: comment'); i = e + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt); if (e < 0) throw new Error('xml: cdata'); top().text += src.slice(lt + 9, e); i = e + 3; continue; }
    if (src.startsWith('<?', lt) || src.startsWith('<!', lt)) { const e = src.indexOf('>', lt); if (e < 0) throw new Error('xml: decl'); i = e + 1; continue; }
    const gt = src.indexOf('>', lt);
    if (gt < 0) throw new Error('xml: tag');
    const raw = src.slice(lt + 1, gt);
    i = gt + 1;
    if (raw.startsWith('/')) {
      const n = local(raw.slice(1).trim());
      const el = stack.pop();
      if (!el || el.name !== n || !stack.length) throw new Error('xml: mismatched </' + n + '>');
      continue;
    }
    const self = raw.endsWith('/');
    const body = self ? raw.slice(0, -1) : raw;
    const m = /^\s*([^\s/>]+)/.exec(body);
    if (!m) throw new Error('xml: name');
    const el: XmlEl = { name: local(m[1]!), attrs: {}, children: [], text: '' };
    const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a: RegExpExecArray | null;
    const rest = body.slice(m[0].length);
    while ((a = re.exec(rest))) el.attrs[local(a[1]!)] = decode(a[3] ?? a[4] ?? '');
    top().children.push(el);
    if (!self) stack.push(el);
  }
  if (stack.length !== 1) throw new Error('xml: unclosed');
  const r = root.children[0];
  if (!r) throw new Error('xml: empty');
  return r;
}

/** All descendants along a `/`-separated path of local names. */
export function xmlAll(el: XmlEl | null | undefined, path: string): XmlEl[] {
  let cur = el ? [el] : [];
  for (const p of path.split('/')) cur = cur.flatMap((e) => e.children.filter((c) => c.name === p));
  return cur;
}
export const xmlOne = (el: XmlEl | null | undefined, path: string): XmlEl | null => xmlAll(el, path)[0] ?? null;
export const xmlText = (el: XmlEl | null | undefined, path: string): string => (xmlOne(el, path)?.text ?? '').trim();
