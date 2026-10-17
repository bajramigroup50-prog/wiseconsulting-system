/**
 * Shared partner (комитент) matching for documents read from outside — scanned / AI-read invoices, imported journals,
 * bank statements. One helper so every import recognises „ЈУ од Областа на Здр. за потребите на ЈЗУ …“ as the
 * partner „ЈУ ОД ОБЛАСТА НА ЗДРАВ.ЗА ПОТРЕБА НА ЈЗУ“ (or the old program's Latin „JU OD OBLASTA NA ZDRAV.ZA …“).
 *
 * - Identifiers: the number read from the document is classified — 13 digits (optionally „MK“) = ЕДБ, 7 digits =
 *   ЕМБС, 15 digits / IBAN = bank account — and matched on the partner's ЕДБ, ЕМБС, accounts (`data.accounts`) and
 *   learned identifiers (`data.aliasIds`).
 * - Names: Latin ↔ Cyrillic (with the old-font YUSCII characters, {@link translitKey}), case, punctuation, legal-form
 *   words (ДООЕЛ, ДОО, АД, ЈУ, ЈЗУ…), stop words („за“, „на“, „од“) and generic business words (трговија, увоз-извоз,
 *   Скопје…) are ignored; abbreviations match by prefix („Здр.“ ↔ „ЗДРАВ“), inflections by a long common prefix
 *   („потребите“ ↔ „ПОТРЕБА“); the score is a token-overlap similarity, with a bonus for a name cut short at the end
 *   (the old program's field length).
 * - Learned names: `data.aliases` (names under which the partner appeared on documents).
 *
 * Pure: the caller passes the partners.
 */
import { accountKey } from '../bank/mk-banks';
import { partnerAccounts } from '../bank/partner-accounts';
import { fixYusciiAll, translitKey } from '../text/yuscii';

/* ------------------------------------------------------------------ identifiers */

export type PartnerIdKind = 'edb' | 'embs' | 'bank' | '';
export interface PartnerId {
  kind: PartnerIdKind;
  /** ЕДБ: the 13 digits; ЕМБС: the 7 digits; bank: the account key (15 digits or IBAN); '' kind: the digits read. */
  value: string;
  /** For saving on the partner: ЕДБ with its „MK“ prefix when the document had one. */
  store: string;
}

/** Label of an identifier kind for the user. */
export const partnerIdLabel = (k: PartnerIdKind): string => (k === 'edb' ? 'ЕДБ' : k === 'embs' ? 'ЕМБС' : k === 'bank' ? 'сметка' : 'број');

/** Classify the tax / registration number read from a document: 13 digits (MK…) ЕДБ, 7 digits ЕМБС, 15 digits / IBAN bank account. */
export function classifyPartnerId(raw: unknown): PartnerId {
  const s = String(raw ?? '').toUpperCase().replace(/[\s./-]/g, '');
  if (!s) return { kind: '', value: '', store: '' };
  const m = /^(MK)?(\d{13})$/.exec(s);
  if (m) return { kind: 'edb', value: m[2]!, store: (m[1] ?? '') + m[2]! };
  if (/^\d{7}$/.test(s)) return { kind: 'embs', value: s, store: s };
  const acc = accountKey(s);
  if (acc) return { kind: 'bank', value: acc, store: acc };
  if (/^\d{15}$/.test(s)) return { kind: 'bank', value: s, store: s };
  const d = s.replace(/\D/g, '');
  return { kind: '', value: d, store: d };
}

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/* ------------------------------------------------------------------ names */

