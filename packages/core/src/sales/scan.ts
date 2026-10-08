/**
 * Post-processing of AI-read (or UBL-imported) invoices into editable drafts — legacy `fixLines`, `fixRates`,
 * `purConsistent`, `fixSaleQty`, `matchItem`, `draftFromScan`, `outFindPartner`, `outDraft`, `batchDup`, `ownerCheck`
 * (index.html 4643–4705, 5354, 8392–8401, 11252, 12876–12896). Pure: the caller passes partners and items.
 */
import { r2 } from '../money';
import { calcLines } from '../vat';
import { normDocNo } from './docs';

export interface ScanLine { code?: string; barcode?: string; name?: string; unit?: string; qty?: number | string; price?: number | string; discount?: number | string; amount?: number | string; rate?: number | string }
export interface ScanGroup { rate?: number | string; base?: number | string; vat?: number | string; kind?: string }
/** One invoice as returned by `PUR_PROMPT` / `SALE_PROMPT` / `ublToScan`. */
export interface ScanInvoice {
  supplierName?: string; supplierEdb?: string; buyerName?: string; buyerEdb?: string; buyerAddress?: string; buyerCity?: string;
  number?: string; date?: string; dueDate?: string; art32?: boolean;
  groups?: ScanGroup[]; lines?: ScanLine[]; total?: number | string;
  /** UBL CreditNote (amounts negative). */
  credit?: boolean;
  currency?: string;
}
/** A prompt result: one invoice, or several (`{invoices:[…]}`). */
export type ScanResult = ScanInvoice & { invoices?: ScanInvoice[] };

const n = (v: unknown) => Number(v) || 0;
const isoDate = (s: unknown) => (typeof s === 'string' && /^\d{4}-\d\d-\d\d$/.test(s) ? s : '');

/** Split a result into its invoices (legacy: `r.invoices` with more than one entry → batch). */
export const scanInvoices = (r: ScanResult | null | undefined): ScanInvoice[] =>
  !r ? [] : Array.isArray(r.invoices) && r.invoices.length ? r.invoices : [r];

/** Legacy `fixLines` (4688): repair qty/price read with the wrong decimal scale using the printed amount. */
export function fixLines(lines: readonly ScanLine[] | undefined): ScanLine[] {
  const near = (x: number, y: number) => y > 0 && Math.abs(x - y) / y <= 0.02;
  return (lines ?? []).map((l0) => {
    const l = { ...l0 };
    let q = n(l.qty), pr = n(l.price);
    const am = n(l.amount), disc = n(l.discount);
    const eff = (x: number) => x * (1 - disc / 100);
    if (am > 0) {
      if (q > 0 && pr > 0 && !near(q * pr, am) && !near(q * eff(pr), am)) {
        const cq = [q / 1000, q / 100, q / 10, q * 1000].find((c) => near(c * pr, am) || near(c * eff(pr), am));
        const cp = [pr / 1000, pr / 100, pr * 100, pr * 1000].find((c) => near(q * c, am));
        if (cq) q = cq;
        else if (cp) pr = cp;
        else {
          const q2 = am / pr;
          if (q2 > 0 && Math.abs(q2 - Math.round(q2 * 1000) / 1000) < 0.001) q = Math.round(q2 * 1000) / 1000;
          else pr = Math.round((am / q) * 10000) / 10000;
        }
      } else if (q > 0 && !pr) pr = Math.round((am / q) * 10000) / 10000;
      else if (!q && pr > 0) q = Math.round((am / pr) * 1000) / 1000;
    }
    l.qty = q;
    l.price = pr;
    return l;
  });
}

const lineAmt = (l: ScanLine) => n(l.amount) || n(l.qty) * n(l.price) * (1 - n(l.discount) / 100);

