#!/usr/bin/env node
/**
 * Static sweep for invalid HTML nesting in apps/web JSX (hydration errors):
 *  - a <form> (or a component that renders one: ActionForm, RowAction, …) inside another form;
 *  - <a>/<button> (or a component rendering a button) inside <button>;
 *  - <div>/<p>/<table>/<ul>/<h1-6> inside <p>;
 *  - <tr> directly in <table>, <td>/<th> directly in <table>/<tbody>/<thead>.
 * Heuristic, file-local: a component counts as "renders a form/button" when its body (any file) contains one.
 * Usage: node tools/parity-check/html-nesting.mjs [--json]
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '../..');
const web = path.join(root, 'apps/web');
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (/\.tsx$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p);
  }
})(web);

/** Tokenise JSX tags: `<Name …>` / `</Name>` / `<Name … />`, skipping braces and strings inside attributes. */
function tags(src) {
  const out = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '<') continue;
    const prev = src[i - 1] ?? ' ';
    if (src[i + 1] !== '/' && /[\w$]/.test(prev)) continue; // generics
    let j = i + 1, close = false;
    if (src[j] === '/') { close = true; j++; }
    const m = /^[A-Za-z][\w.]*/.exec(src.slice(j, j + 60));
    if (!m) { if (src[j] === '>' ) out.push({ name: '', close, self: false, pos: i }); continue; }
    const name = m[0];
    j += name.length;
    if (!close && !/[\s/>]/.test(src[j] ?? '')) continue;
    let depth = 0, q = null, self = false;
    for (; j < src.length; j++) {
      const c = src[j];
      if (q) { if (c === '\\') { j++; continue; } if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) { self = src[j - 1] === '/'; break; }
      else if (c === '\n' && depth === 0 && close) break;
    }
    // A tag right after `=` / `return` starts a new JSX expression (a row or cell kept in a variable): checked on its own.
    const root = !close && /(?:[^=!<>]=|\breturn)\s*\(?\s*$/.test(src.slice(Math.max(0, i - 24), i));
    out.push({ name, close, self, root, pos: i, end: j });
    i = j;
  }
  return out;
}

/** Blank out comments and one-line string/template literals (keeping offsets and newlines) so `<b>` in them is not a tag. */
function blank(src) {
  const sp = (m) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, sp)
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, a) => a + sp(m.slice(a.length)))
    .replace(/`(?:[^`\\\n]|\\.)*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, (m) => m[0] + sp(m.slice(1, -1)) + m[0]);
}

/** Component bodies per file: `file::Name` → source text; a name used in a file resolves to the local definition, else to the exported ones. */
const bodies = new Map();
const exported = new Map();
const decl = /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+([A-Z]\w*)|const\s+([A-Z]\w*)\s*=\s*(?:\(|async|React\.memo|memo|forwardRef))/g;
const srcs = new Map();
for (const f of files) {
  const s = blank(fs.readFileSync(f, 'utf8'));
  srcs.set(f, s);
  const D = [...s.matchAll(decl)];
  D.forEach((m, k) => {
    const name = m[1] ?? m[2];
    const key = f + '::' + name;
    // The body ends at the next declaration (of any kind) indented no deeper than this one.
    const ind = /^\n?([ \t]*)/.exec(m[0])[1].length;
    const B = new RegExp(`\\n[ \\t]{0,${ind}}(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function|const|let|interface|type)\\s`, 'g');
    B.lastIndex = m.index + m[0].length;
    const body = s.slice(m.index, B.exec(s)?.index ?? s.length);
    bodies.set(key, (bodies.get(key) ?? '') + body);
    if (/^\s*export\b/.test(m[0])) exported.set(name, [...(exported.get(name) ?? []), key]);
  });
}
const resolve = (file, name) => (bodies.has(file + '::' + name) ? [file + '::' + name] : exported.get(name) ?? []);
const rendersTag = (re) => {
  const set = new Set();
  for (const [k, b] of bodies) if (re.test(b)) set.add(k);
  for (let changed = true; changed;) {
    changed = false;
    for (const [k, b] of bodies) {
      if (set.has(k)) continue;
      const file = k.split('::')[0];
      for (const t of tags(b)) if (!t.close && /^[A-Z]/.test(t.name) && resolve(file, t.name).some((x) => x !== k && set.has(x))) { set.add(k); changed = true; break; }
    }
  }
  return set;
};
const formKeys = rendersTag(/<form[\s>]/);
const buttonKeys = rendersTag(/<(button|a)[\s>]/);

const hits = [];
for (const [f, s] of srcs) {
  const stack = [];
  const line = (pos) => s.slice(0, pos).split('\n').length;
  const rel = path.relative(root, f).replace(/\\/g, '/');
  const isForm = (n) => n === 'form' || (/^[A-Z]/.test(n) && resolve(f, n).some((k) => formKeys.has(k)));
  const isButtonComp = (n) => /^[A-Z]/.test(n) && resolve(f, n).some((k) => buttonKeys.has(k));
  const top = () => { let k = stack.length; while (k > 0 && stack[k - 1].name !== "#root") k--; return stack.slice(k); };
  const inStack = (pred) => top().some((x) => pred(x.name));
  const parent = () => top().at(-1)?.name;
  for (const t of tags(s)) {
    if (t.close) {
      for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name === t.name) { stack.length = k; if (stack.at(-1)?.name === "#root") stack.pop(); break; }
      continue;
    }
    const n = t.name;
    if (!n) continue;
    if (t.root && !t.self) stack.push({ name: "#root", pos: t.pos });
    if (isForm(n) && inStack(isForm)) hits.push({ file: rel, line: line(t.pos), kind: 'form in form', tag: n, outer: stack.filter((x) => isForm(x.name)).map((x) => x.name).join('>') });
    if ((n === 'a' || n === 'button' || isButtonComp(n)) && inStack((x) => x === 'button')) hits.push({ file: rel, line: line(t.pos), kind: 'interactive in button', tag: n });
    if (/^(div|p|table|ul|ol|h[1-6]|form|section|pre|details)$/.test(n) && inStack((x) => x === 'p')) hits.push({ file: rel, line: line(t.pos), kind: 'block in <p>', tag: n });
    if (n === 'tr' && parent() === 'table') hits.push({ file: rel, line: line(t.pos), kind: '<tr> directly in <table>', tag: n });
    if ((n === 'td' || n === 'th') && /^(table|tbody|thead|tfoot)$/.test(parent() ?? '')) hits.push({ file: rel, line: line(t.pos), kind: `<${n}> outside <tr>`, tag: n });
    if (!t.self) stack.push({ name: n, pos: t.pos });
  }
}
if (process.argv.includes('--json')) console.log(JSON.stringify(hits, null, 1));
else { for (const h of hits) console.log(`${h.file}:${h.line}  ${h.kind}  <${h.tag}>${h.outer ? '  in ' + h.outer : ''}`); console.log(`${hits.length} hit(s); form components: ${formKeys.size}, button components: ${buttonKeys.size}`); }
process.exitCode = hits.length ? 1 : 0;
