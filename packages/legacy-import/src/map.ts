/**
 * Pure mapping: legacy documents → insert values of the server's Drizzle tables.
 *
 * Every mapper takes the legacy document and a resolver `R(kind, legacyId)` that returns the new uuid of an already
 * imported record (partner, item, location, …) or null. The writer (`writer.ts`) adds `firmId`, runs the inserts and
 * keeps the legacy-id map. Nothing here touches the database, so the mappers are unit-tested with plain fixtures.
 *
 * Field lists follow LEGACY-MAP.md (Phases 2–10, "Data shapes"); everything without its own column is kept in the
 * row's `data` jsonb (minus transient UI fields, LEGACY-MAP 11.4 item 6).
 */
import { calcLines, migrateLegacyScheme, perRange, periodOf, r2, scrCalc, type SchemeMap } from '@wise/core';
import type { LDoc } from './format';
import { postingContextOf } from './ledger';
import {
  accountOrNull, arr, bool, dec, decOrNull, int, isoDate, money, moneyOrNull, num, obj, rest, str, strOr,
} from './util';

/** Resolve a legacy id of a given kind to the new uuid (null = not imported / unknown). */
export type Resolve = (kind: RefKind, legacyId: unknown) => string | null;
export type RefKind =
  | 'partner' | 'item' | 'location' | 'employee' | 'invoice' | 'purchase' | 'bank_account' | 'register' | 'asset'
  | 'vehicle' | 'hotel_room' | 'travel_arrangement' | 'construction_project' | 'user' | 'supplier_credit';

/** Thrown by a mapper when a record cannot be imported into its table (the writer stores it in `firm_docs`). */
export class MapSkip extends Error {
  constructor(m: string) { super(m); this.name = 'MapSkip'; }
}
const need = <T>(v: T | null | undefined, why: string): T => {
  if (v == null || v === '') throw new MapSkip(why);
  return v;
};
const dateOf = (d: LDoc, what: string): string => need(isoDate(d.date), `${what}: нема важечки датум`);

/* ------------------------------------------------------------------ firm */

const FIRM_COLS = ['id', 'code', 'name', 'lf', 'edb', 'embs', 'address', 'city', 'email', 'phone', 'activity', 'ddv', 'per', 'lock', 'active', 'mods', 'logo', 'sign', 'stamp', 'sch'];

export function mapFirm(f: LDoc) {
  const settings = rest(f, FIRM_COLS);
  if (f.sch && typeof f.sch === 'object') settings.sch = migrateLegacyScheme(f.sch as SchemeMap); // LEGACY-MAP 11.4 item 1: effective values
  return {
    legacyId: f.id,
    code: str(f.code),
    name: strOr(f.name, `Фирма ${f.id}`),
    legalForm: str(f.lf),
    edb: str(f.edb),
    embs: str(f.embs),
    address: str(f.address),
    city: str(f.city),
    email: str(f.email),
    phone: str(f.phone),
    activity: str(f.activity),
    vatRegistered: f.ddv !== false,
    vatPeriod: f.per === 'month' ? 'month' : 'quarter',
    lockDate: isoDate(f.lock),
    active: f.active !== false,
    mods: arr(f.mods).map(String),
    settings,
  };
}

/** Per-firm chart overrides (legacy `firm.accounts {konto: {mk, sq} | null}`). */
export function mapAccountOverrides(f: LDoc): { code: string; name: string; nameSq: string | null; hidden: boolean }[] {
  const out = [];
  for (const [k, v] of Object.entries(obj(f.accounts))) {
    const code = accountOrNull(k);
    if (!code) continue;
    if (v === null) out.push({ code, name: code, nameSq: null, hidden: true });
    else { const o = obj(v); out.push({ code, name: strOr(o.mk ?? o.sq, code), nameSq: str(o.sq), hidden: false }); }
  }
  return out;
}

/** Firm bank accounts (legacy `firm.banks[]`, default `main` → 1000 like legacy `banks()`). */
export function mapBankAccounts(f: LDoc) {
  const L = arr(f.banks).length ? arr(f.banks) : [{ id: 'main', name: f.bankName || 'Трансакциска сметка', account: f.bank || '', konto: '1000' }];
  return L.filter((b) => b && b.id != null).map((b, i) => ({
    legacyId: String(b.id), name: strOr(b.name, 'Сметка ' + (i + 1)), account: str(b.account), iban: str(b.iban),
    cur: strOr(b.cur, 'MKD'), konto: accountOrNull(b.konto) ?? '1000', nal: str(b.nal), sort: i, active: b.active !== false,
  }));
}

/** Cash registers (legacy `firm.blg[]`, default 1020 like legacy `blgRegs()`). */
export function mapCashRegisters(f: LDoc) {
  const L = arr(f.blg).length ? arr(f.blg) : [{ id: '1020', name: 'Главна благајна', konto: '1020', cur: 'MKD' }];
  return L.filter((r) => r && r.id != null).map((r, i) => ({
    legacyId: String(r.id), name: strOr(r.name, 'Благајна ' + (i + 1)), konto: accountOrNull(r.konto) ?? '1020', cur: strOr(r.cur, 'MKD'), sort: i,
  }));
}

/* ------------------------------------------------------------------ masters */

export function mapCode(c: LDoc) {
  return {
    legacyId: c.id, cb: strOr(c.cb, 'other'), code: str(c.code), name: strOr(c.name ?? c.code, c.cb || c.id),
    data: rest(c, ['id', 'cb', 'code', 'name', 'active']), active: c.active !== false,
  };
}

/** FIX(#17): legacy partners carry leaked item defaults `rate/konto/type` — dropped. */
export function mapPartner(p: LDoc) {
  return {
    legacyId: p.id, code: str(p.code), name: strOr(p.name, p.code ? `Комитент ${p.code}` : '(без име)'),
    edb: str(p.edb), embs: str(p.embs), address: str(p.address), city: str(p.city), country: str(p.country),
    email: str(p.email), phone: str(p.phone), contact: str(p.contact), bankAccount: str(p.bank), bankName: str(p.bankName),
    vatRegistered: p.ddv !== false, foreign: bool(p.foreign), active: p.active !== false,
    data: rest(p, ['id', 'code', 'name', 'edb', 'embs', 'address', 'city', 'country', 'email', 'phone', 'contact', 'bank', 'bankName', 'ddv', 'foreign', 'active', 'rate', 'konto', 'type']),
  };
}