/** Legacy `fixRates` (4674): move lines between VAT rates until the per-rate sums match the recapitulation. */
export function fixRates<T extends ScanInvoice>(r: T): T {
  const G = (r.groups ?? []).filter((g) => n(g.base));
  if (G.length < 2 || !(r.lines ?? []).length) return r;
  const L = r.lines!;
  for (let k = 0; k < 5; k++) {
    const d = G.map((g) => ({ g, x: L.filter((l) => n(l.rate || 18) === n(g.rate)).reduce((a, l) => a + lineAmt(l), 0) - n(g.base) }));
    const hi = d.find((z) => z.x > Math.max(2, n(z.g.base) * 0.005)), lo = d.find((z) => z.x < -Math.max(2, n(z.g.base) * 0.005));
    if (!hi || !lo) break;
    const need = Math.min(hi.x, -lo.x);
    const c = L.filter((l) => n(l.rate || 18) === n(hi.g.rate));
    let ln = c.find((l) => Math.abs(lineAmt(l) - need) <= Math.max(1, need * 0.01));
    if (!ln) {
      outer: for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) {
        if (Math.abs(lineAmt(c[i]!) + lineAmt(c[j]!) - need) <= Math.max(1, need * 0.01)) { c[i]!.rate = n(lo.g.rate); ln = c[j]; break outer; }
      }
    }
    if (!ln) break;
    ln.rate = n(lo.g.rate);
  }
  return r;
}

/** Legacy `purConsistent` (4669): lines, recapitulation and total agree (used to decide on a second, deeper read). */
export function scanConsistent(r: ScanInvoice | null | undefined, strict = false): boolean {
  if (!r) return false;
  const L = fixLines(r.lines);
  const G = (r.groups ?? []).filter((g) => n(g.base));
  const gb = G.reduce((a, g) => a + n(g.base), 0), gv = G.reduce((a, g) => a + n(g.vat), 0);
  if (!G.length && !L.length) return false;
  const tot = Math.abs(n(r.total));
  if (tot && G.length && Math.abs(Math.abs(gb + (r.art32 ? 0 : gv)) - tot) > Math.max(2, tot * 0.005)) return false;
  if (L.length && G.length) {
    const lb = L.reduce((a, l) => a + lineAmt(l), 0);
    if (Math.abs(lb - gb) > Math.max(2, Math.abs(gb) * 0.01)) return false;
    if (strict) for (const g of G) {
      const lr = L.filter((l) => n(l.rate || 18) === n(g.rate)).reduce((a, l) => a + (n(l.amount) || n(l.qty) * n(l.price)), 0);
      if (Math.abs(lr - n(g.base)) > Math.max(2, Math.abs(n(g.base)) * 0.01)) return false;
    }
  }
  for (const g of G) if (!r.art32 && n(g.rate) && Math.abs((n(g.base) * n(g.rate)) / 100 - n(g.vat)) > Math.max(1, Math.abs((n(g.base) * n(g.rate)) / 100) * 0.01)) return false;
  return true;
}
export const scanResultConsistent = (r: ScanResult | null | undefined) => !!r && scanInvoices(r).every((x) => scanConsistent(x));

/** Legacy `fixSaleQty` (8392): quantity taken from the VAT-rate column. */
export function fixSaleQty<T extends ScanInvoice>(r: T): T {
  const L = r.lines ?? [];
  const G = (r.groups ?? []).filter((g) => n(g.base));
  if (!L.length) return r;
  for (const l of L) {
    const q = n(l.qty), p = n(l.price), a = n(l.amount);
    if (a > 0 && p > 0 && q > 0 && Math.abs(q * p - a) > Math.max(0.5, a * 0.01)) {
      const q2 = a / p;
      if (Math.abs(q2 - Math.round(q2)) < 0.01) l.qty = Math.round(q2);
      else if (Math.abs(q2 - Math.round(q2 * 1000) / 1000) < 0.002) l.qty = Math.round(q2 * 1000) / 1000;
    }
  }
  for (const g of G) {
    const LL = L.filter((l) => n(l.rate || 18) === n(g.rate));
    const A = (l: ScanLine) => n(l.qty) * n(l.price);
    const sum = LL.reduce((x, l) => x + A(l), 0);
    if (Math.abs(sum - n(g.base)) <= Math.max(1, n(g.base) * 0.005)) continue;
    const sus = LL.filter((l) => [5, 10, 18].includes(n(l.qty)) && (n(l.qty) === n(l.rate) || n(l.qty) === n(g.rate)));
    if (sus.length === 1) {
      const l = sus[0]!;
      const need = n(g.base) - (sum - A(l));
      const q = need / (n(l.price) || 1);
      if (q > 0 && Math.abs(q - Math.round(q * 1000) / 1000) < 0.01) {
        l.qty = Math.abs(q - Math.round(q)) < 0.02 ? Math.round(q) : Math.round(q * 1000) / 1000;
        l.amount = Math.round(need * 100) / 100;
      }
    }
  }
  return r;
}