/** Legal-form words (Latin key form, both scripts transliterate to it). */
const LEGAL = new Set([
  'dooel', 'doo', 'ad', 'jtd', 'tp', 'kd', 'jp', 'ju', 'jzu', 'zu', 'pzu', 'phi', 'ou', 'sou', 'oou', 'dptu', 'dpu', 'dptpu', 'dppu', 'dpptu', 'dtu',
  'ltd', 'llc', 'gmbh', 'ag', 'kg', 'inc', 'corp', 'co', 'sa', 'srl', 'spa', 'bv', 'nv', 'shpk', 'shpkp', 'sh', 'dshpk', 'doob', 'dd', 'ood', 'eood', 'ooo',
  'zdruzhenie', 'fondacija', 'agencija', 'ustanova', 'javna', 'javno', 'pretprijatie', 'drzhavno', 'trgovec', 'poedinec', 'tpd',
]);
/** Stop words. */
const STOP = new Set(['za', 'na', 'od', 'i', 'vo', 'so', 'ili', 'do', 'po', 'pri', 'kaj', 'the', 'of', 'and', 'und', 'et', 'e', 'a', 'dhe', 'per', 'te', 'ne']);
/** Cities: not part of the name, but two names in different cities are different partners. */
const CITY = new Set([
  'skopje', 'bitola', 'kumanovo', 'tetovo', 'ohrid', 'prilep', 'shtip', 'veles', 'strumica', 'gostivar', 'kochani', 'kavadarci', 'struga', 'kichevo',
  'gevgelija', 'negotino', 'radovish', 'debar', 'resen', 'vinica', 'delchevo', 'berovo', 'kratovo', 'probishtip', 'valandovo', 'kriva', 'palanka',
  'sveti', 'nikole', 'makedonski', 'brod', 'demir', 'hisar', 'kapija', 'bogdanci', 'dojran', 'krushevo', 'ilinden', 'aerodrom', 'karposh', 'chair',
  'gazi', 'baba', 'kisela', 'voda', 'butel', 'gjorche', 'petrov', 'saraj', 'shuto', 'orizari', 'kavadarci',
]);
/** Generic business words: ignored unless the name has nothing else. */
const WEAK = new Set([
  'makedonija', 'macedonia', 'mk', 'rsm', 'uvoz', 'izvoz', 'uvozizvoz', 'eksport', 'import', 'export', 'eksportimport', 'trgovsko', 'trgovija', 'trgovski',
  'drushtvo', 'proizvodstvo', 'proizvodno', 'proizvoditel', 'uslugi', 'uslugovno', 'promet', 'trejd', 'trade', 'trading', 'kompani', 'kompanija',
  'company', 'grupa', 'group', 'internacional', 'international', 'filijala', 'podruzhnica', 'centrala', 'sektor', 'kompanii',
]);

function rawTokens(name: unknown): string[] {
  const raw = fixYusciiAll(String(name ?? '')).split(/[^\p{L}\p{N}]+/u).map((w) => translitKey(w)).filter(Boolean);
  // join runs of single letters („d o o e l“ → „dooel“); a single letter alone („О.“ = „Областа“) stays
  const T: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i]!.length === 1 && /[a-z]/.test(raw[i]!)) {
      let j = i, w = '';
      while (j < raw.length && raw[j]!.length === 1 && /[a-z]/.test(raw[j]!)) w += raw[j++]!;
      if (w.length > 1) { T.push(w); i = j - 1; continue; }
    }
    T.push(raw[i]!);
  }
  return T;
}

/**
 * Name → matching tokens (Latin key form): YUSCII repaired, both scripts transliterated, legal / stop / generic words
 * and cities dropped; dotted letters („Д.О.О.Е.Л.“) joined back into one word.
 */
export function nameTokens(name: unknown): string[] {
  const T = rawTokens(name);
  const base = T.filter((t) => !LEGAL.has(t) && !STOP.has(t));
  const strong = base.filter((t) => !WEAK.has(t) && !CITY.has(t));
  return strong.length ? strong : base.length ? base : T;
}
/** Cities named in the name. */
export const nameCities = (name: unknown): string[] => [...new Set(rawTokens(name).filter((t) => CITY.has(t)))];

/** Spelling-independent key of a whole name (equal keys = the same name). */
export const nameKey = (name: unknown): string => nameTokens(name).join(' ');

function lev1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++e > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return e + (a.length - i) + (b.length - j) <= 1;
}

/** Macedonian endings (article / plural / case) cut off to compare stems („потребите“, „потреба“ → „potreb“). */
const ENDS = ['ite', 'ata', 'ovi', 'ot', 'ta', 'to', 'te', 'ov', 'a', 'i', 'e', 'o'];
export function stem(t: string): string {
  for (const e of ENDS) if (t.length - e.length >= 4 && t.endsWith(e)) return t.slice(0, -e.length);
  return t;
}

/**
 * Similarity of two tokens: 1 equal, 0.9 abbreviation („здр“ ↔ „здрав“), 0.85 same stem / one typo, 0.8 a typo in
 * the stem („потрбите“ ↔ „потреба“) or a long common prefix, 0.6 a one- or two-letter abbreviation („о“ ↔ „областа“).
 */
