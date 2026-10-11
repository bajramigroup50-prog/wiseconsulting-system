#!/usr/bin/env node
/**
 * Automated legacy ↔ server parity checker.
 *
 *   node tools/parity-check/check.mjs [--view id] [--debug]
 *
 * 1. Parses legacy/index.html: every VIEWS.<id> definition (dotted, bracketed, forEach/for-of loops,
 *    aliases), keeps the LAST definition plus the earlier ones it wraps, follows helper calls and
 *    data-act handlers two levels deep, extracts user-facing labels (buttons, columns, fields, tabs,
 *    messages, export/import/print actions).
 * 2. Maps each view to apps/web/app/(app)/<id> (+ (print)/<id>, print/<id>, redirect aliases) and gathers
 *    the text of the route files and everything they import inside apps/web (and @wise/core/<sub>).
 * 3. Fuzzy-matches labels (exact normalised substring, else ≥80 % token overlap on one source line).
 * 4. Runs a static technical sweep over apps/web.
 * Writes docs/parity/AUTO-CHECK.md and docs/parity/auto-check.json. No dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WEB = path.join(ROOT, 'apps/web');
const CORE = path.join(ROOT, 'packages/core/src');
const ARGS = process.argv.slice(2);
const ONLY = ARGS.includes('--view') ? ARGS[ARGS.indexOf('--view') + 1] : null;
const DEBUG = ARGS.includes('--debug');

/* ───────────────────────── JS-aware scanning ───────────────────────── */
const REGEX_PREV = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
/** Scan from `i` (code mode) and return the index right after the end of the expression/statement. */
function scanExpr(s, i, { stopAtNewline = true, max = 400000 } = {}) {
  let depth = 0;
  let last = '';
  const end = Math.min(s.length, i + max);
  while (i < end) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') { i = s.indexOf('\n', i); if (i < 0) return s.length; continue; }
    if (c === '/' && s[i + 1] === '*') { i = s.indexOf('*/', i + 2); if (i < 0) return s.length; i += 2; continue; }
    if (c === '"' || c === "'") { i = skipStr(s, i); last = 'a'; continue; }
    if (c === '`') { i = skipTpl(s, i); last = 'a'; continue; }
    if (c === '/') {
      const kw = /(?:return|typeof|case|in|of)\s*$/.test(s.slice(Math.max(0, i - 8), i));
      if (!last || REGEX_PREV.has(last) || kw) { i = skipRegex(s, i); last = 'a'; continue; }
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth < 0) return i; }
    else if (depth === 0 && (c === ';' || c === ',')) return i;
    else if (depth === 0 && c === '\n' && stopAtNewline && /[\w$)\]}'"`]/.test(last)) {
      // ASI heuristic: the next line must not continue the expression
      const rest = s.slice(i + 1, i + 40).trimStart();
      if (!/^[.?:+\-*/&|=,)\]}]/.test(rest) && !/^(?:\?\?)/.test(rest)) return i;
    }
    if (!/\s/.test(c)) last = c;
    i++;
  }
  return i;
}
function skipStr(s, i) {
  const q = s[i]; i++;
  while (i < s.length) { const c = s[i]; if (c === '\\') { i += 2; continue; } if (c === q) return i + 1; if (c === '\n') return i; i++; }
  return i;
}
function skipTpl(s, i) {
  i++;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') return i + 1;
    if (c === '$' && s[i + 1] === '{') { i = matchClose(s, i + 1) + 1; continue; }
    i++;
  }
  return i;
}
function skipRegex(s, i) {
  i++; let cls = false;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '\n') return i;
    if (cls) { if (c === ']') cls = false; } else if (c === '[') cls = true; else if (c === '/') { i++; while (/[a-z]/.test(s[i])) i++; return i; }
    i++;
  }
  return i;
}
/** s[open] is an opening bracket; returns index of its matching closer. */
function matchClose(s, open) {
  const e = scanExpr(s, open + 1, { stopAtNewline: false });
  // scanExpr stops at `,`/`;` at depth 0 too — keep going until the closer
  let i = e;
  while (i < s.length && (s[i] === ',' || s[i] === ';')) i = scanExpr(s, i + 1, { stopAtNewline: false });
  return i;
}

/* ───────────────────────── legacy parsing ───────────────────────── */
const LEG = fs.readFileSync(path.join(ROOT, 'legacy/index.html'), 'utf8');
// Only code inside <script> blocks
const scripts = [];
for (const m of LEG.matchAll(/<script\b[^>]*>/g)) {
  const st = m.index + m[0].length; const en = LEG.indexOf('</script>', st);
  if (en > st) scripts.push([st, en]);
}
const inScript = (i) => scripts.some(([a, b]) => i >= a && i < b);

const KW = new Set('if for while switch catch function return typeof new await async else do try case of in let const var this super import export class extends delete void yield with'.split(' '));