/* ------------------------------------------------------------------ matching */

export interface MatchItem {
  id: string; name: string; code?: string | null; type?: string | null; unit?: string | null; rate?: number | null;
  barcodes?: readonly string[]; aliases?: readonly string[];
  /** Supplier item codes: partner id → code (legacy `supCodes`; key '' = unknown supplier). */
  supCodes?: Readonly<Record<string, string>>;
}
export interface MatchPartner { id: string; name: string; edb?: string | null }

/** Legacy `matchItem` (4643 → 11252): barcode → supplier code → any supplier code → name/alias → contained name. */
export function matchItem(items: readonly MatchItem[], name?: string, code?: string, barcode?: string, partnerId?: string | null): MatchItem | null {
  const nm = String(name ?? '').toLowerCase().trim();
  const bc = String(barcode ?? '').replace(/\D/g, '');
  const cd = String(code ?? '').trim();
  if (bc.length >= 8) { const x = items.find((i) => (i.barcodes ?? []).includes(bc)); if (x) return x; }
  if (cd && partnerId) { const x = items.find((i) => i.supCodes?.[partnerId] === cd); if (x) return x; }
  if (cd) { const x = items.find((i) => Object.values(i.supCodes ?? {}).includes(cd)); if (x) return x; }
  if (!nm) return null;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const ex = items.find((i) => norm(i.name) === nm || (i.aliases ?? []).some((a) => norm(a) === nm));
  if (ex) return ex;
  if (nm.length < 5) return null;
  return items.find((i) => i.name.length >= 5 && (nm.includes(i.name.toLowerCase()) || i.name.toLowerCase().includes(nm))) ?? null;
}

const edbDigits = (e: unknown) => String(e ?? '').replace(/\D/g, '');
/** Partner by ЕДБ (last 7 digits, legacy) or exact name. */
export function matchPartner(partners: readonly MatchPartner[], name?: string, edb?: string): MatchPartner | null {
  const ed = edbDigits(edb);
  const low = String(name ?? '').toLowerCase().trim();
  return partners.find((x) => ed.length >= 7 && edbDigits(x.edb).endsWith(ed.slice(-7)))
    ?? partners.find((x) => low && x.name.toLowerCase().trim() === low) ?? null;
}

/* ------------------------------------------------------------------ owner check */

/**
 * "The document belongs to another firm" guard (legacy `ownerCheck`, 12880).
 * FIX (LEGACY-MAP 3.4 item 9): legacy ran it whenever the prompt text contained "buyerEdb", so every scanned *sales*
 * invoice was checked as if our firm were the buyer, and multi-invoice results skipped it. Now it is explicit per
 * document kind and runs on every invoice of a result: a purchase must name our firm as the buyer (when a buyer ЕДБ
 * was read); a sales invoice must not.
 */