const ITEM_TYPES = new Set(['service', 'goods', 'material', 'product']);
export function mapItem(it: LDoc) {
  return {
    legacyId: it.id, code: str(it.code), name: strOr(it.name, it.code ? `Артикл ${it.code}` : '(без име)'),
    type: (ITEM_TYPES.has(String(it.type)) ? String(it.type) : 'goods') as 'service' | 'goods' | 'material' | 'product',
    unit: str(it.unit), price: decOrNull(it.price, 4), vatRate: int(it.rate, 18), revenueAccount: accountOrNull(it.konto),
    minStock: decOrNull(it.min, 3), weight: decOrNull(it.weight, 3), madeInMk: bool(it.mk), rawAccount: accountOrNull(it.rawK),
    costPrice: decOrNull(it.costPrice, 4), costPct: decOrNull(it.costPct, 2), oe: str(it.oe), crossRefs: str(it.cross), fits: str(it.fits),
    active: it.active !== false,
    data: rest(it, ['id', 'code', 'name', 'type', 'unit', 'price', 'rate', 'konto', 'min', 'weight', 'mk', 'rawK', 'costPrice', 'costPct', 'oe', 'cross', 'fits', 'active', 'barcode']),
  };
}
/** Barcodes of an item: `barcode` (primary) plus `barcodes[]` if present. */
export const itemBarcodes = (it: LDoc): string[] => [...new Set([str(it.barcode), ...arr(it.barcodes).map(str)].filter((x): x is string => !!x))];

export function mapBom(it: LDoc, R: Resolve) {
  const lines = arr(it.bom).map((b) => ({ itemId: R('item', b.item), qty: num(b.qty) })).filter((b): b is { itemId: string; qty: number } => !!b.itemId && !!b.qty);
  return lines.length ? { labor: money(it.labor), lines } : null;
}

export function mapEmployee(e: LDoc) {
  return {
    legacyId: e.id, no: str(e.no), name: strOr(e.name, '(без име)'), embg: str(e.embg), position: str(e.position), oe: str(e.oe),
    city: str(e.city), address: str(e.address), email: str(e.email), netBase: money(e.netBase), coef: dec(e.coef || 1, 4),
    start: isoDate(e.start), end: isoDate(e.end), stazPrev: decOrNull(e.stazPrev, 2), stazY: decOrNull(e.stazY, 2), contract: str(e.contract),
    bankAcc: str(e.bankAcc), bank: str(e.bank), mpOps: str(e.mpOps), mpZan: str(e.mpZan), hNorm: decOrNull(e.hNorm, 2),
    leaveDays: int(e.leaveDays, 20), lekDate: isoDate(e.lekDate), bzrDate: isoDate(e.bzrDate), active: e.active !== false && !isoDate(e.end),
    endReason: str(e.endReason), endDocNo: str(e.endDocNo),
    data: rest(e, ['id', 'no', 'name', 'embg', 'position', 'oe', 'city', 'address', 'email', 'netBase', 'coef', 'start', 'end', 'stazPrev', 'stazY', 'contract', 'bankAcc', 'bank', 'mpOps', 'mpZan', 'hNorm', 'leaveDays', 'lekDate', 'bzrDate', 'active', 'endReason', 'endDocNo']),
  };
}

/* ------------------------------------------------------------------ sales & purchases */

const INV_HEAD = ['id', 'kind', 'type', 'number', 'date', 'pdate', 'due', 'partner', 'wh', 'art32', 'advance', 'advType', 'export', 'expType', 'svc', 'cur', 'fx', 'refInv', 'crKind', 'crGross', 'note', 'scanned', 'items', 'lines', 'credit', 'advances', 'files', 'apprBy', 'apprAt', 'fromClient', 'invoiced', 'invNumber', 'fromDoc', 'ed', 'edAdd'];

/** Invoice / credit note (legacy `invoices`) or proforma / dispatch (`docs.type = proforma | dispatch`). */
export function mapInvoice(x: LDoc, R: Resolve, firmDdv: boolean | undefined) {
  const kind = x.type === 'proforma' ? 'proforma' : x.type === 'dispatch' ? 'dispatch' : x.credit ? 'credit' : 'invoice';
  const items = arr(x.items);
  const c = calcLines(items, !!x.art32, { nonVat: firmDdv === false });
  const lines = items.map((it, i) => ({
    lineNo: i + 1, itemId: R('item', it.itemId), code: str(it.code), name: strOr(it.name, '—'), unit: str(it.unit),
    qty: dec(it.qty, 4), price: dec(it.price, 4), disc: dec(it.disc, 4), rate: int(it.rate, 18), account: accountOrNull(it.konto) ?? '7400',
  }));
  const crKind = ['price', 'gross', 'ret'].includes(String(x.crKind)) ? (String(x.crKind) as 'price' | 'gross' | 'ret') : null;
  return {
    head: {
      legacyId: x.id, kind: kind as 'invoice' | 'credit' | 'proforma' | 'dispatch',
      status: (x.pend ? 'pending' : kind === 'proforma' ? 'draft' : 'posted') as 'pending' | 'draft' | 'posted',
      number: strOr(x.number, x.id), date: dateOf(x, 'Фактура ' + (x.number ?? x.id)), pdate: isoDate(x.pdate), due: isoDate(x.due),
      partnerId: R('partner', x.partner), warehouseId: R('location', x.wh), art32: !!x.art32,
      advance: !!x.advance || x.advType === 'A', export: !!x.export || x.expType === 'E', svc: !!x.svc,
      currency: strOr(x.cur, 'MKD'), fx: dec(num(x.fx) || 1, 6), creditKind: kind === 'credit' ? crKind : null,
      creditGross: kind === 'credit' ? moneyOrNull(x.crGross) : null, note: str(x.note),
      base: money(c.base), vat: money(c.vat), total: money(c.total), scanned: !!x.scanned,
      data: rest(x, INV_HEAD),
    },
    lines,
    /** Second pass (other invoices must exist first). */
    refInvoice: str(x.refInv) ?? str(x.fromDoc),
    advances: Object.entries(obj(x.advances)).map(([id, amt]) => ({ legacyId: id, amount: money(amt) })),
  };
}