export function tokenSim(a: string, b: string): number {
  if (a === b) return 1;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (/^\d+$/.test(s) || /^\d+$/.test(l)) return 0;
  if (s.length < 3) return l.startsWith(s) ? 0.6 : 0;
  if (l.startsWith(s)) return 0.9;
  if (s.length >= 5 && lev1(s, l)) return 0.85;
  const ss = stem(s), sl = stem(l);
  if (ss === sl) return 0.85;
  if (ss.length >= 5 && sl.length >= 5 && lev1(ss, sl)) return 0.8;
  let cp = 0;
  while (cp < s.length && s[cp] === l[cp]) cp++;
  if (cp >= 4 && s.length >= 5 && cp >= 0.7 * s.length) return 0.8;
  return 0;
}

/** Name similarity 0–1 of token lists (see {@link nameTokens}). */
export function tokenScore(A: readonly string[], B: readonly string[]): number {
  if (!A.length || !B.length) return 0;
  if (A.join(' ') === B.join(' ')) return 1;
  const [S, L] = A.length <= B.length ? [A, B] : [B, A];
  const used = new Set<number>();
  let w = 0, m = 0, strong = 0, prefix = true;
  for (let i = 0; i < S.length; i++) {
    let best = 0, at = -1;
    for (let j = 0; j < L.length; j++) {
      if (used.has(j)) continue;
      const v = tokenSim(S[i]!, L[j]!);
      if (v > best || (v === best && v > 0 && j === i)) { best = v; at = j; }
    }
    if (at < 0) { prefix = false; continue; }
    used.add(at); w += best; m++;
    if (best >= 0.8) strong++;
    if (at !== i) prefix = false;
  }
  if (!m || !strong) return 0;
  const cover = w / S.length, dice = (2 * w) / (S.length + L.length);
  let sc = 0.55 * cover + 0.45 * dice;
  // the shorter name is the start of the longer one (cut short / the rest left out)
  if (prefix && strong >= 2) sc = Math.max(sc, 0.6 + 0.35 * cover);
  if (strong === 1 && L.length > 1) sc = Math.min(sc, prefix && S.length === 1 && S[0]!.length >= 4 ? 0.7 : 0.55);
  return Math.round(sc * 1000) / 1000;
}

/** Tokens and cities of a name, computed once. */
export interface NameSig { t: string[]; c: string[] }
export const nameSig = (name: unknown): NameSig => ({ t: nameTokens(name), c: nameCities(name) });
/** Name similarity of two signatures: names in different cities count half. */
export function sigScore(a: NameSig, b: NameSig): number {
  const s = tokenScore(a.t, b.t);
  return a.c.length && b.c.length && !a.c.some((c) => b.c.includes(c)) ? Math.round(s * 500) / 1000 : s;
}

/** Name similarity 0–1. */
export const nameScore = (a: unknown, b: unknown): number => sigScore(nameSig(a), nameSig(b));

/* ------------------------------------------------------------------ partner match */

export interface MatchablePartnerRow {
  id: string; name: string; code?: string | null; edb?: string | null; embs?: string | null;
  bankAccount?: string | null; bankName?: string | null; data?: Record<string, unknown> | null;
}
export interface PartnerCandidate { id: string; name: string; code: string; edb: string; embs: string; score: number }
export type PartnerMatchBy = 'edb' | 'embs' | 'bank' | 'alias' | 'exact' | 'name' | '';
export interface PartnerMatch<P> {
  partner: P | null;
  by: PartnerMatchBy;
  score: number;
  /** Uncertain name candidates (up to 3) when nothing was selected. */
  candidates: PartnerCandidate[];
  /** The document's identifier, classified. */
  id: PartnerId;
}
export interface PartnerDoc { name?: string | null; id?: string | null; bankAccount?: string | null }

/** Thresholds: one candidate at {@link AUTO_SCORE} or more (and {@link AUTO_MARGIN} above the next) is selected. */
export const AUTO_SCORE = 0.85;
export const AUTO_MARGIN = 0.15;
/** Weaker than this is no candidate (a new partner is better). */
export const ASK_SCORE = 0.6;

const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
/** Names the partner was learned under (`data.aliases`). */
export const partnerAliases = (p: { data?: Record<string, unknown> | null }) => strArr(p.data?.aliases);
/** Identifiers learned for the partner (`data.aliasIds`: digits / account keys). */
export const partnerAliasIds = (p: { data?: Record<string, unknown> | null }) => strArr(p.data?.aliasIds);

const candOf = (p: MatchablePartnerRow, score: number): PartnerCandidate =>
  ({ id: p.id, name: p.name, code: String(p.code ?? ''), edb: String(p.edb ?? ''), embs: String(p.embs ?? ''), score });