export function ownerCheck(kind: 'purchase' | 'sale', r: ScanInvoice, ownEdb: string | null | undefined): string | null {
  const own = edbDigits(ownEdb), buyer = edbDigits(r.buyerEdb);
  if (own.length < 7 || buyer.length < 7) return null;
  const same = buyer.slice(-7) === own.slice(-7);
  if (kind === 'purchase' && !same) return `Купувачот на документот (ЕДБ ${buyer}) не е оваа фирма – можеби документот е за друга фирма.`;
  if (kind === 'sale' && same) return 'Купувачот на документот е оваа фирма – ова е влезна, не излезна фактура.';
  return null;
}

/* ------------------------------------------------------------------ duplicates */

export interface DupCandidate { id?: string; partnerId?: string | null; partnerEdb?: string | null; number?: string | null; total: number; date?: string | null }

/**
 * One duplicate rule for invoices and purchases: same partner (id or ЕДБ) + same normalized number + same amount (±1).
 * FIX (LEGACY-MAP 3.4 item 10): legacy had three different rules (`purDups` number+date and auto-delete of the
 * "older" one, `batchDup` number && (partner || total), `savePur` number && (partner || total || date)).
 * The sha256 of an attached file is checked separately (`files.sha256`).
 */
export function findDuplicate<T extends DupCandidate>(c: DupCandidate, existing: readonly T[]): T | null {
  const nn = normDocNo(c.number);
  if (!nn) return null;
  const ce = edbDigits(c.partnerEdb);
  return existing.find((x) => {
    if (x.id && c.id && x.id === c.id) return false;
    if (normDocNo(x.number) !== nn) return false;
    if (Math.abs(x.total - c.total) > 1) return false;
    if (c.partnerId && x.partnerId) return c.partnerId === x.partnerId;
    const xe = edbDigits(x.partnerEdb);
    if (ce.length >= 7 && xe.length >= 7) return ce.slice(-7) === xe.slice(-7);
    return true;
  }) ?? null;
}

/* ------------------------------------------------------------------ drafts */

export interface ScanPurchaseLine {
  itemId: string; name: string; code: string; barcode: string; qty: number; price: number; amount: number;
  unit?: string; rate?: number; isNew?: boolean; type?: 'goods' | 'material'; sp?: number | '';
}
export interface ScanPurchaseDraft {
  number: string; date: string; docDate: string; due: string; partnerId: string; supplierName: string; supplierEdb: string;
  art32: boolean; ptype: 'stock' | 'cost'; cash: boolean; warehouseId: string | null;
  groups: { konto: string; rate: number; base: number; vat: number }[];
  stock: ScanPurchaseLine[];
  /** VAT period of the document date was closed → booked on `date` (legacy `autoShift`). */
  shifted: boolean;
  credit: boolean;
}
export interface PurchaseDraftOptions {
  partners: readonly MatchPartner[];
  items: readonly MatchItem[];
  /** Kontos per AI group kind. */
  accounts: { goods: string; material: string; other: string };
  today: string;
  /** Batch options (legacy `scanCash`, `scanWh`, `scanCost`). */
  cash?: boolean; warehouseId?: string | null; costOnly?: boolean;
  defMargin?: number; mgRound?: number;
  /** VAT period of a date already closed (legacy `ddvClosed`). */
  vatClosed?: (date: string) => boolean;
}

/**
 * Purchase draft from a scan (legacy `draftFromScan`, 4695).
 * FIX (LEGACY-MAP 3.4 item 3): the kind → konto map no longer hard-codes 4100 (rail transport) for services, 4010
 * (office material) for energy, 4400 (per diems) for "other" and 0130 for assets: goods → stock konto, material →
 * material konto, everything else → the purchase default konto of the scheme (to be refined by the user).
 * FIX (item 17): legacy built the object with `docDate` twice.
 */