const PUR_HEAD = ['id', 'kind', 'number', 'date', 'docDate', 'due', 'partner', 'supplierName', 'supplierEdb', 'ptype', 'art32', 'imp', 'vid', 'cash', 'pay', 'noDed', 'wh', 'supKonto', 'cur', 'fx', 'calcNo', 'distMode', 'cnames', 'scanned', 'groups', 'stock', 'costs', 'lines', 'files', 'ed', 'edAdd', 'apprBy', 'apprAt', 'fromClient'];
const COST_SLOTS = new Set(['car', 't1', 't2', 'sped', 'trans', 'dr', 'dev']);

export function mapPurchase(x: LDoc, R: Resolve) {
  const groups = arr(x.groups);
  const base = groups.reduce((s, g) => s + num(g.base), 0), vat = groups.reduce((s, g) => s + num(g.vat), 0);
  const stock = arr(x.stock);
  const imp = !!x.imp || x.vid === 'U';
  const skipped: string[] = [];
  const stockLines = stock.map((s, i) => {
    const itemId = R('item', s.item);
    if (!itemId) { skipped.push(`ставка ${i + 1} (${s.name ?? s.item ?? '?'}) нема артикл`); return null; }
    return {
      lineNo: i + 1, itemId, name: str(s.name), code: str(s.code), barcode: str(s.barcode), qty: dec(s.qty, 4), price: dec(s.price, 4),
      rab: dec(s.rab, 4), amount: moneyOrNull(s.amount), cn: s.cn == null || s.cn === '' ? null : int(s.cn), dep: moneyOrNull(s.dep),
      cvat: money(s.cvat), sp: decOrNull(s.sp, 4), value: money(s.value), type: str(s.type),
    };
  }).filter((s): s is NonNullable<typeof s> => !!s);
  const costs = Object.entries(obj(x.costs)).filter(([k]) => COST_SLOTS.has(k)).map(([slot, o0]) => {
    const o = obj(o0);
    return {
      slot: slot as 'car', amount: money(o.amt), fx: decOrNull(o.fx, 6), doc: str(o.doc), date: isoDate(o.date), due: isoDate(o.due),
      partnerId: R('partner', o.partner), byQty: !!o.byQty, foreign: !!o.foreign,
      lines: arr(o.lines).map((l) => ({ base: num(l?.base), rate: num(l?.rate), vat: num(l?.vat) })),
    };
  });
  return {
    head: {
      legacyId: x.id, status: (x.pend ? 'pending' : 'posted') as 'pending' | 'posted', number: strOr(x.number, ''),
      date: dateOf(x, 'Влезна фактура ' + (x.number ?? x.id)), docDate: isoDate(x.docDate), due: isoDate(x.due),
      partnerId: R('partner', x.partner), supplierName: str(x.supplierName), supplierEdb: str(x.supplierEdb),
      ptype: (x.ptype === 'stock' || (!x.ptype && stock.length) ? 'stock' : 'cost') as 'stock' | 'cost',
      art32: !!x.art32, imp, cash: !!x.cash || (!imp && x.pay === 'cash'), noDed: !!x.noDed, warehouseId: R('location', x.wh),
      supplierAccount: accountOrNull(x.supKonto), currency: strOr(x.cur, 'MKD'), fx: dec(num(x.fx) || 1, 6), calcNo: str(x.calcNo),
      distMode: (['val', 'cn', 'multi'].includes(x.distMode) ? x.distMode : 'val') as 'val' | 'cn' | 'multi',
      cnames: arr(x.cnames).map((c) => String(c ?? '')), base: money(base), vat: money(vat), total: money(base + (x.art32 ? 0 : vat)),
      scanned: !!x.scanned, data: rest(x, PUR_HEAD),
    },
    groups: groups.map((g, i) => ({ lineNo: i + 1, account: accountOrNull(g.konto) ?? '4000', rate: int(g.rate, 18), base: money(g.base), vat: money(g.vat) })),
    stockLines, costs, skipped,
  };
}

export function mapSupplierCredit(x: LDoc, R: Resolve, ddv: boolean | undefined) {
  const rows = arr(x.rows);
  const c = scrCalc({ rows: rows.map((r) => ({ qty: num(r.qty), price: num(r.price), rate: num(r.rate), konto: str(r.konto) ?? undefined })) }, { firm: { ddv: !!ddv } });
  return {
    head: {
      legacyId: x.id, status: (x.pend ? 'pending' : 'posted') as 'pending' | 'posted', kind: (x.kind === 'ret' ? 'ret' : 'disc') as 'ret' | 'disc',
      number: strOr(x.number, x.id), date: dateOf(x, 'Поврат ' + (x.number ?? x.id)), supNo: str(x.supNo),
      partnerId: need(R('partner', x.partner), 'Поврат без добавувач'), refPurchaseId: R('purchase', x.refPur), warehouseId: R('location', x.wh),
      note: str(x.note), base: money(c.base), vat: money(c.vat), total: money(c.total), scanned: !!x.scanned,
    },
    lines: rows.map((r, i) => ({
      lineNo: i + 1, itemId: R('item', r.item), name: strOr(r.name, '—'), qty: dec(r.qty, 4), price: dec(r.price, 4), rate: int(r.rate, 18),
      account: accountOrNull(r.konto) ?? (x.kind === 'ret' ? '6600' : '7690'),
    })),
  };
}

/* ------------------------------------------------------------------ bank & cash */

/** Statement header for one account + date (legacy firm `izv`, `izvSal`, `izvTot`, `izvRate` keyed by `izvKey`). */
export function mapStatement(f: LDoc, acct: string, date: string) {
  const key = (acct && acct !== 'main' ? acct + ':' : '') + date;
  const sal = obj(obj(f.izvSal)[key]), tot = obj(obj(f.izvTot)[key]);
  return {
    date, number: str(obj(f.izv)[key]) ?? str(sal.no), opening: moneyOrNull(sal.o), closing: moneyOrNull(sal.c),
    statedDebit: moneyOrNull(tot.d), statedCredit: moneyOrNull(tot.p), rate: decOrNull(obj(f.izvRate)[key], 6),
    format: 'legacy', status: 'posted' as const,
  };
}