/** Partner with this identifier (ЕДБ / ЕМБС / bank account), or null. */
export function partnerById<P extends MatchablePartnerRow>(partners: readonly P[], id: PartnerId): { p: P; by: PartnerMatchBy } | null {
  if (!id.value) return null;
  const learned = (p: P) => partnerAliasIds(p).includes(id.value);
  if (id.kind === 'edb') {
    const x = partners.find((p) => digits(p.edb) === id.value) ?? partners.find(learned);
    return x ? { p: x, by: 'edb' } : null;
  }
  if (id.kind === 'embs') {
    // a ЕМБС typed into the ЕДБ field is still the ЕМБС
    const x = partners.find((p) => digits(p.embs) === id.value) ?? partners.find((p) => digits(p.edb) === id.value) ?? partners.find(learned);
    return x ? { p: x, by: 'embs' } : null;
  }
  if (id.kind === 'bank') {
    const x = partners.find((p) => partnerAccounts(p).some((a) => accountKey(a.acc) === id.value || accountKey(a.iban) === id.value)) ?? partners.find(learned);
    return x ? { p: x, by: 'bank' } : null;
  }
  return null;
}

/**
 * Find the partner of a read document: ЕДБ → ЕМБС → bank account → learned name → same name → similar name.
 * A similar name is selected only when it is the one clear candidate; otherwise `candidates` lists up to 3.
 */