export function purchaseDraftFromScan(r0: ScanInvoice, o: PurchaseDraftOptions): ScanPurchaseDraft {
  let r: ScanInvoice = fixSaleQty({ ...r0, lines: (r0.lines ?? []).map((l) => ({ ...l })) });
  r = { ...r, lines: fixLines(r.lines) };
  const p = matchPartner(o.partners, r.supplierName, r.supplierEdb);
  const goodsInv = (r.groups ?? []).some((g) => g.kind === 'goods' || g.kind === 'material') || !!o.warehouseId;
  const onlyMat = (r.groups ?? []).some((g) => g.kind === 'material') && !(r.groups ?? []).some((g) => g.kind === 'goods');
  const mg = o.defMargin || 25, rd = o.mgRound || 1;
  const st: ScanPurchaseLine[] = [];
  for (const l of r.lines ?? []) {
    const it = matchItem(o.items, l.name, l.code, l.barcode, p?.id);
    if (it && it.type === 'service') continue;
    if (it) { st.push({ itemId: it.id, name: String(l.name ?? ''), code: String(l.code ?? ''), barcode: String(l.barcode ?? ''), qty: n(l.qty), price: n(l.price), amount: n(l.amount) }); continue; }
    if (!(goodsInv && n(l.qty))) continue;
    const rt = n(l.rate) || 18;
    st.push({
      itemId: '', name: String(l.name ?? ''), code: String(l.code ?? ''), barcode: String(l.barcode ?? ''), amount: n(l.amount), unit: l.unit || 'ком',
      rate: rt, qty: n(l.qty), price: n(l.price), isNew: true, type: onlyMat ? 'material' : 'goods',
      sp: n(l.price) ? r2(Math.round((n(l.price) * (1 + mg / 100) * (1 + rt / 100)) / rd) * rd) : '',
    });
  }
  const kmap = (k?: string) => (k === 'goods' ? o.accounts.goods : k === 'material' ? o.accounts.material : o.accounts.other);
  let G = (r.groups ?? []).filter((g) => n(g.base) || n(g.vat));
  if (!G.length && (r.lines ?? []).length) {
    const by = new Map<number, number>();
    for (const l of r.lines!) { const rt = n(l.rate) || 18; by.set(rt, (by.get(rt) ?? 0) + n(l.qty) * n(l.price)); }
    G = [...by].filter(([, b]) => b).map(([rt, b]) => ({ rate: rt, base: r2(b), vat: r.art32 ? 0 : r2((b * rt) / 100), kind: 'goods' }));
  }
  if (!G.length && n(r.total)) G = [{ rate: 18, base: r2(n(r.total) / 1.18), vat: r.art32 ? 0 : r2(n(r.total) - n(r.total) / 1.18), kind: 'other' }];
  const groups = (G.length ? G : [{ rate: 18, base: 0, vat: 0 }]).map((g) => ({
    rate: n(g.rate), base: n(g.base), vat: r.art32 ? 0 : n(g.vat) || r2((n(g.base) * n(g.rate)) / 100), konto: kmap(g.kind),
  }));
  const dd = isoDate(r.date);
  const shifted = !!dd && !!o.vatClosed?.(dd);
  const stock = o.costOnly ? [] : st;
  return {
    number: String(r.number ?? '').trim(), docDate: dd, due: isoDate(r.dueDate), date: !dd || shifted ? o.today : dd, shifted,
    partnerId: p?.id ?? '', supplierName: String(r.supplierName ?? ''), supplierEdb: String(r.supplierEdb ?? ''),
    art32: !!r.art32, cash: !!o.cash, warehouseId: o.warehouseId ?? null,
    ptype: o.costOnly ? 'cost' : stock.length || goodsInv ? 'stock' : 'cost',
    groups, stock, credit: !!r.credit,
  };
}

export interface ScanSaleDraft {
  number: string; date: string; due: string; partnerId: string; art32: boolean;
  buyer: { name: string; edb: string; address: string; city: string };
  items: { itemId: string; name: string; unit: string; qty: number; price: number; disc: number; rate: number; konto: string }[];
  total: number;
}

/**
 * Sales-invoice draft from a scan (legacy `outDraft`, 8396).
 * FIX (LEGACY-MAP 3.4 item 16): art. 32-a lines get rate 18 (legacy 0 here, 18 in the editor — masked by `calcLines`);
 * the revenue konto comes from the scheme (`revDefault`) instead of the literal '7400'.
 */