export function mapBankLine(x: LDoc, R: Resolve, lineNo: number) {
  const ref = obj(x.ref);
  const refType = ref.type === 'invoice' || ref.type === 'purchase' ? (ref.type as 'invoice' | 'purchase') : null;
  return {
    legacyId: x.id, lineNo, date: dateOf(x, 'Извод'), valDate: isoDate(x.valDate), amount: money(x.amount),
    amountCur: moneyOrNull(x.amountCur), cur: str(x.cur), description: strOr(x.desc, ''), name: str(x.name), purpose: str(x.purpose),
    osnov: str(x.osnov), bref: str(x.bref), counterAccount: str(x.acc ?? x.cacc), konto: accountOrNull(x.konto), partnerId: R('partner', x.partner),
    refType, refId: refType ? R(refType, ref.id) ?? null : null, refLabel: str(ref.label),
    refs: arr(x.refs).map((r) => ({ type: r.type, id: (r.type === 'invoice' || r.type === 'purchase' ? R(r.type, r.id) : null) ?? String(r.id ?? ''), label: String(r.label ?? ''), amt: num(r.amt) })),
    settle: moneyOrNull(x.settle), split: arr(x.split).length ? arr(x.split).map((s) => ({ k: String(s.k), a: num(s.a), ...(s.n ? { n: String(s.n) } : {}) })) : null,
    payRef: str(x.payRef), pos: !!x.pos, own: !!x.own, conv: !!x.conv, manual: !!x.manual, auto: str(x.auto),
    dupKey: 'legacy:' + x.id,
    data: rest(x, ['id', 'acct', 'date', 'valDate', 'amount', 'amountCur', 'cur', 'desc', 'name', 'purpose', 'osnov', 'bref', 'konto', 'partner', 'ref', 'refs', 'settle', 'split', 'payRef', 'pos', 'own', 'conv', 'manual', 'auto', 'lines', 'ed', 'edAdd']),
  };
}

export function mapCashVoucher(x: LDoc, R: Resolve) {
  const registerId = need(R('register', x.reg) ?? R('register', '__default'), 'Благајна без регистар');
  return {
    legacyId: x.id, registerId, kind: (x.kind === 'in' ? 'in' : 'out') as 'in' | 'out', date: dateOf(x, 'Благајна ' + (x.number ?? '')),
    number: strOr(x.number, x.id), docNo: str(x.docNo), merchant: str(x.merchant), vatId: str(x.vatId), country: strOr(x.country, 'MK'),
    cur: strOr(x.cur, 'MKD'), amt: money(x.amt), fx: dec(num(x.fx) || 1, 6), vatRate: int(x.rate, 0), vat: moneyOrNull(x.vat),
    cat: str(x.cat), konto: accountOrNull(x.konto), partnerId: R('partner', x.partner), note: str(x.note), payK: accountOrNull(x.payK),
    liters: decOrNull(x.liters, 3),
    data: rest(x, ['id', 'type', 'reg', 'kind', 'date', 'number', 'docNo', 'merchant', 'vatId', 'country', 'cur', 'amt', 'fx', 'rate', 'vat', 'cat', 'konto', 'partner', 'note', 'payK', 'liters', 'ed', 'edAdd']),
  };
}

export function mapCompensation(x: LDoc, R: Resolve) {
  const rows = arr(x.rows).map((r) => ({
    side: (r.side === 'pay' ? 'pay' : 'rec') as 'rec' | 'pay',
    refId: (r.ref?.type === 'invoice' || r.ref?.type === 'purchase' ? R(r.ref.type, r.ref.id) : null) ?? null,
    docNo: String(r.docNo ?? ''), date: isoDate(r.date) ?? undefined, partnerId: R('partner', r.partner) ?? '', konto: String(r.konto ?? ''), amt: num(r.amt),
  }));
  const total = rows.filter((r) => r.side === 'rec').reduce((s, r) => s + r.amt, 0);
  return { legacyId: x.id, kind: (x.kind === 'multi' ? 'multi' : 'bi') as 'bi' | 'multi', date: dateOf(x, 'Компензација'), number: strOr(x.number, x.id), note: str(x.note), rows, total: money(total) };
}

export function mapPaymentOrder(x: LDoc) {
  const kind = ['pp30', 'pp50', 'pp10'].includes(String(x.kind)) ? String(x.kind) : 'pp30';
  return {
    kind: kind as 'pp30' | 'pp50' | 'pp10', date: isoDate(x.date) ?? isoDate(x.valDate) ?? dateOf(x, 'Налог за плаќање'), amount: moneyOrNull(x.amount),
    recipient: str(x.recip), refId: str(x.purId), data: rest(x, ['id', 'type', 'kind']),
  };
}

/* ------------------------------------------------------------------ stock */

/** Legacy move `src` → owner document in the new schema (the stock journal is `stock:<sourceType>`). */
export function moveSource(src: string, R: Resolve, docs: { transfer: (src: string) => string | null; stockCount: (id: string) => string | null; production: (id: string) => string | null; salesDay: (id: string) => string | null }) {
  const pick = (re: RegExp, kind: RefKind, type: string) => {
    const m = re.exec(src);
    if (!m) return null;
    // ids are `Date.now().toString(36) + random` (no dashes) — the first segment after the prefix is the id
    const id = R(kind, m[1]);
    return id ? { sourceType: type, sourceId: id } : null;
  };
  const s = pick(/^pur-([^-]+)/, 'purchase', 'purchase') ?? pick(/^inv-([^-]+)/, 'invoice', 'invoice') ?? pick(/^isp-([^-]+)/, 'invoice', 'dispatch')
    ?? pick(/^scr-([^-]+)/, 'supplier_credit', 'supplier_credit');
  if (s) return s;
  if (/^prn-/.test(src)) { const t = docs.transfer(src); if (t) return { sourceType: 'transfer', sourceId: t }; }
  const mo = /^mo-([^-]+)/.exec(src);
  if (mo) { const t = docs.stockCount(mo[1]!); if (t) return { sourceType: 'stock_count', sourceId: t }; }
  const pr = /^((?:prod|rn)-[^-]+)/.exec(src) ?? /^(prod-.+?)(?:-in)?$/.exec(src);
  if (pr) { const t = docs.production(pr[1]!); if (t) return { sourceType: 'production', sourceId: t }; }
  const z = /^(?:pos-|z-|zf-)(.+)$/.exec(src);
  if (z) { const t = docs.salesDay(src) ?? docs.salesDay(z[0]); if (t) return { sourceType: 'sales_daily', sourceId: t }; }
  if (src.startsWith('op-')) return { sourceType: 'opening', sourceId: src };
  return { sourceType: 'legacy', sourceId: src };
}