export function findPartnerMatch<P extends MatchablePartnerRow>(partners: readonly P[], doc: PartnerDoc, o: { fuzzy?: boolean } = {}): PartnerMatch<P> {
  const id = classifyPartnerId(doc.id);
  const none: PartnerMatch<P> = { partner: null, by: '', score: 0, candidates: [], id };
  const hit = partnerById(partners, id);
  if (hit) return { ...none, partner: hit.p, by: hit.by, score: 1 };
  if (doc.bankAccount) {
    const b = classifyPartnerId(doc.bankAccount);
    const h = b.kind === 'bank' ? partnerById(partners, b) : null;
    if (h) return { ...none, partner: h.p, by: 'bank', score: 1 };
  }
  const T = nameSig(doc.name);
  if (!T.t.length) return none;
  const key = T.t.join(' ');
  const lower = String(doc.name ?? '').trim().toLowerCase();
  // a partner with another ЕДБ / ЕМБС than the document's is another legal entity, whatever its name
  const P = partners.filter((p) => !idConflict(p, id));
  const al = P.filter((p) => partnerAliases(p).some((a) => a.trim().toLowerCase() === lower || nameKey(a) === key));
  if (al.length === 1) return { ...none, partner: al[0]!, by: 'alias', score: 1 };
  const scored = P.map((p) => ({ p, s: Math.max(sigScore(T, nameSig(p.name)), ...partnerAliases(p).map((a) => sigScore(T, nameSig(a)))) }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  const exact = scored.filter((x) => x.s === 1);
  if (exact.length === 1) return { ...none, partner: exact[0]!.p, by: 'exact', score: 1 };
  if (o.fuzzy === false) return none;
  const [a, b] = scored;
  if (a && !exact.length && a.s >= AUTO_SCORE && (!b || a.s - b.s >= AUTO_MARGIN)) return { ...none, partner: a.p, by: 'name', score: a.s };
  return { ...none, candidates: scored.filter((x) => x.s >= ASK_SCORE).slice(0, 3).map((x) => candOf(x.p, x.s)) };
}

/** The partner has its own ЕДБ / ЕМБС and it is not the document's. */
function idConflict(p: MatchablePartnerRow, id: PartnerId): boolean {
  if (id.kind === 'edb') { const e = digits(p.edb); return e.length === 13 && e !== id.value; }
  if (id.kind === 'embs') { const e = digits(p.embs); return e.length === 7 && e !== id.value && digits(p.edb) !== id.value; }
  return false;
}

/* ------------------------------------------------------------------ duplicates */

export interface DupMember { id: string; score: number; sameId: boolean }
export interface PartnerDupGroup {
  /** Suggested main partner (with ЕДБ / ЕМБС, then more movements, then the older code). */
  main: string;
  members: DupMember[];
  /** Every member is the same identifier or at least {@link SURE_SCORE} similar to the main one. */
  sure: boolean;
}
/** Names at least this similar are listed as duplicates. */
export const DUP_SCORE = 0.85;
/** „Спои ги сите сигурни“: the same identifier or at least this similar. */
export const SURE_SCORE = 0.9;

const idsOf = (p: MatchablePartnerRow) => ({ edb: digits(p.edb).length === 13 ? digits(p.edb) : '', embs: digits(p.embs).length === 7 ? digits(p.embs) : digits(p.edb).length === 7 ? digits(p.edb) : '' });
const sameIdent = (a: MatchablePartnerRow, b: MatchablePartnerRow) => {
  const x = idsOf(a), y = idsOf(b);
  return (!!x.edb && x.edb === y.edb) || (!!x.embs && x.embs === y.embs);
};
/** Both have an ЕДБ (or both an ЕМБС) and they differ: different legal entities. */
const diffIdent = (a: MatchablePartnerRow, b: MatchablePartnerRow) => {
  const x = idsOf(a), y = idsOf(b);
  return (!!x.edb && !!y.edb && x.edb !== y.edb) || (!!x.embs && !!y.embs && x.embs !== y.embs);
};

/**
 * Groups of likely duplicate partners of one firm: the same ЕДБ / ЕМБС, or names at least {@link DUP_SCORE} similar
 * (never two partners with different ЕДБ / ЕМБС). `moves` = number of movements per partner (for the main one).
 */
export function partnerDuplicates(partners: readonly MatchablePartnerRow[], moves: ReadonlyMap<string, number> = new Map()): PartnerDupGroup[] {
  const P = partners.filter((p) => p.name || p.edb || p.embs);
  const S = P.map((p) => [nameSig(p.name), ...partnerAliases(p).map(nameSig)]);
  const parent = P.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const join = (i: number, j: number) => { const a = find(i), b = find(j); if (a !== b) parent[b] = a; };
  // the same identifier
  const byId = new Map<string, number>();
  P.forEach((p, i) => { const x = idsOf(p); for (const k of [x.edb && 'e' + x.edb, x.embs && 'm' + x.embs]) if (k) { const j = byId.get(k); if (j === undefined) byId.set(k, i); else join(j, i); } });
  // similar names: compared only within blocks of a shared token start
  const blocks = new Map<string, number[]>();
  S.forEach((sigs, i) => { for (const k of new Set(sigs.flatMap((g) => g.t.filter((t) => t.length >= 3).map((t) => t.slice(0, 3))))) { const L = blocks.get(k) ?? []; L.push(i); blocks.set(k, L); } });
  const sc = new Map<string, number>();
  const pairScore = (i: number, j: number) => {
    const k = i < j ? i + ':' + j : j + ':' + i;
    let v = sc.get(k);
    if (v === undefined) { v = diffIdent(P[i]!, P[j]!) ? 0 : Math.max(...S[i]!.flatMap((a) => S[j]!.map((b) => sigScore(a, b)))); sc.set(k, v); }
    return v;
  };
  for (const L of blocks.values()) {
    if (L.length > 400) continue;
    for (let a = 0; a < L.length; a++) for (let b = a + 1; b < L.length; b++) if (pairScore(L[a]!, L[b]!) >= DUP_SCORE) join(L[a]!, L[b]!);
  }
  const G = new Map<number, number[]>();
  P.forEach((_, i) => { const r = find(i); G.set(r, [...(G.get(r) ?? []), i]); });
  const codeN = (p: MatchablePartnerRow) => { const c = String(p.code ?? '').trim(); return /^\d+$/.test(c) ? +c : Number.MAX_SAFE_INTEGER; };
  const out: PartnerDupGroup[] = [];
  for (const I of G.values()) {
    if (I.length < 2) continue;
    const rank = [...I].sort((a, b) => {
      const pa = P[a]!, pb = P[b]!;
      const ia = +!!(idsOf(pa).edb || idsOf(pa).embs), ib = +!!(idsOf(pb).edb || idsOf(pb).embs);
      return ib - ia || (moves.get(pb.id) ?? 0) - (moves.get(pa.id) ?? 0) || codeN(pa) - codeN(pb) || pa.name.localeCompare(pb.name);
    });
    const m = rank[0]!;
    const members = rank.map((i) => { const same = i === m || sameIdent(P[i]!, P[m]!); return { id: P[i]!.id, sameId: same, score: i === m ? 1 : same ? 1 : pairScore(i, m) }; });
    out.push({ main: P[m]!.id, members, sure: members.every((x) => x.sameId || x.score >= SURE_SCORE) && !members.some((x, k) => k && diffIdent(P[rank[k]!]!, P[m]!)) });
  }
  return out.sort((a, b) => +b.sure - +a.sure || b.members.length - a.members.length);
}

/** Main partner after a merge: missing ЕДБ, ЕМБС, address, city… filled from the merged ones; their names kept as aliases. */
export function mergedPartnerFields<P extends MatchablePartnerRow & { address?: string | null; city?: string | null; email?: string | null; phone?: string | null }>(main: P, others: readonly P[]) {
  const pick = (k: 'edb' | 'embs' | 'address' | 'city' | 'email' | 'phone') => (String(main[k] ?? '').trim() ? main[k] ?? null : others.map((o) => o[k]).find((v) => String(v ?? '').trim()) ?? null);
  const aliases = [...new Set([...partnerAliases(main), ...others.flatMap((o) => [o.name, ...partnerAliases(o)])])]
    .filter((a) => a.trim() && nameKey(a) !== nameKey(main.name)).slice(-50);
  const mainIds = idsOf(main);
  const aliasIds = [...new Set([...partnerAliasIds(main), ...others.flatMap((o) => { const x = idsOf(o); return [x.edb, x.embs, ...partnerAliasIds(o)]; })])]
    .filter((v) => v && v !== mainIds.edb && v !== mainIds.embs && v !== digits(pick('edb')) && v !== digits(pick('embs')));
  return { edb: pick('edb'), embs: pick('embs'), address: pick('address'), city: pick('city'), email: pick('email'), phone: pick('phone'), aliases, aliasIds };
}

/* ------------------------------------------------------------------ learning */

export interface LearnResult {
  data: Record<string, unknown>;
  changed: boolean;
  /** The document's ЕДБ / ЕМБС the partner does not have yet (offer to save it on the partner). */
  saveId?: { kind: 'edb' | 'embs'; value: string };
}

/**
 * The user linked a document to this partner: remember the document's name (`data.aliases`) and an identifier that
 * differs from the partner's own (`data.aliasIds`), so the next document matches at once.
 */
export function learnPartnerAlias(p: MatchablePartnerRow, doc: PartnerDoc): LearnResult {
  const data: Record<string, unknown> = { ...(p.data ?? {}) };
  let changed = false;
  const nm = String(doc.name ?? '').trim();
  const aliases = partnerAliases(p);
  if (nm && nameKey(nm) && nameKey(nm) !== nameKey(p.name) && !aliases.some((a) => nameKey(a) === nameKey(nm))) {
    data.aliases = [...aliases, nm].slice(-20);
    changed = true;
  }
  const id = classifyPartnerId(doc.id);
  let saveId: LearnResult['saveId'];
  if (id.kind === 'edb' || id.kind === 'embs') {
    const own = digits(id.kind === 'edb' ? p.edb : p.embs);
    if (!own && !(id.kind === 'embs' && digits(p.edb) === id.value)) saveId = { kind: id.kind, value: id.store };
    else if (own !== id.value && !(id.kind === 'embs' && digits(p.edb) === id.value) && !partnerAliasIds(p).includes(id.value)) {
      data.aliasIds = [...partnerAliasIds(p), id.value].slice(-20);
      changed = true;
    }
  }
  return { data, changed, ...(saveId ? { saveId } : {}) };
}

/* ------------------------------------------------------------------ drafts */

/** What a read document's draft remembers about its partner (shown in the editor). */
export interface DraftPartnerMatch {
  /** `new` = created from the document, `picked` = chosen by the user among the candidates. */
  by: PartnerMatchBy | 'new' | 'picked';
  /** The partner created / picked (for an editor whose partner list does not have it yet). */
  partner?: { id: string; name: string; code: string | null };
  /** The document's ЕДБ / ЕМБС the picked partner does not have: offered to be saved on it. */
  offerId?: { kind: 'edb' | 'embs'; value: string };
  score?: number;
  idKind: PartnerIdKind;
  id: string;
  candidates: PartnerCandidate[];
  /** The partner was created automatically from the document (can be undone while the document is a draft). */
  created?: boolean;
  /** The user undid the automatic partner: ask instead. */
  declined?: boolean;
}

export const draftMatchOf = (m: PartnerMatch<MatchablePartnerRow>): DraftPartnerMatch => ({
  by: m.by, ...(m.score && m.by === 'name' ? { score: m.score } : {}), idKind: m.id.kind, id: m.id.store, candidates: m.candidates,
  ...(m.partner ? { partner: { id: m.partner.id, name: m.partner.name, code: m.partner.code ?? null } } : {}),
});