/** name → [{start,end}] */
const FN = new Map();
const addFn = (name, start, end) => { if (KW.has(name)) return; if (!FN.has(name)) FN.set(name, []); FN.get(name).push({ start, end }); };
function indexFunctions() {
  for (const [a, b] of scripts) {
    const src = LEG.slice(a, b);
    const at = (k) => a + k;
    for (const m of src.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
      const p = at(m.index + m[0].length - 1); const pe = matchClose(LEG, p);
      const br = LEG.indexOf('{', pe); if (br < 0) continue;
      addFn(m[1], at(m.index), matchClose(LEG, br) + 1);
    }
    for (const m of src.matchAll(/(?:\b(?:const|let|var)\s+|(?:^|[;{}\n])\s*(?:ACT|BATCH_ACT|window)\.|^\s*)([A-Za-z_$][\w$]*)\s*=\s*(?=async\b|function\b|\(|[A-Za-z_$][\w$]*\s*=>)/gm)) {
      const st = at(m.index + m[0].length);
      addFn(m[1], st, scanExpr(LEG, st));
    }
    // object-literal methods / properties at line start or after `,` / `{` (ACT={ newFirm(){…}, x:()=>{} })
    for (const m of src.matchAll(/(?:^|[,{])\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*\{/gm)) {
      if (KW.has(m[1])) continue;
      const br = at(m.index + m[0].length - 1);
      addFn(m[1], at(m.index), matchClose(LEG, br) + 1);
    }
    for (const m of src.matchAll(/(?:^|[,{])\s*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:function\b|\([^()]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/gm)) {
      const st = at(m.index + m[0].length);
      addFn(m[1], at(m.index), scanExpr(LEG, st));
    }
    // UPPER-CASE constants (tab lists, column maps)
    for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Z][A-Z0-9_]{1,})\s*=\s*(?=[[{])/g)) {
      const st = at(m.index + m[0].length);
      addFn(m[1], st, scanExpr(LEG, st));
    }
  }
}
indexFunctions();

/** View definitions in source order: {id, start, end, rhs, wraps} */
const DEFS = [];
function indexViews() {
  for (const [a, b] of scripts) {
    const src = LEG.slice(a, b);
    for (const m of src.matchAll(/\bVIEWS(?:\.([A-Za-z_$][\w$]*)|\[\s*(['"])([\w$]+)\2\s*\]|\[\s*([A-Za-z_$][\w$+'" ]*)\s*\])\s*=(?![=>])/g)) {
      const pos = a + m.index; const st = pos + m[0].length;
      const end = scanExpr(LEG, st);
      let ids = [m[1] || m[3]].filter(Boolean);
      if (!ids.length) {
        // dynamic key: look back for the nearest array literal of ids (forEach / for…of)
        const back = LEG.slice(Math.max(a, pos - 600), pos);
        const arrs = [...back.matchAll(/\[((?:\s*'[\w$]+'\s*,?)+)\]\s*(?:\.forEach|\)|\{|$)/g)];
        const objKeys = [...back.matchAll(/for\s*\(\s*const\s+\[?\s*(\w+)[^)]*\s+of\s+Object\.(?:entries|keys)\((\w+)\)/g)];
        const constLoop = back.match(/([A-Z_][A-Z0-9_]+)\.forEach\(\s*\(?\s*\[?\s*\w+[^)]*\)?\s*=>\s*\{?\s*$/);
        if (constLoop && FN.get(constLoop[1])) {
          const c = FN.get(constLoop[1])[0];
          ids = [...LEG.slice(c.start, c.end).matchAll(/\[\s*'([\w$]+)'\s*,/g)].map((x) => x[1]);
        } else if (arrs.length) ids = [...arrs.at(-1)[1].matchAll(/'([\w$]+)'/g)].map((x) => x[1]);
        else if (/'cb_'\s*\+/.test(m[4] || '') && objKeys.length) {
          const obj = FN.get(objKeys.at(-1)[2])?.[0];
          if (obj) ids = [...LEG.slice(obj.start, obj.end).matchAll(/(?:^|[,{])\s*([a-z][\w]*)\s*:/gm)].map((x) => 'cb_' + x[1]);
        } else if (DEBUG) console.error('unresolved dynamic VIEWS key at', pos, m[0]);
      }
      for (const id of ids) DEFS.push({ id, start: pos, end, rhsStart: st });
    }
  }
}
indexViews();

/** For each id: the effective chain of definitions (last one + those it wraps, recursively). */
function viewSpans(id, seen = new Set()) {
  if (seen.has(id)) return [];
  seen.add(id);
  const defs = DEFS.filter((d) => d.id === id);
  const spans = [];
  for (let k = defs.length - 1; k >= 0; k--) {
    const d = defs[k];
    const rhs = LEG.slice(d.rhsStart, d.end).trim();
    spans.push([d.rhsStart, d.end]);
    // alias VIEWS.x=VIEWS.y
    const al = rhs.match(/^VIEWS(?:\.(\w+)|\[['"](\w+)['"]\])$/);
    if (al) { spans.push(...viewSpans(al[1] || al[2], seen)); break; }
    // does it wrap an earlier definition? (const _x=VIEWS.id … _x(m))
    const back = LEG.slice(Math.max(0, d.start - 1500), d.start);
    const aliases = [...back.matchAll(new RegExp(String.raw`(?:const|let|var)\s+(\w+)\s*=\s*VIEWS(?:\.${id}\b|\[\s*\w+\s*\]|\[['"]${id}['"]\])`, 'g'))].map((x) => x[1]);
    const wraps = aliases.some((x) => new RegExp(String.raw`\b${x.replace('$', '\\$')}\s*(?:\(|\.call|\.apply|&&)`).test(rhs))
      || /\b(?:orig|_old|prev|old)\s*\(/.test(rhs);
    if (!wraps) break;
  }
  return spans;
}

/* ───── label extraction ───── */
const EXPORT_RE = /pdf|excel|xlsx|csv|xml|\btxt\b|json|увоз|извоз|увези|извези|печат|испрати|whatsapp|скенир|образец|е-пошта|email|e-mail|mail|import|export|преземи|симни|прикачи|qr|ujp|ујп|e-?tax|е-?даноци/i;
const stripTpl = (t) => {
  let out = ''; let i = 0;
  while (i < t.length) {
    if (t[i] === '$' && t[i + 1] === '{') { const e = matchClose(t, i + 1); out += ' * '; i = e + 1; continue; }
    out += t[i++];
  }
  return out;
};
const cleanText = (t) => stripTpl(t.replace(/(['"])\s*\+[^'"\n]{0,120}?\+\s*\1/g, ' * ')).replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&amp;|&[a-z]+;/g, ' ').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
/** Find end of an HTML open tag starting at `<` (skips ${…} blocks). */
function tagEnd(t, i) {
  while (i < t.length) {
    if (t[i] === '$' && t[i + 1] === '{') { i = matchClose(t, i + 1) + 1; continue; }
    if (t[i] === '>') return i + 1;
    i++;
  }
  return i;
}
function extract(text) {
  const out = [];
  const push = (kind, raw, src) => { const label = cleanText(raw); if (label) out.push({ kind, label, src }); };
  // buttons / th / legend / option-ish
  for (const [re, kind, close] of [[/<button\b/g, 'button', '</button>'], [/<th\b/g, 'column', '</th>'], [/<legend\b/g, 'field', '</legend>'], [/<summary\b/g, 'tab', '</summary>'], [/<h[23]\b/g, 'section', null]]) {
    for (const m of text.matchAll(re)) {
      const te = tagEnd(text, m.index);
      const tag = text.slice(m.index, te);
      const cl = close || `</${text.slice(m.index + 1, m.index + 3)}>`;
      const ce = text.indexOf(cl, te);
      if (ce < 0 || ce - te > 400) continue;
      const k = /role="tab"|Tab"|data-t=|data-tab/.test(tag) && kind === 'button' ? 'tab' : kind;
      push(k, text.slice(te, ce), tag);
    }
  }
  // <label class="btn">, <a class="btn">, <span class="btn">
  for (const m of text.matchAll(/<(label|a|span|div)\b/g)) {
    const te = tagEnd(text, m.index); const tag = text.slice(m.index, te);
    if (/class="[^"]*\bbtn\b/.test(tag) || /data-go=|onclick=/.test(tag)) {
      const inner = text.slice(te, te + 300).split(/<input|<\/(?:label|a|span|div)>/)[0];
      push('button', inner, tag);
    } else if (m[1] === 'label') {
      const inner = text.slice(te, te + 300).split(/<input|<select|<textarea|<\/label>/)[0];
      push('field', inner, tag);
    }
  }
  // field helpers  I('key','Label' …)  /  RB('key','Label',…)
  for (const m of text.matchAll(/\b[A-Za-z]{1,6}\(\s*['"][\w.$-]+['"]\s*,\s*(['"])([^'"\n$<]{2,70})\1/g)) push('field', m[2]);
  // column definitions  ['Label', it=>…]  /  ['Label',(a,b)=>…]
  for (const m of text.matchAll(/\[\s*(['"])([^'"\n<$]{2,60})\1\s*,\s*(?:\([\w\s,{}]*\)|[A-Za-z_$][\w$]*)\s*=>/g)) push('column', m[2]);
  // tab lists in *TAB* constants and ['id','Label'] pairs inside role=tab maps
  // messages
  for (const m of text.matchAll(/\btoast\(\s*(['"`])/g)) {
    const q = m[1]; const st = m.index + m[0].length - 1;
    const e = q === '`' ? skipTpl(text, st) : skipStr(text, st);
    push('message', text.slice(st + 1, e - 1));
  }
  for (const m of text.matchAll(/<div\b/g)) {
    const te = tagEnd(text, m.index); const tag = text.slice(m.index, te);
    if (!/class="(?:callout|card empty|empty)[^"]*"/.test(tag)) continue;
    const inner = text.slice(te, te + 500).split(/<\/div>|<(?:button|div|table|ul|input|select)\b/)[0];
    push('message', inner);
  }
  for (const m of text.matchAll(/\bcallout\(\s*(['"`])/g)) {
    const q = m[1]; const st = m.index + m[0].length - 1;
    const e = q === '`' ? skipTpl(text, st) : skipStr(text, st);
    push('message', text.slice(st + 1, e - 1));
  }
  return out;
}
function extractTabs(name, text) {
  if (!/TAB/i.test(name)) return [];
  return [...text.matchAll(/\[\s*'[\w-]+'\s*,\s*'([^'$]{2,50})'/g)].map((m) => ({ kind: 'tab', label: m[1] }));
}

/** Labels (normalised) */
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu;
function norm(t) {
  return t.toLowerCase().replace(EMOJI, ' ').replace(/ѐ/g, 'е').replace(/ѝ/g, 'и').replace(/[^\p{L}\p{N}*]+/gu, ' ').replace(/(?:\* *)+/g, '* ').replace(/\s+/g, ' ').trim();
}
const STOP = new Set(['и', 'на', 'во', 'за', 'од', 'со', 'по', 'до', 'се', 'да', 'не', 'е', 'а', 'или', 'ги', 'го', 'ја', 'the', '*']);
const tokens = (n) => n.split(' ').filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));
const stem = (w) => (w.length > 5 ? w.slice(0, 5) : w);
const JUNK = /^(?:зачувај f4|откажи esc|нов ред ins|\*|да|не|x|ок|ok|в|н|д|\d+|откажи|затвори|излез|назад|во ред|друга датотека|избриши|измени|отвори|зачувај|додај|\+)$/;
/** runtime-only messages of the browser app (library loading, Firestore, offline cache) — not portable */
const RUNTIME_MSG = /не се вчита|библиотек|модулот|не е поврзана|врската е прекината|firestore|firebase|offline|офлајн|localstorage|кеш|не е дозволено|не е достапн\S* во овој приказ|овде директното|^грешка|не успеа|не може да се прочита|сликата не може|прелистувач|browser|попап|popup/i;

/** Wording variants: without parenthesised hints / shortcut keys, and each " / ", " – ", " · " alternative of 2+ words. */
function variants(label, n) {
  const raw = cleanText(label);
  const noPar = norm(raw.replace(/\([^()]*\)/g, ' '));
  const out = new Set([n]);
  if (noPar && tokens(noPar).length) out.add(noPar);
  for (const seg of raw.replace(/\([^()]*\)/g, ' ').split(/\s[\/–—·:|]\s|\s-\s|→|➜/)) { const sn = norm(seg); if (tokens(sn).length >= 2) out.add(sn); }
  return [...out];
}

/* ───── per-view call graph ───── */
const CALL_RE = /\b([A-Za-z_$][\w$]*)\s*\(/g;
const ACT_RE = /data-(?:act|go)="([\w$]+)"/g;
function refsOf(text) {
  const r = new Set();
  for (const m of text.matchAll(CALL_RE)) if (FN.has(m[1]) && m[1].length > 2) r.add(m[1]);
  for (const m of text.matchAll(ACT_RE)) if (FN.has(m[1])) r.add(m[1]);
  for (const m of text.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) if (FN.has(m[1])) r.add(m[1]);
  return r;
}
const fnText = (name, id) => {
  let t = (FN.get(name) || []).filter((d) => d.end - d.start < 60000).map((d) => LEG.slice(d.start, d.end)).join('\n');
  // per-view maps ( LAGER={g_lager:{…}, m_lager:{…}} ): keep only this view's entry
  const keyed = [...t.matchAll(/(?:^|[,{]|\n)\s*([\w$]+)\s*:\s*[{[]/g)].filter((m) => VIEW_SET.has(m[1]));
  if (new Set(keyed.map((m) => m[1])).size >= 2) {
    const own = keyed.find((m) => m[1] === id);
    if (!own) return '';
    const st = own.index + own[0].length - 1;
    t = t.slice(st, matchClose(t, st) + 1);
  }
  return t;
};

const VIEW_IDS = [...new Set(DEFS.map((d) => d.id))].filter((id) => !ONLY || id === ONLY || true);
const VIEW_SET = new Set(VIEW_IDS);
const viewBody = new Map(VIEW_IDS.map((id) => [id, viewSpans(id).map(([a, b]) => LEG.slice(a, b)).join('\n')]));
// helper popularity → generic helpers are skipped (they are shared UI on both sides)
const pop = new Map();
for (const id of VIEW_IDS) for (const f of refsOf(viewBody.get(id))) pop.set(f, (pop.get(f) || 0) + 1);
const GENERIC = new Set([...pop].filter(([, n]) => n > 12).map(([f]) => f));
// global fan-in: utilities called from everywhere (upd, del, item, trk …) are not view content
const fanIn = new Map();
for (const [a, b] of scripts) for (const m of LEG.slice(a, b).matchAll(CALL_RE)) fanIn.set(m[1], (fanIn.get(m[1]) || 0) + 1);
for (const [f, n] of fanIn) if (n > 40 && FN.has(f)) GENERIC.add(f);
for (const g of ['renderTop', 'renderNav', 'logout', 'askConfirm', 'prog', 'auditLog', 'render', 'go', 'title', 'h', 'esc', 'toast', 'pdf', 'xlsx', 'fmt', 'money', 'firm', 'save', 'ph', 'csvDl', 'sheet']) GENERIC.add(g);

function legacyElements(id) {
  const body = viewBody.get(id);
  const seen = new Set();
  const texts = [['view', body]];
  let frontier = [...refsOf(body)].filter((f) => !GENERIC.has(f));
  for (let depth = 1; depth <= 2; depth++) {
    const next = [];
    for (const f of frontier) {
      if (seen.has(f)) continue; seen.add(f);
      // another view's render function is not this view's content
      if (VIEW_IDS.includes(f) && f !== id) continue;
      const t = fnText(f, id); if (!t) continue;
      texts.push([f, t]);
      if (depth < 2) for (const g of refsOf(t)) if (!GENERIC.has(g) && (pop.get(g) || 0) <= 12) next.push(g);
    }
    frontier = next;
  }
  const els = new Map();
  for (const [src, t] of texts) {
    for (const e of [...extract(t), ...extractTabs(src, t)]) {
      const n = norm(e.label);
      if (!n || JUNK.test(n) || tokens(n).length === 0) continue;
      if (n.length > 140) continue;
      if (e.kind === 'message' && RUNTIME_MSG.test(e.label)) continue;
      const kind = e.kind !== 'message' && EXPORT_RE.test(e.label) ? 'export' : e.kind === 'section' ? 'message' : e.kind;
      const key = kind + '|' + n;
      if (!els.has(key)) els.set(key, { kind, label: e.label.slice(0, 120), n, vars: variants(e.label, n), from: src });
    }
  }
  return { elements: [...els.values()], helpers: texts.map(([s]) => s) };
}

/* ───────────────────────── server side ───────────────────────── */
const APP = path.join(WEB, 'app/(app)');
const routeDirs = new Set(fs.readdirSync(APP, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('[')).map((d) => d.name));
const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : /\.(tsx?|mjs)$/.test(d.name) ? [path.join(dir, d.name)] : [])) : []);
const read = (f) => fs.readFileSync(f, 'utf8');
const EXCLUDE_IMPORT = /[\\/]lib[\\/]nav[^\\/]*\.ts$|[\\/]components[\\/](?:nav|top-bar|al-startup)\.tsx$|\.test\.tsx?$/;
function resolveImport(from, spec) {
  let base;
  if (spec.startsWith('@/')) base = path.join(WEB, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else if (spec.startsWith('@wise/core/')) base = path.join(CORE, spec.slice('@wise/core/'.length));
  else return null;
  for (const c of [base, base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}
const IMPORT_RE = /(?:import|export)\s[^;'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
function collectFiles(entries) {
  const out = new Set(); const q = entries.map((f) => [f, 0]);
  while (q.length) {
    const [f, d] = q.shift();
    if (out.has(f) || EXCLUDE_IMPORT.test(f)) continue;
    out.add(f);
    const inCore = f.startsWith(CORE);
    if (inCore && d > 1) continue;
    for (const m of read(f).matchAll(IMPORT_RE)) {
      const r = resolveImport(f, m[1] || m[2]);
      if (r) q.push([r, r.startsWith(CORE) ? (inCore ? d + 1 : 1) : d + 1]);
    }
  }
  return [...out];
}
/** redirect aliases: route X whose page only redirects to /Y */
const redirectTo = {};
for (const d of routeDirs) {
  const p = path.join(APP, d, 'page.tsx');
  if (!fs.existsSync(p)) continue;
  const t = read(p);
  const r = [...t.matchAll(/redirect\(\s*[`'"]\/([A-Za-z_]\w*)/g)].map((m) => m[1]).filter((x) => x !== 'login' && x !== d);
  if (r.length && t.length < 1500) redirectTo[d] = r[0];
}
const PLACEHOLDER_RE = /во изработка|сè уште се пренесува|се уште се пренесува|not ported|coming soon/i;
const LEGACY_ALIAS = { home: '' }; // legacy home → app/(app)/page.tsx
function serverFor(id) {
  let dir = id in LEGACY_ALIAS ? LEGACY_ALIAS[id] : routeDirs.has(id) ? id : null;
  if (dir === null) return null;
  const entries = [];
  const seenDirs = new Set();
  const addDir = (d) => {
    if (seenDirs.has(d)) return; seenDirs.add(d);
    if (d === '') entries.push(path.join(APP, 'page.tsx'));
    else entries.push(...walk(path.join(APP, d)));
    for (const extra of [path.join(WEB, 'app/(print)', d), path.join(WEB, 'app/print', d)]) if (d && fs.existsSync(extra)) entries.push(...walk(extra));
    if (redirectTo[d]) addDir(redirectTo[d]);
  };
  addDir(dir);
  // button-styled links to sibling routes (a feature moved to its own page, e.g. firmi → firmiImp)
  const linked = [];
  for (const f of [...entries]) for (const m of read(f).matchAll(/className=["'{][^>]*?\bbtn\b[^>]*?href=\{?\s*[`'"]\/([A-Za-z_]\w*)|href=\{?\s*[`'"]\/([A-Za-z_]\w*)[^>]*?className=["'{][^>]*?\bbtn\b/g)) {
    const t = m[1] || m[2];
    if (t && t !== dir && routeDirs.has(t) && !seenDirs.has(t) && (t.slice(0, 4) === dir.slice(0, 4) || !VIEW_SET.has(t))) { linked.push(t); seenDirs.add(t); entries.push(...walk(path.join(APP, t))); }
  }
  const files = collectFiles(entries);
  const page = dir === '' ? path.join(APP, 'page.tsx') : path.join(APP, dir, 'page.tsx');
  const pageText = fs.existsSync(page) ? read(page) : '';
  return { dir, files, linked, placeholder: PLACEHOLDER_RE.test(pageText) || (!fs.existsSync(page) && !files.length) };
}
/** per-file cache: normalised text + inverted index stem → line numbers */
const FCACHE = new Map();
function fileIdx(f) {
  if (FCACHE.has(f)) return FCACHE.get(f);
  const t = read(f).replace(/\{\s*['"`]\s*\}/g, ' ');
  let all = ' '; const inv = new Map(); let ln = 0;
  for (const line of t.split('\n')) {
    const n = norm(line); if (!n) continue;
    all += n + ' ';
    for (const w of new Set(tokens(n).map(stem))) { if (!inv.has(w)) inv.set(w, []); inv.get(w).push(ln); }
    ln++;
  }
  const r = { all, inv };
  FCACHE.set(f, r);
  return r;
}
const serverIndex = (files) => files.map(fileIdx);
function presentIn(el, fi) {
  const n = el.n;
  if (!n.includes('*')) { if (fi.all.includes(n)) return true; }
  else {
    const parts = n.split('*').map((x) => x.trim()).filter((x) => tokens(x).length);
    if (parts.length && parts.every((p) => fi.all.includes(p))) return true;
  }
  const tk = [...new Set(tokens(n).map(stem))];
  if (!tk.length) return true;
  const need = Math.ceil(tk.length * 0.8 - 1e-9);
  const cnt = new Map();
  for (const w of tk) for (const l of fi.inv.get(w) || []) { const c = (cnt.get(l) || 0) + 1; if (c >= need) return true; cnt.set(l, c); }
  return false;
}
function present(el, idx) {
  if (!tokens(el.n).length) return true;
  for (const v of el.vars || [el.n]) { const e2 = { ...el, n: v }; if (idx.some((fi) => presentIn(e2, fi))) return true; }
  // export synonyms: a page with a generic ⬇ PDF / ⬇ Excel export covers "PDF листа", "Excel" etc.
  if (el.kind === 'export') {
    const n = el.n;
    const fmt = n.match(/\b(pdf|excel|xlsx|csv|xml)\b/);
    const verb = /увоз|увези|import|прикачи/.test(n);
    const re = new RegExp(`\\b${fmt && fmt[1] === 'xlsx' ? 'excel' : fmt && fmt[1]}\\b`);
    if (fmt && !verb && tokens(n).length <= 3 && idx.some((fi) => re.test(fi.all))) return true;
  }
  return false;
}

/* global server index: where else does a label live? (feature moved to another page) */
// service messages (validation errors, notices) of packages/db and the worker reach the screen through the actions
const GLOBAL_FILES = [...walk(path.join(WEB, 'app')), ...walk(path.join(WEB, 'components')), ...walk(path.join(WEB, 'lib')), ...walk(CORE),
  ...walk(path.join(ROOT, 'packages/db/src')), ...walk(path.join(ROOT, 'apps/worker/src'))].filter((f) => !EXCLUDE_IMPORT.test(f));
function foundElsewhere(el) {
  // stricter than the per-route check: exact normalised text, or fuzzy only for labels of 3+ words
  for (const f of GLOBAL_FILES) {
    const fi = fileIdx(f);
    for (const v of el.vars || [el.n]) {
      const e2 = { ...el, n: v };
      const hit = tokens(v).length >= 3 || v.includes('*') ? presentIn(e2, fi) : fi.all.includes(' ' + v + ' ');
      if (hit) return path.relative(WEB, f).replace(/\\/g, '/');
    }
  }
  return null;
}

/* ───────────────────────── run parity ───────────────────────── */
const KIND_ORDER = ['export', 'button', 'tab', 'column', 'field', 'message'];
const results = [];
const noRoute = [];
const placeholders = [];
const legacyNav = new Map();
for (const m of LEG.matchAll(/\[\s*'([\w$]+)'\s*,\s*'([^'\n]{2,60})'\s*(?:,[^\]\n]*)?\]/g)) if (!legacyNav.has(m[1])) legacyNav.set(m[1], m[2]);

for (const id of VIEW_IDS) {
  if (ONLY && id !== ONLY) continue;
  const { elements, helpers } = legacyElements(id);
  const srv = serverFor(id);
  if (!srv) { noRoute.push({ id, label: legacyNav.get(id) || '', elements: elements.length }); continue; }
  if (srv.placeholder) placeholders.push({ id, label: legacyNav.get(id) || '', elements: elements.length });
  const idx = serverIndex(srv.files);
  const miss0 = elements.filter((e) => !present(e, idx));
  const moved = [];
  const missing = [];
  for (const e of miss0) { const w = foundElsewhere(e); if (w) moved.push({ kind: e.kind, label: e.label, where: w }); else missing.push(e); }
  results.push({
    id, label: legacyNav.get(id) || '', route: srv.dir === '' ? '/' : '/' + srv.dir, placeholder: srv.placeholder,
    linkedRoutes: srv.linked,
    serverFiles: srv.files.map((f) => path.relative(ROOT, f).replace(/\\/g, '/')),
    legacyHelpers: helpers.slice(1),
    found: elements.length, present: elements.length - miss0.length, moved: moved.length, missing: missing.length,
    missingCore: missing.filter((e) => e.kind !== 'message').length,
    movedList: moved,
    missingByKind: Object.fromEntries(KIND_ORDER.map((k) => [k, missing.filter((e) => e.kind === k).map((e) => e.label)]).filter(([, v]) => v.length)),
  });
}
results.sort((a, b) => b.missing - a.missing || a.id.localeCompare(b.id));
// catch-all placeholder views: in NAV on the server but no folder
for (const r of noRoute) r.catchAll = true;

/* ───────────────────────── technical sweep ───────────────────────── */
const ALL = walk(path.join(WEB, 'app')).concat(walk(path.join(WEB, 'components')), walk(path.join(WEB, 'lib'))).filter((f) => !/\.test\.tsx?$/.test(f));
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');
const lineOf = (t, i) => t.slice(0, i).split('\n').length;
const tech = { fnProps: [], nonNull: [], actionsNoCan: [], apiNoAuth: [], longForms: [], uploads: [], todos: [] };

/* ── function props passed from SERVER components to CLIENT components (runtime crash:
      "Functions cannot be passed directly to Client Components") ── */
{
  const directive = (t, d) => new RegExp(String.raw`^(?:\s|//[^\n]*\n|/\*[\s\S]*?\*/)*['"]use ${d}['"]`).test(t);
  const isClient = new Map(); const isServerMod = new Map();
  const txt = (f) => read(f);
  const cl = (f) => { if (!isClient.has(f)) isClient.set(f, directive(txt(f), 'client')); return isClient.get(f); };
  const sv = (f) => { if (!isServerMod.has(f)) isServerMod.set(f, directive(txt(f), 'server')); return isServerMod.get(f); };
  // server-rendered files: reachable from pages/layouts/templates/not-found through non-client imports
  const roots = walk(path.join(WEB, 'app')).filter((f) => /[\\/](?:page|layout|template|not-found|default)\.tsx$/.test(f));
  const server = new Set(); const q = [...roots];
  while (q.length) {
    const f = q.pop(); if (server.has(f) || cl(f) || !/\.tsx?$/.test(f) || f.startsWith(CORE)) continue;
    server.add(f);
    for (const m of txt(f).matchAll(IMPORT_RE)) { const r = resolveImport(f, m[1] || m[2]); if (r && r.startsWith(WEB)) q.push(r); }
  }
  const importsOf = (f, t) => {
    const map = new Map();
    for (const m of t.matchAll(/import\s+(?:type\s+)?([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g)) {
      if (/^type\b/.test(m[0].slice(7).trim())) continue;
      const r = resolveImport(f, m[2]); if (!r) continue;
      const spec = m[1];
      const def = spec.match(/^([A-Za-z_$][\w$]*)/); if (def) map.set(def[1], r);
      const named = spec.match(/\{([\s\S]*)\}/);
      if (named) for (const part of named[1].split(',')) { const p = part.trim().replace(/^type\s+/, ''); if (!p || /^type\s/.test(part.trim())) continue; const al = p.split(/\s+as\s+/); map.set((al[1] || al[0]).trim(), r); }
    }
    return map;
  };
  const exportsFn = (file, name) => {
    const t = txt(file);
    return new RegExp(String.raw`export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*${name}\b|export\s+const\s+${name}\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>`).test(t);
  };
  for (const f of server) {
    if (!f.endsWith('.tsx')) continue;
    const t = txt(f);
    const imp = importsOf(f, t);
    const clientTags = [...imp].filter(([, r]) => r.endsWith('.tsx') && cl(r)).map(([n]) => n);
    if (!clientTags.length) continue;
    const tagRe = new RegExp(String.raw`<(${clientTags.map((x) => x.replace(/\$/g, '\\$')).join('|')})(?=[\s/>])`, 'g');
    for (const m of t.matchAll(tagRe)) {
      let i = m.index + m[0].length; const hits = [];
      while (i < t.length) {
        while (/\s/.test(t[i])) i++;
        if (t[i] === '>' || (t[i] === '/' && t[i + 1] === '>')) break;
        if (t[i] === '{') { i = matchClose(t, i) + 1; continue; } // spread
        const an = t.slice(i, i + 80).match(/^[\w$:-]+/); if (!an) { i++; continue; }
        i += an[0].length;
        if (t[i] !== '=') continue;
        i++;
        if (t[i] === '"' || t[i] === "'") { i = skipStr(t, i); continue; }
        if (t[i] !== '{') continue;
        const e = matchClose(t, i); const val = t.slice(i + 1, e).trim(); i = e + 1;
        const isArrow = /^(?:async\s*)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=>/.test(val) || /^(?:async\s+)?function\b/.test(val);
        if (isArrow) { if (!/^[^{]*=>\s*\{\s*['"]use server['"]/.test(val)) hits.push(`${an[0]}={${val.slice(0, 50).replace(/\s+/g, ' ')}…}`); continue; }
        const id = val.match(/^[A-Za-z_$][\w$]*$/); if (!id) continue;
        const name = id[0];
        const src = imp.get(name);
        if (src) { if (!sv(src) && exportsFn(src, name)) hits.push(`${an[0]}={${name}} (function from ${path.relative(WEB, src).replace(/\\/g, '/')})`); continue; }
        const local = t.match(new RegExp(String.raw`(?:function\s+${name}\s*\(|const\s+${name}\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>)`));
        if (local && !/['"]use server['"]/.test(t.slice(local.index, local.index + 400))) hits.push(`${an[0]}={${name}} (local function)`);
      }
      // render-prop children: <Client …>{(x) => …}</Client>
      if (t[i] === '>' && /^>\s*\{\s*(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(t.slice(i, i + 200))) hits.push('children={(…) => …}');
      for (const h of hits) tech.fnProps.push({ file: rel(f), line: lineOf(t, m.index), tag: m[1], prop: h });
    }
  }
}

/** Body of a top-level function starting at i: up to the next column-0 "}" (or the next top-level declaration). */
const topBody = (t, i) => { const e = t.slice(i + 1).search(/\n\}|\n(?:export|async function|function|const) /); return t.slice(i, e < 0 ? Math.min(t.length, i + 4000) : i + 1 + e + 2); };

/* guard functions: requireCan / requireUser and every helper that (transitively) calls one, e.g. firmAction → requireCan */
const GUARD_CAN = new Set(['requireCan']);
const GUARD_USER = new Set(['requireUser', 'getUser']);
{
  const defs = [];
  for (const f of ALL) {
    const t = read(f);
    // top-level declarations only (column 0) — inner helpers would inherit the enclosing function's guard
    for (const m of t.matchAll(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^(]*>)?\s*\(|^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:cache\(\s*)?(?:async\s*)?(?:<[^(]*>)?\s*(?:\([^)]*\)|\w+)\s*(?::[^=]{0,80})?=>/gm)) {
      const body = topBody(t, m.index + m[0].length - 1).slice(0, 6000);
      defs.push([m[1] || m[2], [...body.matchAll(/\b(\w+)\s*\(/g)].map((x) => x[1])]);
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const [n, calls] of defs) {
      if (!GUARD_CAN.has(n) && calls.some((c) => GUARD_CAN.has(c))) { GUARD_CAN.add(n); changed = true; }
      if (!GUARD_USER.has(n) && calls.some((c) => GUARD_USER.has(c))) { GUARD_USER.add(n); changed = true; }
    }
  }
}

for (const f of ALL) {
  const t = read(f);
  const isPage = /[\\/]page\.tsx$/.test(f);
  // 1. non-null assertions on query results / firm without guard
  if (isPage || /[\\/](?:body|view|.*-page)\.tsx$/.test(f)) {
    for (const m of t.matchAll(/(\)\s*\)?\s*\[0\]\s*!|\.find\([^)]*\)\s*!|\b(?:firm|f|row|rows\[0\]|u\.firm|ctx\.firm)!\.|\(await [^;\n]{0,160}\)\s*!(?=[.;\[]))/g)) {
      tech.nonNull.push({ file: rel(f), line: lineOf(t, m.index), code: t.split('\n')[lineOf(t, m.index) - 1].trim().slice(0, 160) });
    }
    // X!.prop where X came from a query / await / .find() and is not guarded before
    for (const m of t.matchAll(/const\s+(?:\[\s*)?(\w+)(?:\s*\])?\s*(?::[^=]+)?=\s*(?:await\b|[^;\n]*\.find\()/g)) {
      const v = m[1]; const rest = t.slice(m.index + m[0].length);
      const use = rest.search(new RegExp(String.raw`\b${v}!\.`)); if (use < 0) continue;
      if (new RegExp(String.raw`if\s*\(\s*!\s*${v}\b|${v}\s*\?\?|!${v}\s*\)\s*(?:notFound|redirect|return|throw)`).test(rest.slice(0, use))) continue;
      const ln = lineOf(t, m.index + m[0].length + use);
      tech.nonNull.push({ file: rel(f), line: ln, code: t.split('\n')[ln - 1].trim().slice(0, 160) });
    }
    // const [x] = await … ; x.prop used with no guard
    for (const m of t.matchAll(/const\s+\[\s*(\w+)\s*\]\s*=\s*await\s[^;]+;/g)) {
      const v = m[1]; const after = t.slice(m.index + m[0].length, m.index + m[0].length + 3000);
      if (new RegExp(String.raw`\b${v}!\.`).test(after)) continue; // reported below as a non-null assertion
      const guarded = new RegExp(String.raw`if\s*\(\s*!?\s*${v}\b`).test(after) || new RegExp(String.raw`(?:if\s*\(\s*!\s*${v}\b|${v}\s*\?\.|${v}\s*\?\?|${v}\s*&&|!${v}\s*\)|${v}\s*\?\s|notFound|${v}\s*===?\s*undefined)`).test(after);
      if (!guarded && new RegExp(String.raw`\b${v}!?\.\w`).test(after)) tech.nonNull.push({ file: rel(f), line: lineOf(t, m.index), code: `const [${v}] = await … used without a guard` });
    }
  }
  // 2. server actions without requireCan
  if (/^\s*['"]use server['"]/m.test(t)) {
    for (const m of t.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(|export\s+const\s+(\w+)\s*=\s*async/g)) {
      const name = m[1] || m[2];
      const body = topBody(t, m.index + m[0].length - 1);
      const calls = [...body.matchAll(/\b(\w+)\s*\(/g)].map((x) => x[1]);
      if (calls.some((c) => GUARD_CAN.has(c))) continue;
      tech.actionsNoCan.push({ file: rel(f), fn: name, line: lineOf(t, m.index), has: calls.some((c) => GUARD_USER.has(c)) ? 'requireUser/officePage only (no permission check)' : 'NO auth call found' });
    }
  }
  // 3. API / route handlers without auth
  if (/[\\/]route\.tsx?$/.test(f)) {
    const calls = [...t.matchAll(/\b(\w+)\s*\(/g)].map((x) => x[1]);
    const auth = calls.some((c) => GUARD_CAN.has(c) || GUARD_USER.has(c)) || /SESSION_COOKIE|authorization|x-api-key|verify\w*\(|token|secret|destroySession/i.test(t);
    if (!auth) tech.apiNoAuth.push({ file: rel(f), methods: [...t.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/g)].map((x) => x[1]).join(',') });
  }
  // 4. forms whose submit comes after a long mapped list
  if (/\.tsx$/.test(f)) {
    for (const m of t.matchAll(/<form\b/g)) {
      const close = t.indexOf('</form>', m.index); if (close < 0) continue;
      const form = t.slice(m.index, close);
      const sub = form.search(/type=["']submit["']|<(?:SubmitButton|Submit|button)\b(?![^>]*type=["']button)/);
      const map = form.search(/\.map\(\s*\(?[\w{},\s]*\)?\s*=>\s*\(?\s*<(?:tr|label|li|div)\b/);
      if (map >= 0 && sub > map && (sub - map) > 600) tech.longForms.push({ file: rel(f), line: lineOf(t, m.index), note: 'submit button rendered after a mapped list (' + (form.length > 4000 ? 'large form' : 'form') + ')' });
    }
  }
  // 5. upload paths
  if (/type=["']file["']|as File\b|instanceof File|\.arrayBuffer\(\)|presign|PutObject|putObject|upload/i.test(t) && !/[\\/]lib[\\/]nav/.test(f)) {
    const hits = [];
    if (/type=["']file["']/.test(t)) hits.push('file input');
    if (/as File\b|instanceof File/.test(t)) hits.push('reads File from FormData');
    if (/presign/i.test(t)) hits.push('presigned URL');
    if (/PutObject|putObject|storage\.\w*put/i.test(t)) hits.push('stores object');
    if (hits.length) {
      const sizeCheck = /\.size\s*[<>]|maxSize|MAX_\w*(?:SIZE|BYTES)|ContentLength|content-length/i.test(t);
      const typeCheck = /accept=|\.type\b|mime|contentType|ContentType/i.test(t);
      tech.uploads.push({ file: rel(f), what: hits.join(', '), sizeCheck, typeCheck });
    }
  }
  // 6. TODO / FIXME / во изработка
  for (const m of t.matchAll(/\b(TODO|FIXME|XXX|HACK)\b|во изработка|сè уште се пренесува/g)) {
    const ln = lineOf(t, m.index);
    tech.todos.push({ file: rel(f), line: ln, text: t.split('\n')[ln - 1].trim().slice(0, 140) });
  }
}

/* ───────────────────────── report ───────────────────────── */
const LIMITATIONS = `- **Static text matching, not behaviour.** A label counts as present when its normalised text (lower-case, no emoji/punctuation, \`\${…}\` → \`*\`) occurs in the route's files or anything they import (apps/web transitively, \`@wise/core/<sub>\` two levels; \`lib/nav*.ts\` excluded because it lists every menu label), or when ≥ 80 % of its words (5-letter stems) appear on one source line, or when one wording variant matches (text without "(…)" hints / shortcut keys, or one side of " / ", " – ", " · "). A present label does not prove the feature works.
- **Legacy extraction** reads every \`VIEWS.<id>=\` / \`VIEWS['id']=\` / \`[ids].forEach(v=>VIEWS[v]=…)\` / \`CONST.forEach(([id])=>VIEWS[id]=…)\` definition, keeps the LAST one plus the earlier ones it wraps (\`const _x=VIEWS.id … _x(m)\`), and follows helper calls and \`data-act\`/\`data-go\` handlers two levels deep. Helpers used by > 12 views or called > 40 times are treated as generic and skipped; per-view maps (\`LAGER={g_lager:{…},m_lager:{…}}\`) are cut to the view's own entry. Some helper text that legacy shows only in a branch (admin-only, demo firm, offline) is still counted.
- **Moved vs missing.** A label not in the route but found verbatim in another server file (apps/web, packages/core, and the service messages of packages/db and apps/worker) is listed as _moved / elsewhere_ and not counted as missing. It may still be a real gap if legacy showed it on this screen.
- **Messages** (toasts, callouts, empty-state texts) are the noisiest kind: the server validates with \`required\` inputs / different wording, and runtime-only browser messages (library loading, Firestore, "не е достапно во овој приказ") are filtered out. Treat message gaps as hints.
- Generic dialog buttons (Откажи, Затвори, Излез, Зачувај, Избриши, Измени, Отвори, keyboard-shortcut variants) are ignored.
- **Server-side "present" can be over-generous** because shared components (sales editors, stock editors) carry the labels of several views.
- Views without a folder fall back to the \`[view]\` catch-all placeholder; \`home\` maps to \`app/(app)/page.tsx\`; pages that only \`redirect('/x')\` are merged with \`/x\`; button-styled links to sub-pages (same 4-letter prefix, or a route that is not a legacy view) are merged in.
- **Estimated false-positive rate** (hand check of 15 random non-message gaps + 40 random gaps overall): about 15–25 % for buttons/columns/fields/exports, about 40 % for messages.
- The technical sweep is regex-based: it points at places to look, not proven bugs.`;
if (ONLY) { console.log(JSON.stringify(results[0] || noRoute[0], null, 2)); process.exit(0); }
const OUT = path.join(ROOT, 'docs/parity');
fs.mkdirSync(OUT, { recursive: true });
const totals = results.reduce((a, r) => ({ found: a.found + r.found, missing: a.missing + r.missing }), { found: 0, missing: 0 });
const json = { generated: new Date().toISOString(), legacyViews: VIEW_IDS.length, totals, views: results, noRoute, placeholders, tech };
fs.writeFileSync(path.join(OUT, 'auto-check.json'), JSON.stringify(json, null, 1));

const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const KN = { export: 'export/import/pdf', button: 'button', tab: 'tab', column: 'column', field: 'field', message: 'message' };
let md = `# Automated parity check (legacy ↔ server)

Generated by \`node tools/parity-check/check.mjs\` on ${json.generated.slice(0, 10)}. Re-run after every port; the JSON twin is \`auto-check.json\`.

**${VIEW_IDS.length} legacy views**, ${results.length} with a server route, ${noRoute.length} without one, ${placeholders.length} placeholders.
Legacy elements checked: ${totals.found}; reported missing: ${totals.missing}.

## How it works / known limitations

${LIMITATIONS}

## Summary (sorted by missing elements)

"Present" = found in the route's own files (and what they import). "Moved" = not in the route, but the exact text exists in another server file (feature probably lives on another page — verify). "Missing" = nowhere on the server.

| View | Legacy label | Route | Found | Present | Moved | Missing | export | button | tab | column | field | message |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
`;
for (const r of results) {
  const c = (k) => (r.missingByKind[k] || []).length || '';
  md += `| [${r.id}](#${r.id.toLowerCase()}) | ${esc(r.label)} | \`${r.route}\`${r.placeholder ? ' ⚠ placeholder' : ''} | ${r.found} | ${r.present} | ${r.moved} | **${r.missing}** | ${c('export')} | ${c('button')} | ${c('tab')} | ${c('column')} | ${c('field')} | ${c('message')} |\n`;
}
md += `\n## Legacy views with NO server route (${noRoute.length})\n\nThese ids have a legacy \`VIEWS.<id>\` but no \`apps/web/app/(app)/<id>\` folder (a NAV entry, if any, falls into the \`[view]\` "сè уште се пренесува" placeholder).\n\n| View | Legacy label | Legacy elements |\n|---|---|---:|\n`;
for (const r of noRoute.sort((a, b) => b.elements - a.elements)) md += `| ${r.id} | ${esc(r.label)} | ${r.elements} |\n`;
md += `\n## Server routes that render only a placeholder (${placeholders.length})\n\n`;
md += placeholders.length ? placeholders.map((p) => `- \`${p.id}\` ${esc(p.label)} (${p.elements} legacy elements)`).join('\n') + '\n' : '_none_\n';

md += `\n## Technical sweep (static, heuristic)\n\n### Function props passed from a server component to a client component (${tech.fnProps.length})\n\nThese crash at runtime with \"Functions cannot be passed directly to Client Components\". Server-rendered files = everything reachable from app/**/page|layout.tsx through imports that are not 'use client'; a prop is flagged when its value is an inline arrow/function, a local non-'use server' function, or a function exported by a non-'use server' module.\n\n` + (tech.fnProps.map((x) => `- \`${x.file}:${x.line}\` <${x.tag}> ${esc(x.prop)}`).join('\n') || '_none_') + '\n';
md += `\n### Pages that may throw on missing firm / empty data (${tech.nonNull.length})\n\nNon-null assertions on query results or destructured \`await\` results used without a guard.\n\n`;
md += tech.nonNull.map((x) => `- \`${x.file}:${x.line}\` — \`${esc(x.code)}\``).join('\n') + '\n';
md += `\n### Server actions without \`requireCan\` (${tech.actionsNoCan.length})\n\n`;
md += tech.actionsNoCan.map((x) => `- \`${x.file}:${x.line}\` **${x.fn}** — ${x.has}`).join('\n') + '\n';
md += `\n### Route handlers without an auth check (${tech.apiNoAuth.length})\n\n`;
md += (tech.apiNoAuth.map((x) => `- \`${x.file}\` (${x.methods || '?'})`).join('\n') || '_none_') + '\n';
md += `\n### Forms whose submit button sits after a long mapped list (${tech.longForms.length})\n\n`;
md += (tech.longForms.map((x) => `- \`${x.file}:${x.line}\` — ${x.note}`).join('\n') || '_none_') + '\n';
md += `\n### File upload paths (${tech.uploads.length})\n\n| File | What | size check | type check |\n|---|---|---|---|\n`;
md += tech.uploads.map((x) => `| \`${x.file}\` | ${x.what} | ${x.sizeCheck ? 'yes' : '**no**'} | ${x.typeCheck ? 'yes' : '**no**'} |`).join('\n') + '\n';
md += `\n### TODO / FIXME / "во изработка" left in apps/web (${tech.todos.length})\n\n`;
md += (tech.todos.map((x) => `- \`${x.file}:${x.line}\` — ${esc(x.text)}`).join('\n') || '_none_') + '\n';

md += `\n## Per view\n`;
for (const r of results) {
  md += `\n### ${r.id}\n\n${esc(r.label)} — route \`${r.route}\`${r.placeholder ? ' (**placeholder**)' : ''} — ${r.found} legacy elements, ${r.present} present, **${r.missing} missing**.\n`;
  if (r.legacyHelpers.length) md += `\n<sub>legacy helpers followed: ${r.legacyHelpers.slice(0, 25).join(', ')}${r.legacyHelpers.length > 25 ? ' …' : ''}</sub>\n`;
  for (const k of KIND_ORDER) {
    const L = r.missingByKind[k]; if (!L) continue;
    md += `\n- **${KN[k]}** (${L.length}): ${L.map((x) => '`' + esc(x).replace(/`/g, "'") + '`').join(', ')}\n`;
  }
  if (r.movedList.length) md += `\n- _moved / elsewhere_ (${r.movedList.length}): ${r.movedList.map((x) => '`' + esc(x.label).replace(/`/g, "'") + '` → ' + x.where).join(', ')}\n`;
}
fs.writeFileSync(path.join(OUT, 'AUTO-CHECK.md'), md);
console.log(`views ${VIEW_IDS.length}, routed ${results.length}, no route ${noRoute.length}, placeholders ${placeholders.length}, elements ${totals.found}, missing ${totals.missing}`);
console.log('top:', results.slice(0, 15).map((r) => `${r.id}:${r.missing}/${r.found}`).join(' '));
console.log('tech:', Object.fromEntries(Object.entries(tech).map(([k, v]) => [k, v.length])));
