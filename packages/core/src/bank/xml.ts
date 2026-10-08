/**
 * Minimal, dependency-free XML reader for bank statements (Halk `RacunPrivredaIzvod`, ISO 20022 camt.053).
 * Replaces the browser `DOMParser` the legacy code used. Supports elements, attributes (with
 * attribute-value normalisation), text, CDATA, character/entity references; skips comments,
 * processing instructions and DOCTYPE. Malformed input → `null` (legacy: `parsererror` → null).
 */

export interface XmlElement {
  /** Qualified name as written (`ns:Tag`). */
  name: string;
  /** Local name (prefix removed) — what `getElementsByTagNameNS('*', x)` / `localName` match. */
  local: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Child nodes in order: elements and text chunks. */
  nodes: (XmlElement | string)[];
}

const ENT: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeEntities(s: string): string | null {
  let bad = false;
  const out = s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][\w.-]*);/g, (_m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!(cp >= 0 && cp <= 0x10ffff)) { bad = true; return ''; }
      return String.fromCodePoint(cp);
    }
    const v = ENT[e];
    if (v == null) { bad = true; return ''; }
    return v;
  });
  if (bad || /&(?!(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][\w.-]*);)/.test(s)) return null;
  return out;
}

const NAME = /^[A-Za-z_À-￿][\w.\-:·À-￿]*/;

/** Parse an XML document; returns the root element or `null` when not well-formed. */
export function parseXml(src: string): XmlElement | null {
  const s = src.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  let i = 0;
  const n = s.length;
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;

  const pushText = (t: string): boolean => {
    if (!t) return true;
    const top = stack[stack.length - 1];
    if (!top) return /^\s*$/.test(t);
    const d = decodeEntities(t);
    if (d == null) return false;
    top.nodes.push(d);
    return true;
  };

  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { if (!pushText(s.slice(i))) return null; break; }
    if (lt > i && !pushText(s.slice(i, lt))) return null;
    i = lt;
    if (s.startsWith('<!--', i)) {
      const e = s.indexOf('-->', i + 4);
      if (e < 0) return null;
      i = e + 3;
    } else if (s.startsWith('<![CDATA[', i)) {
      const e = s.indexOf(']]>', i + 9);
      if (e < 0) return null;
      const top = stack[stack.length - 1];
      if (!top) return null;
      top.nodes.push(s.slice(i + 9, e));
      i = e + 3;
    } else if (s.startsWith('<?', i)) {
      const e = s.indexOf('?>', i + 2);
      if (e < 0) return null;
      i = e + 2;
    } else if (s.startsWith('<!', i)) {
      // DOCTYPE (optionally with an internal subset)
      let depth = 0;
      let j = i + 2;
      for (; j < n; j++) {
        const c = s[j];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      if (j >= n) return null;
      i = j + 1;
    } else if (s[i + 1] === '/') {
      const m = s.slice(i + 2).match(NAME);
      if (!m) return null;
      const name = m[0];
      let j = i + 2 + name.length;
      while (j < n && /\s/.test(s[j]!)) j++;
      if (s[j] !== '>') return null;
      const top = stack.pop();
      if (!top || top.name !== name) return null;
      i = j + 1;
    } else {
      const m = s.slice(i + 1).match(NAME);
      if (!m) return null;
      const name = m[0];
      const colon = name.indexOf(':');
      const el: XmlElement = { name, local: colon >= 0 ? name.slice(colon + 1) : name, attrs: {}, children: [], nodes: [] };
      let j = i + 1 + name.length;
      let selfClose = false;
      for (;;) {
        while (j < n && /\s/.test(s[j]!)) j++;
        if (j >= n) return null;
        if (s[j] === '>') { j++; break; }
        if (s[j] === '/' && s[j + 1] === '>') { selfClose = true; j += 2; break; }
        const am = s.slice(j).match(NAME);
        if (!am) return null;
        const an = am[0];
        j += an.length;
        while (j < n && /\s/.test(s[j]!)) j++;
        if (s[j] !== '=') return null;
        j++;
        while (j < n && /\s/.test(s[j]!)) j++;
        const q = s[j];
        if (q !== '"' && q !== "'") return null;
        const e = s.indexOf(q, j + 1);
        if (e < 0) return null;
        const raw = s.slice(j + 1, e);
        if (raw.includes('<')) return null;
        // attribute-value normalisation: literal whitespace chars → space, then references
        const v = decodeEntities(raw.replace(/[\t\n]/g, ' '));
        if (v == null) return null;
        if (an in el.attrs) return null;
        el.attrs[an] = v;
        j = e + 1;
      }
      const parent = stack[stack.length - 1];
      if (parent) { parent.children.push(el); parent.nodes.push(el); }
      else if (root) return null; // second root element
      else root = el;
      if (!selfClose) stack.push(el);
      i = j;
    }
  }
  if (stack.length || !root) return null;
  return root;
}

/** `textContent` — all descendant text in document order. */
export function textOf(el: XmlElement): string {
  let out = '';
  for (const c of el.nodes) out += typeof c === 'string' ? c : textOf(c);
  return out;
}

/** Descendants (not self) in document order — like `getElementsByTagName`/`…NS`. */
export function descendants(el: XmlElement, pred: (e: XmlElement) => boolean): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (x: XmlElement) => {
    for (const c of x.children) {
      if (pred(c)) out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}

/** `doc.getElementsByTagName(name)` where `doc` is the document (root included). */
export function byTagInDoc(root: XmlElement, name: string): XmlElement[] {
  return [...(root.name === name ? [root] : []), ...descendants(root, (e) => e.name === name)];
}

/** `doc.getElementsByTagNameNS('*', local)` on the document (root included). */
export function byLocalInDoc(root: XmlElement, local: string): XmlElement[] {
  return [...(root.local === local ? [root] : []), ...descendants(root, (e) => e.local === local)];
}