const MOVE_KINDS = new Set(['in', 'sale', 'transfer', 'transfer-in', 'prod-out', 'prod-in', 'mat-out', 'return', 'writeoff', 'popis', 'popis-in', 'supret', 'dispatch', 'use', 'opening']);

export function mapMove(m: LDoc, R: Resolve) {
  const q = r2(num(m.qty) * 10000) / 10000;
  const value = r2(num(m.value));
  const kind = MOVE_KINDS.has(String(m.type)) ? String(m.type) : q >= 0 ? 'in' : 'use';
  return {
    legacyId: m.id, itemId: need(R('item', m.item), `Движење ${m.id}: артиклот не постои`), locationId: R('location', m.wh),
    date: dateOf(m, 'Движење на залиха'), qty: q.toFixed(4), value: value.toFixed(2), price: q ? (Math.abs(value / q)).toFixed(4) : null,
    direction: (q < 0 ? 'out' : 'in') as 'in' | 'out', kind: kind as 'in', pending: !!m.pend, lot: str(m.lot), expiry: isoDate(m.exp ?? m.expiry),
    label: str(m.label), partnerId: R('partner', m.partner),
    lines: arr(m.lines).filter((l) => l && l.k).map((l) => ({ account: String(l.k), debit: num(l.d), credit: num(l.p), ...(R('partner', l.partner) ? { partnerId: R('partner', l.partner) } : {}), ...(l.note ? { note: String(l.note) } : {}) })),
  };
}

export function mapLevelling(n: LDoc, R: Resolve) {
  return {
    legacyId: n.id, number: strOr(n.number, n.id), date: dateOf(n, 'Нивелација'), locationId: R('location', n.wh),
    lines: arr(n.lines).map((l) => ({ itemId: R('item', l.item), qty: num(l.qty), old: num(l.old), new: num(l.new), ...(l.qtyImp ? { qtyImp: true } : {}) })).filter((l): l is { itemId: string; qty: number; old: number; new: number } => !!l.itemId),
    note: str(n.note), promoTo: isoDate(n.akTo), promoBackOf: str(n.akBack),
  };
}

export function mapTransfer(t: LDoc, R: Resolve) {
  return {
    legacyId: t.id, number: strOr(t.number, t.id), date: dateOf(t, 'Преносница'), fromLocationId: R('location', t.from), toLocationId: R('location', t.to),
    lines: arr(t.lines).map((l) => ({ itemId: R('item', l.item), qty: num(l.qty), nabU: num(l.nabU), sp: l.sp == null ? null : num(l.sp) })).filter((l): l is { itemId: string; qty: number; nabU: number; sp: number | null } => !!l.itemId),
    note: str(t.note),
  };
}

/** Retail output `mout` of kind `pop` (count) / `otp` (write-off); other kinds have no table → firm_docs. */
export function mapStockCount(d: LDoc, R: Resolve) {
  if (d.t !== 'pop' && d.t !== 'otp') throw new MapSkip('Излез од малопродажба (не е попис/отпис)');
  return {
    legacyId: d.id, kind: (d.t === 'pop' ? 'count' : 'writeoff') as 'count' | 'writeoff', number: strOr(d.number, d.id), date: dateOf(d, 'Попис'),
    locationId: R('location', d.wh), shortageAccount: accountOrNull(d.konto) ?? '4690', surplusAccount: accountOrNull(d.konto2),
    lines: arr(d.lines).map((l) => ({ itemId: R('item', l.item), sys: num(l.sys), cnt: num(l.cnt), diff: num(l.diff), sp: num(l.sp), qty: num(l.qty) })).filter((l) => !!l.itemId) as { itemId: string }[],
    note: str(d.note),
  };
}

export function mapSalesDay(s: LDoc, R: Resolve) {
  const fisk = obj(s.fisk);
  const kind = (Object.keys(fisk).length || String(s.id).startsWith('zf-') || String(s.id).startsWith('mo-') ? 'fisk' : 'pos') as 'pos' | 'fisk';
  return {
    legacyId: s.id, kind, date: dateOf(s, 'Дневен извештај'), locationId: R('location', s.wh), number: str(fisk.z) ?? str(s.moNo) ?? str(s.number),
    groups: arr(s.groups).map((g) => ({ rate: int(g.rate, 18), ...(g.konto ? { konto: String(g.konto) } : {}), base: num(g.base), vat: num(g.vat) })),
    total: money(s.total), card: money(s.card), cardAccount: accountOrNull(s.cardKonto), count: int(s.count, 0),
    mk: Object.keys(obj(s.mk)).length ? (obj(s.mk) as Record<string, { g: number; v: number }>) : null,
    days: arr(s.days).length ? arr(s.days) : null, fisk: Object.keys(fisk).length ? fisk : null,
    lines: [], note: str(s.note), pending: !!s.pend,
  };
}

export function mapProduction(p: LDoc, R: Resolve, bomOf: (productLegacyId: string) => { itemId: string; qty: number }[]) {
  return {
    legacyId: p.id, number: strOr(p.number, p.id), date: dateOf(p, 'Производство'), productId: need(R('item', p.product), 'Производство без производ'),
    qty: dec(p.qty, 4), locationId: R('location', p.wh), mat: money(p.mat), lab: money(p.lab), unitCost: decOrNull(p.unit, 4),
    bom: bomOf(String(p.product)), note: str(p.note),
  };
}

