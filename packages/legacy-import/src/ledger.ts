/**
 * Port of the legacy ledger (`ledger()` index.html 3448, wrappers 12429 and 17424) for the importer.
 *
 * Legacy never stored the ledger: it rebuilt every journal line on demand from the documents (LEGACY-MAP C.3).
 * Some documents carry a posted snapshot (`lines`: invoices, purchases, Z reports, payroll, moves, journal), others
 * are posted live (bank lines, cash vouchers, compensations, supplier credits, ПДД, levelling). This module reproduces
 * that computation over a whole backup (all years) and returns one {@link LegacySource} per future journal:
 *
 * - stored `lines` + configurable extra lines (`gsch.extra`) + per-line overlays `ed{}` / added lines `edAdd[]`;
 * - credit notes / returns / supplier credits as red storno when `firm.crMode !== 'flip'` (`stF`);
 * - off-balance VAT-base lines (`vbLines`, kontos 994…/999…) for Излез / Влез / Каса / Поврат / Налог;
 * - side flips (`gsch.sides`), the partner fix of 12429 (12x/22x lines of invoices/purchases get the document partner);
 * - client-submitted documents (`pend`) are skipped, exactly like legacy.
 *
 * Live postings use the `@wise/core` ports (`bankEntries`, `blgEntries`, `scrEntries`, `kompEntries`); ПДД and the
 * levelling lines are ported here. Global office settings (`appsettings/schemes`) are only known when the backup
 * bundle carries them (full export / backup index) — otherwise the firm's own scheme and the defaults apply.
 */
import {
  advDeduct, bankEntries, blgEntries, calcLines, costsOf, kompEntries, locationAccounts, migrateLegacyScheme, r2,
  scrCalc, scrEntries, schemeOn, schemeValue, vatAccount,
  type JournalLine, type PostingContext, type SchemeMap, type StockLocation,
} from '@wise/core';
import type { LDoc, LegacyFirmBackup } from './format';
import { arr, obj, plus, str } from './util';

/** One ledger line in legacy terms (`k`, `d`, `p`; partner = legacy partner id). */
export interface LLine {
  k: string; d: number; p: number;
  partner?: string; note?: string; doc?: string;
  cur?: string; amtCur?: number;
  /** Legacy document id inside a grouped source (bank line id, move id). */
  docId?: string;
}

export type SourceKind =
  | 'invoice' | 'purchase' | 'bank' | 'sales' | 'payroll' | 'moves' | 'nivel' | 'pdd' | 'komp' | 'supcr' | 'blg' | 'journal';

/** Lines that become one journal in the new ledger. */
export interface LegacySource {
  /** Unique within the firm: `<kind>:<legacy id>` (bank: `bank:<acct>|<date>`, moves: `moves:<src>`). */
  key: string;
  kind: SourceKind;
  /** Legacy document id (bank: `<acct>|<date>`, moves: the move `src`). */
  legacyId: string;
  date: string;
  /** Journal kind for the posting service numbering (`izlez`, `odobr`, `vlez`, `bank`, `kasa`, `plati`, …). */
  journalKind: string;
  description: string;
  lines: LLine[];
}

export interface LedgerOptions {
  /** Office-wide documents (`appsettings/schemes`, …) when the bundle carries them. */
  glob?: Record<string, unknown>;
  /** Add the off-balance VAT-base lines (default true, as legacy). */
  vatBaseLines?: boolean;
  /** Does an account exist in the chart (legacy `ACC()[k]`, for the cash expense konto choice). */
  accountExists?: (k: string) => boolean;
}

/* ------------------------------------------------------------------ context */

/** Posting context from the legacy firm record and the office scheme (legacy `sch()` / `VAT_*` Proxies). */
export function postingContextOf(firm: LDoc, glob: Record<string, unknown> = {}): PostingContext {
  const gs = obj(glob['appsettings/schemes']);
  const has = Object.keys(gs).length > 0;
  return {
    firm: {
      sch: migrateLegacyScheme(obj(firm.sch) as SchemeMap),
      vatIn: obj(firm.vatIn), vatOut: obj(firm.vatOut), vatImp: obj(firm.vatImp),
      vatInKonto: str(firm.vatInKonto),
      ddv: typeof firm.ddv === 'boolean' ? firm.ddv : null,
      posK: str(firm.posK),
    },
    global: has ? { sch: migrateLegacyScheme(obj(gs.sch) as SchemeMap), vatIn: obj(gs.vatIn), vatOut: obj(gs.vatOut), vatImp: obj(gs.vatImp) } : null,
  };
}