export function saleDraftFromScan(r0: ScanInvoice, o: { partners: readonly MatchPartner[]; items: readonly MatchItem[]; revKonto: string; today: string; nextNumber: string }): ScanSaleDraft {
  let r: ScanInvoice = fixSaleQty({ ...r0, lines: (r0.lines ?? []).map((l) => ({ ...l })) });
  r = { ...r, lines: fixLines(r.lines) };
  const p = matchPartner(o.partners, r.buyerName, r.buyerEdb);
  let items = (r.lines ?? []).filter((l) => l.name || n(l.amount)).map((l) => {
    const it = matchItem(o.items, l.name, l.code, l.barcode, null);
    let q = n(l.qty) || 1;
    if (Math.abs(q - Math.round(q)) < 0.01) q = Math.round(q);
    const am = n(l.amount), pp = n(l.price);
    const pr = pp && (!am || Math.abs(r2(q * pp) - am) <= 0.011) ? pp : am && q ? Math.round((am / q) * 100) / 100 : pp;
    return { itemId: it?.id ?? '', name: it ? it.name : String(l.name ?? ''), unit: l.unit || it?.unit || 'ком', qty: q, price: pr, disc: 0, rate: r.art32 ? 18 : n(l.rate) || (l.rate === 0 ? 0 : 18), konto: o.revKonto };
  });
  if (!items.length) items = (r.groups ?? []).filter((g) => n(g.base)).map((g) => ({ itemId: '', name: 'Според фактура ' + (r.number ?? ''), unit: '', qty: 1, price: n(g.base), disc: 0, rate: r.art32 ? 18 : n(g.rate), konto: o.revKonto }));
  const total = n(r.total);
  if (total && items.length) {
    const c = calcLines(items, r.art32);
    if (Math.abs(c.total - total) > Math.max(2, total * 0.005) && Math.abs(c.base - total) <= Math.max(2, total * 0.005)) {
      for (const l of items) l.price = Math.round((l.price / (1 + l.rate / 100)) * 10000) / 10000;
    }
  }
  const dd = isoDate(r.date) || o.today;
  return {
    number: String(r.number ?? '').trim() || o.nextNumber, date: dd, due: isoDate(r.dueDate), partnerId: p?.id ?? '', art32: !!r.art32,
    buyer: { name: String(r.buyerName ?? ''), edb: String(r.buyerEdb ?? '').replace(/[^\dA-Za-z]/g, ''), address: String(r.buyerAddress ?? ''), city: String(r.buyerCity ?? '') },
    items, total,
  };
}

/** Batch status of a read purchase (legacy `batchCheck`, 5355): `ok` | `check` | `dup` with the reason. */
export function batchStatus(d: ScanPurchaseDraft, raw: ScanInvoice | null, dup: { date?: string | null } | null, owner: string | null): { status: 'ok' | 'check' | 'dup'; msg: string } {
  if (dup) return { status: 'dup', msg: 'веќе е заведена' + (dup.date ? ' (' + dup.date.split('-').reverse().join('.') + ')' : '') };
  const why: string[] = [];
  if (!d.partnerId && !d.supplierName) why.push('нема добавувач');
  if (!d.number) why.push('нема број');
  if (!d.groups.some((g) => g.base)) why.push('нема износ');
  if (raw && !scanConsistent(raw)) why.push('износите не се совпаѓаат со рекапитулацијата');
  if (owner) why.push(owner);
  if (d.credit) why.push('одобрение (CreditNote) – проверете');
  return why.length ? { status: 'check', msg: why.join(', ') } : { status: 'ok', msg: '' };
}

/** Purchase total from groups (legacy `purTotal`). */
export const purchaseTotal = (p: { art32?: boolean; groups: readonly { base: number | string; vat: number | string }[] }) =>
  r2(p.groups.reduce((s, g) => s + n(g.base) + (p.art32 ? 0 : n(g.vat)), 0));