/* ------------------------------------------------------------------ payroll */

const PAY_CATS = new Set(['reg', 'dop', 'bol', 'odm', 'kor', 'sin']);
export function mapPayroll(p: LDoc, R: Resolve) {
  const month = need(/^\d{4}-(0[1-9]|1[0-2])$/.test(String(p.month)) ? String(p.month) : null, `Плата ${p.id}: нема месец`);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const emps = arr(p.emps).map((e, i) => ({
    emp: {
      employeeId: R('employee', e.empId), pos: i + 1, no: str(e.no), name: strOr(e.name, '—'), embg: str(e.embg), netBase: money(e.netBase),
      grossBase: moneyOrNull(e.grossBase), coef: dec(num(e.coef) || 1, 4), stazY: decOrNull(e.stazY, 2), hNorm: decOrNull(e.hNorm, 2),
      short: !!e.short, union: !!e.union, noTax: !!e.noTax, adv: !!e.adv, inout: strOr(e.inout, 'full'), ioDate: isoDate(e.ioDate),
      gross: money(e.gross), contr: money(e.contr), tax: money(e.tax), net: money(e.net),
    },
    lines: arr(e.lines).map((l, j) => ({
      pos: j + 1, type: strOr(l.type, 'reg'), code: str(l.code), cat: PAY_CATS.has(String(l.cat)) ? String(l.cat) : 'reg',
      hours: dec(l.hours, 2), pct: decOrNull(l.pct, 2), amt: money(l.amt), payer: str(l.payer), mpin: str(l.mpin),
    })),
  }));
  return {
    head: {
      legacyId: p.id, month, date: isoDate(p.date) ?? last, params: obj(p.params), status: (arr(p.lines).length ? 'posted' : 'draft') as 'posted' | 'draft',
      locked: !!p.locked, source: p.fromXlsx ? 'xlsx' : 'cal', totals: {},
    },
    emps,
  };
}

/* ------------------------------------------------------------------ assets & year-end */

export function mapFixedAsset(a: LDoc) {
  return {
    legacyId: a.id, invNo: str(a.invNo), name: strOr(a.name, a.plate || '(основно средство)'), konto: accountOrNull(a.konto) ?? '0120',
    rate: dec(a.rate, 3), date: isoDate(a.date) ?? '2000-01-01', cost: money(a.cost), vehicleOnly: !!a.vehicleOnly, disposed: isoDate(a.disposed ?? a.outDate),
    serial: str(a.serial), barcode: str(a.barcode), supplier: str(a.supplier), invDoc: str(a.invDoc), location: str(a.location), note: str(a.note),
    data: rest(a, ['id', 'invNo', 'name', 'konto', 'rate', 'date', 'cost', 'vehicleOnly', 'disposed', 'serial', 'barcode', 'supplier', 'invDoc', 'location', 'note']),
  };
}
/** Fleet vehicle for an asset that is a vehicle (legacy `vehicle`/`plate` and rent-a-car fields on `assets`). */
export function mapFleetVehicle(a: LDoc) {
  if (!str(a.plate)) return null;
  return {
    plate: String(a.plate).trim(), name: str(a.name), trailer: !!a.trailer, active: !isoDate(a.disposed), rent: !!a.rent, rClass: str(a.rClass),
    rDay: moneyOrNull(a.rDay), rWeek: moneyOrNull(a.rWeek), rDep: moneyOrNull(a.rDep), rKm: a.rKm == null ? null : int(a.rKm), rKmX: moneyOrNull(a.rKmX),
    odo: a.odo == null ? null : int(a.odo), fuelNorm: decOrNull(a.fuelNorm, 2), capKg: a.capKg == null ? null : int(a.capKg),
    oilEvery: a.oilEvery == null ? null : int(a.oilEvery), oilLastKm: a.oilLastKm == null ? null : int(a.oilLastKm),
    tyreEvery: a.tyreEvery == null ? null : int(a.tyreEvery), tyreLastKm: a.tyreLastKm == null ? null : int(a.tyreLastKm),
    regExp: isoDate(a.regExp), insExp: isoDate(a.insExp), techExp: isoDate(a.techExp),
  };
}

/** VAT period of a legacy VAT-close journal (`ddv-2026-Т1` / `ddv-2026-03`, else from its date). */
export function vatPeriodOfJournal(j: LDoc, per: unknown) {
  const m = /^ddv-(\d{4}-(?:Т[1-4]|0[1-9]|1[0-2]))$/.exec(String(j.id));
  const period = m ? m[1]! : periodOf(String(j.date).slice(0, 10), per === 'month' ? 'month' : 'quarter');
  const [dateFrom, dateTo] = perRange(period);
  return { period, periodKind: (period.includes('-Т') ? 'quarter' : 'month') as 'month' | 'quarter', dateFrom, dateTo };
}

/* ------------------------------------------------------------------ office & HR */

export function mapDossier(d: LDoc) {
  return {
    category: strOr(d.sub, 'other'), title: str(d.title), number: str(d.number), date: isoDate(d.date), validTo: isoDate(d.validTo),
    partnerName: str(d.partnerName), note: str(d.note),
  };
}
export function mapInbox(d: LDoc) {
  return {
    fromOffice: !!d.office, subject: str(d.subject ?? d.title), note: str(d.note), fromName: str(d.from), done: !!d.done,
    doneAt: d.doneAt ? new Date(String(d.doneAt)) : null, createdAt: d.at ? new Date(String(d.at)) : new Date(),
  };
}
export function mapRecurring(d: LDoc, R: Resolve) {
  return {
    partnerId: need(R('partner', d.partner), 'Периодична фактура без купувач'), every: strOr(d.every, 'month'), day: strOr(d.day, '1'),
    next: isoDate(d.next), end: isoDate(d.end), dueDays: int(d.dueDays, 15),
    items: arr(d.items).map((it) => ({ itemId: R('item', it.itemId), name: strOr(it.name, '—'), qty: num(it.qty) || 1, price: num(it.price), vat: int(it.rate ?? it.vat, 18), ...(it.unit ? { unit: String(it.unit) } : {}) })),
    note: str(d.note), active: d.active !== false, mail: !!d.mail, last: isoDate(d.last),
  };
}
export function mapServiceContract(d: LDoc) {
  return {
    number: strOr(d.number, d.id), date: dateOf(d, 'Договор'), start: isoDate(d.start), end: isoDate(d.end), fee: money(d.fee),
    status: d.cliSig || d.offSig ? 'signed' : 'draft', data: rest(d, ['id', 'type', 'number', 'date', 'start', 'end', 'fee']),
  };
}
export function mapHrDoc(d: LDoc, R: Resolve) {
  return {
    employeeId: R('employee', d.emp ?? d.empId), kind: strOr(d.kind, 'doc'), no: need(str(d.no ?? d.number), 'HR документ без број'), date: dateOf(d, 'HR документ'),
    empName: strOr(d.empName ?? d.name, '—'), ctype: str(d.ctype), start: isoDate(d.start), end: isoDate(d.end), days: decOrNull(d.days, 1),
    position: str(d.position), refNo: str(d.refNo), transform: !!d.transform, code: str(d.code), title: str(d.title),
    snap: rest(d, ['id', 'type']),
  };
}