const fromCore = (L: readonly JournalLine[]): LLine[] => L.map((l) => ({
  k: l.account, d: l.debit, p: l.credit,
  ...(l.partnerId ? { partner: l.partnerId } : {}),
  ...(l.note ? { note: l.note } : {}),
  ...(l.doc ? { doc: l.doc } : {}),
  ...(l.cur ? { cur: l.cur } : {}),
  ...(l.amtCur != null ? { amtCur: l.amtCur } : {}),
}));

/** Legacy stored line `{k,d,p,partner,note,doc,dd,dp,cur}` → LLine. */
function stored(l: unknown): LLine | null {
  const o = obj(l);
  if (o.k == null || String(o.k).trim() === '') return null;
  const x: LLine = { k: String(o.k).trim(), d: plus(o.d), p: plus(o.p) };
  if (str(o.partner)) x.partner = String(o.partner);
  if (str(o.note)) x.note = String(o.note);
  if (o.doc != null && o.doc !== '') x.doc = String(o.doc);
  const fx = plus(o.dd) || plus(o.dp);
  if (fx) { x.amtCur = fx; if (str(o.cur)) x.cur = String(o.cur); }
  return x;
}

/** Legacy `stF`: credit moved to the debit side as a negative amount and vice versa (red storno). */
const stF = (l: LLine): LLine => ({ ...l, d: l.p ? -l.p : 0, p: l.d ? -l.d : 0 });

/** Legacy `posL`: negative debit → credit, negative credit → debit; zero lines dropped. */
const posL = (L: LLine[]): LLine[] => L.map((l) => {
  let d = l.d, p = l.p;
  if (d < 0) { p -= d; d = 0; }
  if (p < 0) { d -= p; p = 0; }
  return { ...l, d: r2(d), p: r2(p) };
}).filter((l) => l.d || l.p);

/* ------------------------------------------------------------------ ПДД (legacy 8314–8322) */

interface PddType { id: string; sh?: string; pod?: string; ded: number; tax: number; kExp: string; kLiab: string; kTax: string }
const PDD_T0: PddType[] = [
  { id: 's6_1', pod: 'S6.1. Доход од закуп, освен од издавање на опремени станбени и деловни', ded: 10, tax: 10, kExp: '4143', kLiab: '22052', kTax: '23502', sh: 'Закупнина' },
  { id: 's1_15', pod: 'S1.15. Примања по основ на извршени интелектуални услуги', ded: 0, tax: 10, kExp: '4490', kLiab: '22053', kTax: '2350', sh: 'Интелектуални услуги / бонус' },
];
function pddTypes(firm: LDoc): PddType[] {
  const M = new Map(PDD_T0.map((t) => [t.id, { ...t }]));
  for (const t of arr(firm.pddTypes)) if (t && t.id) M.set(t.id, { ...(M.get(t.id) ?? {}), ...t });
  return [...M.values()];
}
const pddCalcG = (G0: unknown, t: PddType) => {
  const G = Math.round(plus(G0));
  const ded = Math.round(G * plus(t.ded) / 100 + 1e-9);
  const tax = Math.round((G - ded) * plus(t.tax) / 100 + 1e-9);
  return { G, ded, tax, net: G - tax };
};
function pddCalc(r: Record<string, unknown>, t: PddType) {
  if (r.mode !== 'n') return pddCalcG(r.amt, t);
  const N = Math.round(plus(r.amt));
  const k = 1 - plus(t.tax) / 100 * (1 - plus(t.ded) / 100);
  const G = Math.round(N / k);
  for (const d of [0, -1, 1, -2, 2]) { const c = pddCalcG(G + d, t); if (c.net === N) return c; }
  return pddCalcG(G, t);
}
export function pddEntries(d: LDoc, firm: LDoc): LLine[] {
  const T = pddTypes(firm);
  const L: LLine[] = [];
  for (const r of arr(d.rows)) {
    const t = T.find((x) => x.id === r.tid) ?? T[0]!;
    const c = pddCalc(obj(r), t);
    if (!c.G) continue;
    const nt = (t.sh || t.pod || '') + ' – ' + (r.name || '');
    L.push({ k: t.kExp, d: c.G, p: 0, note: nt }, { k: t.kLiab, d: 0, p: c.net, note: nt, ...(r.pid ? { partner: String(r.pid) } : {}) });
    if (c.tax) L.push({ k: t.kTax, d: 0, p: c.tax, note: 'ПДД ' + nt });
  }
  return L;
}