/* ------------------------------------------------------------------ industry modules */

export function mapHotelRoom(d: LDoc) {
  return { no: strOr(d.no, d.id), kind: str(d.kind), beds: int(d.beds, 2), floor: str(d.floor), price: money(d.price), active: d.active !== false, hk: str(d.hk) };
}
const HRES_ST = new Set(['resv', 'in', 'out', 'noshow', 'cancel']);
export function mapHotelReservation(d: LDoc, R: Resolve) {
  const from = need(isoDate(d.from), 'Резервација без датум од'), to = need(isoDate(d.to), 'Резервација без датум до');
  if (to <= from) throw new MapSkip('Резервација: датумот „до“ не е по „од“');
  return {
    number: strOr(d.number, d.id), date: isoDate(d.date) ?? from, roomId: need(R('hotel_room', d.room), 'Резервација без соба'), from, to,
    guestName: strOr(d.guestName, '—'), phone: str(d.phone), email: str(d.email), adults: int(d.adults, 1), children: int(d.children, 0),
    price: money(d.price), board: strOr(d.board, 'BB'), partnerId: R('partner', d.partner), src: str(d.src), advance: moneyOrNull(d.advance),
    guests: arr(d.guests), charges: arr(d.charges).map((c) => ({ ...c, itemId: R('item', c.itemId) })),
    status: (HRES_ST.has(String(d.status)) ? d.status : 'resv') as 'resv', note: str(d.note), noTax: !!d.noTax,
    inAt: d.inAt ? new Date(String(d.inAt)) : null, outAt: d.outAt ? new Date(String(d.outAt)) : null,
  };
}
const APPT_ST = new Set(['booked', 'arrived', 'done', 'noshow', 'cancel']);
export function mapAppointment(d: LDoc, R: Resolve) {
  return {
    date: dateOf(d, 'Термин'), time: strOr(d.time, '08:00'), dur: int(d.dur, 30), res: strOr(d.res, '—'), partnerId: R('partner', d.partner),
    client: str(d.client), phone: str(d.phone), email: str(d.email), svc: str(d.svc), price: moneyOrNull(d.price),
    status: (APPT_ST.has(String(d.status)) ? d.status : 'booked') as 'booked', note: str(d.note),
  };
}
export function mapConstructionProject(d: LDoc, R: Resolve) {
  return {
    code: strOr(d.code, d.id), name: strOr(d.name, d.code || '—'), site: str(d.site), city: str(d.city),
    investorId: need(R('partner', d.investor), 'Градежен проект без инвеститор'), cno: str(d.cno), cdate: isoDate(d.cdate),
    start: isoDate(d.start), end: isoDate(d.end), nadzor: str(d.nadzor), eng: str(d.eng), art32: !!d.art32,
    boq: arr(d.boq).map((b) => ({ ...(b.pos ? { pos: String(b.pos) } : {}), desc: strOr(b.desc, '—'), ...(b.unit ? { unit: String(b.unit) } : {}), qty: num(b.qty), price: num(b.price) })),
    status: (d.status === 'done' ? 'done' : 'open') as 'open' | 'done',
  };
}
export function mapConstructionSituation(d: LDoc, R: Resolve) {
  return {
    projectId: need(R('construction_project', d.proj), 'Ситуација без проект'), no: strOr(d.no, d.id), kind: (d.kind === 'fin' ? 'fin' : 'int') as 'int' | 'fin',
    date: dateOf(d, 'Ситуација'), from: isoDate(d.from), to: isoDate(d.to),
    cum: Object.fromEntries(Object.entries(obj(d.cum)).map(([k, v]) => [k, num(v)])),
  };
}
export function mapConstructionDiary(d: LDoc, R: Resolve) {
  return {
    projectId: need(R('construction_project', d.proj), 'Дневник без проект'), date: dateOf(d, 'Градежен дневник'), weather: str(d.weather), temp: str(d.temp),
    works: str(d.works), mat: str(d.mat), issues: str(d.issues), nadzor: str(d.nadzor),
    workers: arr(d.workers).map((w) => ({ emp: R('employee', w.emp) ?? String(w.emp ?? ''), name: strOr(w.name, '—'), hrs: num(w.hrs), rate: num(w.rate) })),
    mach: arr(d.mach).map((w) => ({ name: strOr(w.name, '—'), hrs: num(w.hrs), rate: num(w.rate) })),
  };
}
export function mapTravelArrangement(d: LDoc) {
  return {
    code: strOr(d.code, d.id), date: dateOf(d, 'Аранжман'), name: strOr(d.name, d.code || '—'), dest: str(d.dest), countries: arr(d.countries).map(String),
    from: isoDate(d.from), to: isoDate(d.to), kind: (d.kind === 'agent' ? 'agent' : 'own') as 'own' | 'agent', seats: d.seats == null ? null : int(d.seats),
    price: moneyOrNull(d.price), priceCh: moneyOrNull(d.priceCh), comm: decOrNull(d.comm, 2), prog: str(d.prog), incl: str(d.incl), excl: str(d.excl),
    costs: arr(d.costs).map((c) => ({ cat: strOr(c.cat, 'other'), who: c.who, desc: c.desc, amt: c.amt, cur: c.cur, fx: c.fx })),
    status: (['open', 'full', 'done', 'cancel'].includes(d.status) ? d.status : 'open') as 'open',
  };
}
export function mapTravelBooking(d: LDoc, R: Resolve) {
  const cli = obj(d.cli);
  return {
    arrangementId: need(R('travel_arrangement', d.arr), 'Резервација без аранжман'), number: strOr(d.number, d.id), date: dateOf(d, 'Резервација (тура)'),
    client: { name: strOr(cli.name, '—'), ...(cli.phone ? { phone: String(cli.phone) } : {}), ...(cli.email ? { email: String(cli.email) } : {}), ...(cli.addr ? { addr: String(cli.addr) } : {}) },
    partnerId: R('partner', d.partner), adults: int(d.adults, 1), children: int(d.children, 0), extra: moneyOrNull(d.extra), disc: moneyOrNull(d.disc),
    priceTot: moneyOrNull(d.priceTot), pax: arr(d.pax), pays: arr(d.pays).map((p) => ({ date: String(p.date ?? ''), amt: num(p.amt), how: String(p.how ?? ''), no: p.no ?? null })),
    room: str(d.room), note: str(d.note), status: (d.status === 'cancel' ? 'cancel' : 'resv') as 'resv' | 'cancel',
  };
}
const RENT_ST = new Set(['resv', 'out', 'ret', 'cancel']);
export function mapRentRental(d: LDoc, R: Resolve) {
  const drv = obj(d.drv);
  return {
    number: strOr(d.number, d.id), date: isoDate(d.date) ?? need(isoDate(d.from), 'Изнајмување без датум'),
    vehicleId: need(R('vehicle', d.veh), 'Изнајмување без возило'), plate: strOr(d.plate, '—'), from: strOr(d.from, ''), to: strOr(d.to, ''),
    driver: { ...rest(drv, ['scans']), name: strOr(drv.name, '—') } as { name: string }, driver2: d.drv2 ? JSON.stringify(d.drv2) : null,
    partnerId: R('partner', d.partner), deposit: moneyOrNull(d.deposit), extras: arr(d.extras).map((e) => ({ name: strOr(e.name, '—'), qty: num(e.qty), price: num(e.price) })),
    status: (RENT_ST.has(String(d.status)) ? d.status : 'resv') as 'resv', note: str(d.note),
    out: rest(obj(d.out), ['photos', 'sig']), ret: rest(obj(d.ret), ['photos', 'sig']), pDay: moneyOrNull(d.pDay), countries: arr(d.countries).length ? arr(d.countries).map(String) : ['MK'],
    green: !!d.green, depositKept: moneyOrNull(d.depKept), depositClosed: !!d.depClosed,
  };
}
const FRT_ST = new Set(['plan', 'road', 'done', 'inv', 'cancel']);
export function mapFreightTour(d: LDoc, R: Resolve) {
  return {
    number: strOr(d.number, d.id), date: dateOf(d, 'Тура'), status: (FRT_ST.has(String(d.status)) ? d.status : 'plan') as 'plan', partnerId: R('partner', d.partner),
    orderNo: str(d.order), km: d.km == null || d.km === '' ? null : int(d.km), vehicleId: R('vehicle', d.vehicleId), trailer: str(d.trailer),
    driverId: R('employee', d.driverId), driver2Id: R('employee', d.driver2Id), loadPlace: str(d.loadPlace), loadC: str(d.loadC), sender: str(d.sender),
    unloadDate: isoDate(d.unloadDate), unloadPlace: str(d.unloadPlace), unloadC: str(d.unloadC), consignee: str(d.consignee), goods: str(d.goods),
    packages: str(d.packages), kg: decOrNull(d.kg, 2), m3: decOrNull(d.m3, 2), adr: str(d.adr), docsAtt: str(d.docsAtt), price: moneyOrNull(d.price),
    cur: strOr(d.cur, 'EUR'), fx: decOrNull(d.fx, 6), vat: (d.vat === 'dom' ? 'dom' : 'intl') as 'intl' | 'dom', red: int(d.red, 100),
    tolls: moneyOrNull(d.tolls), tollCur: str(d.tollCur), otherCost: moneyOrNull(d.otherCost), note: str(d.note),
    segs: arr(d.segs).map((s) => ({ c: String(s.c ?? ''), in: String(s.in ?? ''), out: String(s.out ?? ''), units: s.units ?? null })),
  };
}