/* ------------------------------------------------------------------ the ledger */

const SRC_OF_JOURNAL: Record<string, string> = { amort: 'Амортизација', close: 'Затворање', open: 'Почетна', kamata: 'Камата', ddv: 'ДДВ', kauc: 'Кауција' };
const SIDE_SRC: Record<string, string> = {
  pur: 'Влез', purR: 'Влез', imp: 'Влез', fisk: 'Влез', noVat: 'Влез', art32: 'Влез', inv: 'Излез', invS: 'Излез', inv0: 'Излез',
  cogs: 'Залиха', kasa: 'Каса', adv: 'Извод', pay: 'Плати', izvPay: 'Извод', izvSup: 'Извод',
};
const BKPK_RE = /^(12[0-8]|22[0-8])/;

export interface LedgerResult { sources: LegacySource[]; warnings: string[] }

interface Loc extends StockLocation { id: string }

/** Rebuild the legacy ledger of one firm (all years). */
export function legacyLedger(fb: LegacyFirmBackup, opts: LedgerOptions = {}): LedgerResult {
  const { firm, data } = fb;
  const glob = opts.glob ?? {};
  const ctx = postingContextOf(firm, glob);
  const gsch = obj(glob['appsettings/schemes']);
  const warnings: string[] = [];
  const vbOn = opts.vatBaseLines !== false;
  const sto = (firm.crMode || 'minus') === 'minus';
  const sch = (k: string) => schemeValue(ctx, k);
  const VAT = (t: 'out' | 'in' | 'imp', r: number | string) => vatAccount(ctx, t, r);

  /* locations (legacy `locs`, `kindOf`, `locRow`) */
  const LOC = new Map<string, Loc>();
  for (const c of data.codes) if (c.cb === 'warehouse' || c.cb === 'store') LOC.set(c.id, { id: c.id, kind: c.cb, konto: str(c.konto) ?? undefined, kMarg: str(c.kMarg) ?? undefined, kVat: str(c.kVat) ?? undefined });
  const locOf = (w: unknown): Loc | null => (w && w !== 'main' ? LOC.get(String(w)) ?? null : null);
  const items = new Map(data.items.map((i) => [i.id, i]));
  const purchases = new Map(data.purchases.map((p) => [p.id, p]));
  const invoicesById = new Map(data.invoices.map((i) => [i.id, i]));

  /* bank accounts (legacy `banks`/`bankOf`) and cash registers (`blgRegs`) */
  const banks = arr(firm.banks).length ? arr(firm.banks) : [{ id: 'main', name: firm.bankName || 'Трансакциска сметка', account: firm.bank || '', konto: '1000' }];
  const bankOf = (id: unknown) => banks.find((b) => b.id === (id || 'main')) ?? banks[0];
  const accExists = opts.accountExists ?? (() => true);
  const regs = arr(firm.blg).length ? arr(firm.blg) : [
    { id: '1020', name: 'Главна благајна', konto: '1020', cur: 'MKD' },
    ...(accExists('1051') ? [{ id: '1051', name: 'Девизна благајна – службени патувања', konto: '1051', cur: 'EUR' }] : []),
    ...(accExists('1052') ? [{ id: '1052', name: 'Девизна благајна – транспорт', konto: '1052', cur: 'EUR' }] : []),
  ];
  const regOf = (id: unknown) => regs.find((r) => r.id === id) ?? regs[0];

  /* side flips (legacy `sideFlips`) */
  const SF: Record<string, Record<string, string>> = {};
  for (const [cid, m] of Object.entries(obj(gsch.sides))) {
    const src = SIDE_SRC[cid];
    if (!src) continue;
    for (const [key, side] of Object.entries(obj(m))) {
      const k = /^VI/.test(key) ? VAT('in', key.slice(2)) : /^VM/.test(key) ? VAT('imp', key.slice(2)) : /^VO/.test(key) ? VAT('out', key.slice(2)) : sch(key);
      if (k && k !== '-') (SF[src] ??= {})[String(k)] = String(side);
    }
  }

  /* VAT-base lines (legacy `vatKmap`, `vatBases`, `docBases`, `vbLines`) */
  type Base = { t: 'out' | 'in' | 'imp'; r: number; b: number };
  const vatKmap = () => {
    const m: Record<string, { t: Base['t']; r: number }> = {};
    for (const r of [18, 10, 5]) {
      const o = VAT('out', r), i = VAT('in', r), im = VAT('imp', r);
      if (o) m[o] = { t: 'out', r };
      if (i) m[i] ??= { t: 'in', r };
      if (im) m[im] ??= { t: 'imp', r };
    }
    return m;
  };
  const vatBases = (LS: (LLine & { vb?: number })[]): Base[] => {
    const M = vatKmap();
    const R = new Map<string, Base>();
    for (const l of LS) {
      const x = M[String(l.k)];
      if (!x) continue;
      const a = x.t === 'out' ? l.p - l.d : l.d - l.p;
      if (!a) continue;
      const key = x.t + '|' + x.r;
      const o = R.get(key) ?? { ...x, b: 0 };
      const vb = l.vb != null && plus(l.vb) ? Math.abs(plus(l.vb)) * Math.sign(a) : a * 100 / x.r;
      o.b = r2(o.b + vb);
      R.set(key, o);
    }
    return [...R.values()];
  };
  const docBases = (src: string, d: LDoc): Base[] => {
    const R = new Map<string, Base>();
    const add = (t: Base['t'], r0: unknown, b: number) => {
      const r = plus(r0);
      if (!r || !b) return;
      const k = t + '|' + r;
      const o = R.get(k) ?? { t, r, b: 0 };
      o.b = r2(o.b + b);
      R.set(k, o);
    };
    try {
      if (src === 'Излез' && !d.art32) {
        const sg = d.credit ? -1 : 1;
        const nonVat = firm.ddv === false;
        for (const g of calcLines(arr(d.items), !!d.art32, { nonVat }).by) add('out', g.rate, sg * g.base);
        if (!d.credit && !d.advance) {
          const advs = Object.entries(obj(d.advances)).map(([id, amt]) => ({ amount: plus(amt), invoice: invoicesById.get(id) })).filter((a) => a.invoice)
            .map((a) => ({ amount: a.amount, invoice: { id: a.invoice!.id, items: arr(a.invoice!.items), art32: !!a.invoice!.art32 } }));
          for (const g of advDeduct(advs, { nonVat }).by) add('out', g.rate, -g.base);
        }
      } else if (src === 'Каса') {
        for (const g of arr(d.groups)) add('out', g.rate, plus(g.base));
      } else if (src === 'Влез') {
        for (const c of costsOf({ costs: obj(d.costs) })) {
          for (const l of arr(c.o.lines)) {
            if (!plus(l?.vat)) continue;
            add(c.k === 'car' ? 'imp' : 'in', plus(l.rate) || 18, Math.round(plus(l.base)));
          }
        }
        if (!d.imp && !d.art32) for (const g of arr(d.groups)) if (plus(g.vat)) add('in', g.rate, Math.round(plus(g.base) + plus(g.vat)) - Math.round(plus(g.vat)));
      }
    } catch { /* legacy swallowed calculation errors here too */ }
    return [...R.values()];
  };
  const vbLines = (bases: Base[]): LLine[] => {
    const out: LLine[] = [];
    for (const x of bases) {
      if (!x.r || !x.b) continue;
      const kd = sch('vb' + x.t + x.r + 'd'), kp = sch('vb' + x.t + x.r + 'p');
      if (!kd || !kp || kd === '-' || kp === '-') continue;
      const n = 'Основица ДДВ ' + ({ out: 'излез', in: 'влез', imp: 'увоз' } as const)[x.t] + ' ' + x.r + '%';
      if (x.b < 0 && sto) { out.push({ k: kd, d: x.b, p: 0, note: n }, { k: kp, d: 0, p: x.b, note: n }); continue; }
      const b = Math.abs(x.b);
      out.push(x.b > 0 ? { k: kd, d: b, p: 0, note: n } : { k: kd, d: 0, p: b, note: n }, x.b > 0 ? { k: kp, d: 0, p: b, note: n } : { k: kp, d: b, p: 0, note: n });
    }
    return out;
  };

  /* extra lines (legacy `extraLines`, `docCard`, `docBasis`) */
  const EX = obj(gsch.extra);
  const purTotal = (p: LDoc) => r2(arr(p.groups).reduce((s, g) => s + plus(g.base) + (p.art32 ? 0 : plus(g.vat)), 0));
  const docCard = (src: string, doc: LDoc): string | null => {
    if (src === 'Влез') {
      if (doc.cash) return 'fisk'; if (doc.imp) return 'imp'; if (doc.art32) return 'art32';
      if (arr(doc.stock).length && locOf(doc.wh)?.kind === 'store') return 'purR';
      if (firm.ddv === false) return 'noVat';
      return 'pur';
    }
    if (src === 'Излез') {
      if (doc.credit) return null;
      const c = calcLines(arr(doc.items), !!doc.art32);
      if (!c.vat) return 'inv0';
      return doc.svc ? 'invS' : 'inv';
    }
    if (src === 'Каса') return 'kasa';
    if (src === 'Плати') return 'pay';
    if (src === 'Залиха' && doc.type === 'sale') return 'cogs';
    return null;
  };
  let payExtraWarned = false;
  const extraLines = (src: string, doc: LDoc): LLine[] => {
    if (!Object.keys(EX).length) return [];
    const c = docCard(src, doc);
    const rows = c ? arr(EX[c]) : [];
    if (!c || !rows.length) return [];
    let b: { total: number; base: number; vat: number };
    if (c === 'pay') {
      if (!payExtraWarned) { warnings.push('Дополнителните ставки за плати (глобална шема „extra.pay“) не се пренесени – проверете ги налозите за плати.'); payExtraWarned = true; }
      return [];
    } else if (['inv', 'invS', 'inv0'].includes(c)) {
      const x = calcLines(arr(doc.items), !!doc.art32); b = { total: x.total, base: x.base, vat: x.vat };
    } else if (c === 'kasa') {
      const bb = arr(doc.groups).reduce((a, g) => a + plus(g.base), 0), vv = arr(doc.groups).reduce((a, g) => a + plus(g.vat), 0);
      b = { total: plus(doc.total) || r2(bb + vv), base: r2(bb), vat: r2(vv) };
    } else if (c === 'cogs') {
      const v = Math.abs(plus(doc.value)); b = { total: v, base: v, vat: 0 };
    } else {
      const bb = arr(doc.groups).reduce((a, g) => a + plus(g.base), 0), vv = arr(doc.groups).reduce((a, g) => a + plus(g.vat), 0);
      b = { total: purTotal(doc), base: r2(bb), vat: r2(vv) };
    }
    return rows.filter((x) => x.k && plus(x.v)).map((x) => {
      const a = r2(x.b === 'fix' ? plus(x.v) : (b[(x.b || 'total') as keyof typeof b] ?? 0) * plus(x.v) / 100);
      return { k: String(x.k), d: x.s === 'd' ? a : 0, p: x.s === 'p' ? a : 0, note: x.n || 'Дополнително' };
    }).filter((l) => l.d || l.p);
  };

  /* legacy `add(src, doc, label)` */
  const sources: LegacySource[] = [];
  const byKey = new Map<string, LegacySource>();
  const emit = (key: string, kind: SourceKind, legacyId: string, date: string, journalKind: string, description: string, L: LLine[]) => {
    let s = byKey.get(key);
    if (!s) { s = { key, kind, legacyId, date, journalKind, description, lines: [] }; byKey.set(key, s); sources.push(s); }
    s.lines.push(...L);
  };
  const lines = (src: string, doc: LDoc, base: LLine[], vb: LLine[], docNo: string, docPartner?: string): LLine[] | null => {
    if (doc.pend) return null;
    const date = String(doc.date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(date)) { warnings.push(`${src} ${doc.number || doc.id}: нема датум – не е книжено.`); return null; }
    const LL = [...base, ...extraLines(src, doc)];
    const nb = base.length;
    const ED = obj(doc.ed);
    const fl = SF[src];
    const out: LLine[] = [];
    const all: [LLine, number | null][] = [...LL.map((l, i) => [l, i < nb ? i : null] as [LLine, number | null]), ...(vbOn ? vb : []).map((l) => [l, null] as [LLine, null])];
    for (const [l0, li] of all) {
      let l = l0;
      const e = li != null ? obj(ED[li]) : null;
      if (e && Object.keys(e).length && String(e.k0) === String(l0.k) && Math.abs(plus(e.d0) - l0.d) < 0.01 && Math.abs(plus(e.p0) - l0.p) < 0.01) {
        l = { ...l };
        if (e.k) l.k = String(e.k);
        if (e.doc != null) l.doc = String(e.doc);
        if (e.note != null) l.note = String(e.note);
        if (e.partner != null) l.partner = String(e.partner) || undefined;
        if (e.d != null && e.d !== '') l.d = plus(e.d);
        if (e.p != null && e.p !== '') l.p = plus(e.p);
        if (e.dd != null || e.dp != null) l.amtCur = plus(e.dd) || plus(e.dp);
      }
      if (fl) {
        const want = fl[String(l.k)];
        if (want && ((want === 'd' && l.p && !l.d) || (want === 'p' && l.d && !l.p))) l = { ...l, d: l.p, p: l.d };
      }
      out.push({ ...l, doc: l.doc ?? docNo });
    }
    for (const x of arr(doc.edAdd)) {
      if (!x || (!plus(x.d) && !plus(x.p))) continue;
      out.push({
        k: String(x.k), d: plus(x.d), p: plus(x.p), note: x.note || '', ...(x.partner ? { partner: String(x.partner) } : {}),
        doc: x.doc != null && x.doc !== '' ? String(x.doc) : docNo, ...(plus(x.dd) || plus(x.dp) ? { amtCur: plus(x.dd) || plus(x.dp) } : {}),
      });
    }
    // 12429: a 12x/22x line of an invoice / purchase without a partner takes the document partner.
    if (docPartner) for (const l of out) if (!l.partner && BKPK_RE.test(String(l.k))) l.partner = docPartner;
    return out.filter((l) => l.d || l.p);
  };
  const storedLines = (doc: LDoc): LLine[] => arr(doc.lines).map(stored).filter((x): x is LLine => !!x);

  // Излез
  for (const x of data.invoices) {
    let base = storedLines(x);
    if (x.credit && sto) base = base.map(stF);
    const src = 'Излез';
    const L = lines(src, x, base, vbLines(docBases(src, x)), String(x.number ?? ''), str(x.partner) ?? undefined);
    if (L) emit('invoice:' + x.id, 'invoice', x.id, String(x.date).slice(0, 10), x.credit ? 'odobr' : 'izlez', (x.credit ? 'Одобрение ' : 'Фактура ') + (x.number ?? ''), L);
  }
  // Влез
  for (const x of data.purchases) {
    const src = 'Влез';
    const L = lines(src, x, storedLines(x), vbLines(docBases(src, x)), String(x.number ?? ''), str(x.partner) ?? undefined);
    if (L) emit('purchase:' + x.id, 'purchase', x.id, String(x.date).slice(0, 10), x.imp || x.vid === 'U' ? 'vlezDev' : 'vlez', 'Влезна ф-ра ' + (x.number || ''), L);
  }
  // Извод — recomputed per line, grouped per statement (account + date)
  for (const x of [...data.bank].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    const acc = bankOf(x.acct);
    const L0 = fromCore(bankEntries({
      amount: plus(x.amount), konto: str(x.konto) ?? undefined, partner: str(x.partner) ?? undefined,
      ref: x.ref && typeof x.ref === 'object' ? x.ref : null, settle: x.settle ?? null,
      split: arr(x.split).map((s) => ({ k: String(s.k), a: plus(s.a), ...(s.n ? { n: String(s.n) } : {}) })), conv: !!x.conv,
    }, ctx, { konto: str(acc?.konto) ?? '1000', cur: str(acc?.cur) ?? 'MKD' })).map((l) => ({ ...l, note: str(x.desc) ?? l.note, docId: x.id }));
    const docNo = String(obj(x.ref).label || x.docNo || '');
    const L = lines('Извод', x, L0, [], docNo);
    const acct = String(x.acct || 'main');
    if (L) emit(`bank:${acct}|${String(x.date).slice(0, 10)}`, 'bank', `${acct}|${String(x.date).slice(0, 10)}`, String(x.date).slice(0, 10), 'bank', 'Извод ' + (acc?.name ?? '') + ' ' + String(x.date).slice(0, 10), L.map((l) => ({ ...l, docId: x.id })));
  }
  // Каса
  for (const x of data.sales) {
    const src = 'Каса';
    const L = lines(src, x, storedLines(x), vbLines(docBases(src, x)), String(x.number ?? x.moNo ?? ''));
    if (L) emit('sales:' + x.id, 'sales', x.id, String(x.date).slice(0, 10), 'kasa', 'Дневен извештај ' + x.date, L);
  }
  // Плати
  for (const x of data.payroll) {
    if (!arr(x.lines).length && arr(x.employees).length) warnings.push(`Плата ${x.month ?? x.id}: стар формат (v1) без книжење – не е книжена.`);
    const L = lines('Плати', x, storedLines(x), [], '');
    if (L) emit('payroll:' + x.id, 'payroll', x.id, String(x.date).slice(0, 10), 'plati', 'Плата ' + (x.month ?? ''), L);
  }
  // Залиха — moves grouped by their source document (`src`)
  for (const x of data.moves) {
    let base: LLine[] = storedLines(x).map((l) => ({ ...l, docId: x.id }));
    if (x.type === 'return' && sto) base = base.map(stF);
    const L = lines('Залиха', x, base, [], '');
    const src = String(x.src || x.id);
    if (L && L.length) emit('moves:' + src, 'moves', src, String(x.date).slice(0, 10), 'zaliha', x.label || 'Движење на залиха', L.map((l) => ({ ...l, docId: x.id })));
  }
  // Нивелации (retail locations only)
  for (const n of data.docs.filter((d) => d.type === 'nivel')) {
    const W = locOf(n.wh);
    const la = locationAccounts(ctx, W);
    if (!(la.retail || W?.kind === 'store')) continue;
    const fs = obj(firm.sch);
    const K = { st: str(W?.konto) || str(fs.retailStock) || '6630', mg: str(W?.kMarg) || str(fs.retailMarg) || '6690', vt: str(W?.kVat) || str(fs.retailVat) || '6640' };
    const dv = !!firm.ddv;
    let a = 0, v = 0;
    for (const l of arr(n.lines)) {
      const it = items.get(String(l.item)) ?? {};
      const rate = dv ? plus((it as LDoc).rate ?? 18) : 0;
      const dd = plus(l.qty) * (plus(l.new) - plus(l.old));
      a += dd;
      v += rate ? dd * rate / (100 + rate) : 0;
    }
    a = r2(a); v = r2(v);
    if (!a) continue;
    const base = posL([{ k: K.st, d: a, p: 0 }, { k: K.mg, d: 0, p: r2(a - v) }, ...(v ? [{ k: K.vt, d: 0, p: v }] : [])]);
    const L = lines('Залиха', n, base, [], String(n.number ?? ''));
    if (L) emit('nivel:' + n.id, 'nivel', n.id, String(n.date).slice(0, 10), 'zaliha', 'Нивелација ' + (n.number || ''), L);
  }
  // ПДД
  for (const x of data.docs.filter((d) => d.type === 'pdd')) {
    const L = lines('ПДД', x, pddEntries(x, firm), [], String(x.number ?? ''));
    if (L) emit('pdd:' + x.id, 'pdd', x.id, String(x.date).slice(0, 10), 'pdd', x.note || 'Закупнина / бонуси ' + x.date, L);
  }
  // Компензации
  for (const x of data.docs.filter((d) => d.type === 'komp')) {
    const base = fromCore(kompEntries({ number: str(x.number) ?? '', rows: arr(x.rows).map((r) => ({ side: r.side === 'pay' ? 'pay' : 'rec', amt: plus(r.amt), partner: str(r.partner) ?? undefined, konto: str(r.konto) ?? undefined, docNo: str(r.docNo) ?? undefined })) }, ctx));
    const L = lines('Компензација', x, base, [], String(x.number ?? ''));
    if (L) emit('komp:' + x.id, 'komp', x.id, String(x.date).slice(0, 10), 'komp', 'Компензација ' + (x.number || ''), L);
  }
  // Поврат / одобрение од добавувач
  for (const x of data.docs.filter((d) => d.type === 'supcr')) {
    const ref = purchases.get(String(x.refPur ?? ''));
    const doc = {
      kind: x.kind === 'ret' ? 'ret' as const : 'disc' as const, date: String(x.date), partner: str(x.partner) ?? undefined,
      refPurchase: ref ? { imp: !!(ref.imp || ref.vid === 'U'), supKonto: str(ref.supKonto) ?? undefined } : null,
      rows: arr(x.rows).map((r) => ({ item: r.item, name: r.name, qty: plus(r.qty), price: plus(r.price), rate: plus(r.rate), konto: str(r.konto) ?? undefined })),
    };
    let base: LLine[];
    try { base = fromCore(scrEntries(doc, ctx, locOf(x.wh))); } catch (e) { warnings.push(`Поврат ${x.number}: ${(e as Error).message}`); continue; }
    if (sto) base = base.map(stF);
    const vb = ctx.firm.ddv ? vbLines(scrCalc(doc, ctx).by.filter((g) => g.v && VAT('in', g.rate)).map((g) => ({ t: 'in' as const, r: g.rate, b: -g.b }))) : [];
    const L = lines('Поврат', x, base, vb, String((x.kind !== 'ret' && x.supNo) || x.number || ''));
    if (L) emit('supcr:' + x.id, 'supcr', x.id, String(x.date).slice(0, 10), 'povrat', (x.kind === 'ret' ? 'Повратница до добавувач ' : 'Одобрение од добавувач ') + (x.number || ''), L);
  }
  // Благајна
  for (const x of data.docs.filter((d) => d.type === 'blg')) {
    const reg = regOf(x.reg);
    let base: LLine[];
    try {
      base = fromCore(blgEntries({
        kind: x.kind === 'in' ? 'in' : 'out', date: String(x.date), amt: plus(x.amt), cur: str(x.cur) ?? 'MKD', fx: x.fx, rate: x.rate,
        vat: x.vat, cat: str(x.cat) ?? undefined, konto: str(x.konto) ?? undefined, partner: str(x.partner) ?? undefined,
        merchant: str(x.merchant) ?? undefined, country: str(x.country) ?? undefined, note: str(x.note) ?? undefined, payK: str(x.payK) ?? undefined,
      }, ctx, { konto: String(reg?.konto ?? '1020'), cur: String(reg?.cur ?? 'MKD') }, { accountExists: accExists }));
    } catch (e) { warnings.push(`Благајна ${x.number}: ${(e as Error).message}`); continue; }
    const L = lines('Благајна', x, base, [], String(x.docNo || x.number || ''));
    if (L) emit('blg:' + x.id, 'blg', x.id, String(x.date).slice(0, 10), 'kasa', (x.kind === 'in' ? 'Уплатница ' : 'Исплатница ') + (x.number || '') + (x.merchant ? ' · ' + x.merchant : x.note ? ' · ' + x.note : ''), L);
  }
  // Налози (manual, opening, closing, depreciation, interest, VAT close, deposits, imported trial balance…)
  for (const x of data.journal) {
    const src = SRC_OF_JOURNAL[x.kind] ?? 'Налог';
    const base = storedLines(x);
    const vb = src === 'Налог' ? vbLines(vatBases(arr(x.lines).filter((l) => plus(l?.vb)).map((l) => ({ ...(stored(l) ?? { k: '', d: 0, p: 0 }), vb: plus(l.vb) })))) : [];
    const L = lines(src, x, base, vb, String(x.nalNo ?? ''));
    if (L) emit('journal:' + x.id, 'journal', x.id, String(x.date).slice(0, 10), String(x.kind || 'manual'), x.desc || '', L);
  }
  if (!schemeOn(ctx, 'customer')) warnings.push('Шемата за книжење нема конто за купувачи – проверете ја шемата на фирмата.');
  return { sources, warnings };
}

/* ------------------------------------------------------------------ trial balance */

export interface TbRow { account: string; debit: number; credit: number }

/** Turnover per account over a set of lines (cents-exact). */
export function trialBalanceOf(lines: readonly { k: string; d: number; p: number }[]): Map<string, TbRow> {
  const C = new Map<string, { d: number; p: number }>();
  for (const l of lines) {
    const c = C.get(l.k) ?? { d: 0, p: 0 };
    c.d += Math.round(r2(l.d) * 100);
    c.p += Math.round(r2(l.p) * 100);
    C.set(l.k, c);
  }
  return new Map([...C].map(([k, c]) => [k, { account: k, debit: c.d / 100, credit: c.p / 100 }]));
}

export interface TbDiff { account: string; legacyDebit: number; legacyCredit: number; newDebit: number; newCredit: number }

/** Accounts whose debit or credit turnover differs (legacy vs imported). */
export function compareTrialBalances(legacy: Map<string, TbRow>, imported: Map<string, TbRow>): TbDiff[] {
  const keys = [...new Set([...legacy.keys(), ...imported.keys()])].sort();
  const out: TbDiff[] = [];
  for (const k of keys) {
    const a = legacy.get(k) ?? { account: k, debit: 0, credit: 0 }, b = imported.get(k) ?? { account: k, debit: 0, credit: 0 };
    if (Math.round(a.debit * 100) !== Math.round(b.debit * 100) || Math.round(a.credit * 100) !== Math.round(b.credit * 100)) {
      out.push({ account: k, legacyDebit: a.debit, legacyCredit: a.credit, newDebit: b.debit, newCredit: b.credit });
    }
  }
  return out;
}