/* ------------------------------------------------------------------ catch-all */

/** Any legacy `docs` record without its own table (or that failed its table) → `firm_docs`. */
export function mapFirmDoc(d: LDoc, type?: string) {
  return { type: type ?? strOr(d.type, 'doc'), number: str(d.number ?? d.no), date: isoDate(d.date), data: rest(d, ['id']), status: d.status && typeof d.status === 'string' ? d.status : 'active' };
}

/** Users (legacy `appusers`). The plaintext initial password `pw0` is never imported (LEGACY-MAP 11.2). */
const ROLES = new Set(['admin', 'senior', 'acc', 'oper', 'teren', 'view', 'klient']);
export function mapUser(u: Record<string, unknown>) {
  const username = String(u.username ?? '').trim().toLowerCase();
  if (!username) throw new MapSkip('Корисник без корисничко име');
  if (!str(u.hash)) throw new MapSkip(`Корисникот „${username}“ нема лозинка во копијата`);
  const firms = arr(u.firms).map(String);
  return {
    legacyId: String(u.id), username, name: strOr(u.name, username), email: str(u.email), role: (ROLES.has(String(u.role)) ? u.role : 'view') as 'view',
    allFirms: firms.includes('*'), passwordHash: String(u.hash), legacySalt: str(u.salt) ?? '', mustChangePassword: false, active: u.active !== false,
    firms: firms.filter((f) => f !== '*'),
  };
}

/** Check that `postingContextOf` is used consistently by the writer and the ledger (re-export for the writer). */
export { postingContextOf };
