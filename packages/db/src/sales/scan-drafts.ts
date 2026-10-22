/**
 * Turn a read result into review drafts (legacy `scanFile` / `batchRun` → `draftFromScan` + `batchCheck`, and
 * `outRun` → `outDraft`). Loads the firm's partners, items, duplicates, closed VAT periods, the suppliers' kontos of
 * their last saved purchase and the electricity konto. Used by the read job (worker) and by „↻ Примени ги правилата
 * повторно“ (web), which rebuilds the drafts of unsaved reads from their stored result ({@link rebuildScanDrafts}).
 */
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { calcLines, periodOf, schemeValue } from '@wise/core';
import { todaySkopje } from '@wise/core/office/dates';
import {
  NO_VAT_NOTE_MSG, batchStatus, energyKontoFromChart, findDuplicate, mergeAttachedInvoices, normDocNo, notInvoiceMsg, scanContentSig, nextDocNumber, isOwnParty, ownerCheck, prevDebtFix, purchaseDraftFromScan, purchaseTotal,
  saleDraftFromScan, scanInvoices, scanNoVatRule, type ScanPurchaseDraft, supplierKontoMemory, type MatchItem, type ScanResult, type SupplierKontoMemory,
} from '@wise/core/sales';
import { accountKey } from '@wise/core/bank/mk-banks';
import { classifyPartnerId, type DraftPartnerMatch, type MatchablePartnerRow } from '@wise/core/partners/match';
import { audit, type Tx } from '../audit';
import { firmPostingContext } from '../bank/context';
import { effectiveChart } from '../ledger-queries';
import {
  aiDocuments, bankAccounts, invoices, itemBarcodes, items, itemSupplierCodes, journals, partners, purchases, purchaseVatGroups,
  type AiDocument, type AiDraft, type Firm,
} from '../schema/index';
import { ensurePartner } from './partners-auto';

export async function matchData(db: Tx, firmId: string) {
  const [P, I, B, C] = await Promise.all([
    db.select({ id: partners.id, name: partners.name, code: partners.code, edb: partners.edb, embs: partners.embs, bankAccount: partners.bankAccount, bankName: partners.bankName, data: partners.data })
      .from(partners).where(eq(partners.firmId, firmId)),
    db.select().from(items).where(and(eq(items.firmId, firmId), eq(items.active, true))),
    db.select().from(itemBarcodes).where(eq(itemBarcodes.firmId, firmId)),
    db.select().from(itemSupplierCodes).where(eq(itemSupplierCodes.firmId, firmId)),
  ]);
  const its: MatchItem[] = I.map((i) => ({
    id: i.id, name: i.name, code: i.code, type: i.type, unit: i.unit, rate: i.vatRate,
    barcodes: B.filter((b) => b.itemId === i.id).map((b) => b.barcode),
    aliases: ((i.data as Record<string, unknown>).aliases as string[] | undefined) ?? [],
    supCodes: Object.fromEntries(C.filter((c) => c.itemId === i.id).map((c) => [c.partnerId ?? '', c.code])),
  }));
  return { partners: P as MatchablePartnerRow[], items: its };
}

/** Who started the read (audit of automatically created partners). */
export interface DraftOpts { userId?: string | null }

/**
 * No partner matched and no similar candidate: the partner is created from the document (name, ЕДБ or ЕМБС in its own
 * field, address, city, bank account) — undone with „откажи“ while the document is a draft. Similar candidates are
 * asked instead, so no duplicate is created; the same ЕДБ / ЕМБС is never created twice (`ensurePartner`).
 */
async function autoPartner(db: Tx, f: Firm, o: DraftOpts, M: { partners: MatchablePartnerRow[] }, x: { name: string; id: string; address?: string; city?: string; bankAccount?: string; type: 'customer' | 'supplier' }, m: DraftPartnerMatch | undefined): Promise<{ id: string; match: DraftPartnerMatch } | null> {
  if (!x.name.trim() || m?.candidates.length) return null;
  const k = classifyPartnerId(x.id);
  const r = await ensurePartner(db, f.id, {
    name: x.name, edb: x.id, address: x.address, city: x.city, bankAccount: x.bankAccount || null, type: x.type,
    vatRegistered: k.kind === 'edb' ? /^MK/i.test(k.store) || x.type === 'supplier' : x.type === 'supplier',
  });
  if (r.created) {
    await audit(db, { userId: o.userId ?? null, firmId: f.id, action: 'scanAutoPartner', entityType: 'partner', entityId: r.id, data: { name: x.name.trim(), [k.kind || 'id']: k.store } });
    M.partners.push({ id: r.id, name: x.name.trim(), edb: k.kind === 'edb' ? k.store : null, embs: k.kind === 'embs' ? k.value : null });
  }
  return { id: r.id, match: { ...(m ?? { idKind: k.kind, id: k.store, candidates: [] }), by: r.created ? 'new' : 'exact', partner: { id: r.id, name: x.name.trim(), code: r.code }, ...(r.created ? { created: true } : {}) } };
}

/**
 * Version of the deterministic draft rules. Raise it when the rules change: unsaved reads built with an older version
 * are rebuilt from their stored result when their list or draft is opened (`options.rulesV`, {@link refreshStaleScanDrafts}).
 *   2 — attached pages merged, supplier konto memory, electricity konto, previous debt left out of the total
 *   3 — an outgoing invoice without VAT and without a note follows the firm's rule (`scanNoVat`, default чл. 24 → field 08)
 *   4 — an outgoing read without lines and amount (a work order / service confirmation) is not an invoice: archived
 *   5 — „испратница“ with a VAT recapitulation and an amount is an invoice (not put aside)
 *   6 — documents paid in cash follow the firm's cash rules (`settings.cashScan`: fuel → 4033, the rest → 4199…), a
 *       fiscal receipt without a number gets one
 */
export const SCAN_RULES_V = 6;

/** Each supplier's expense kontos of its most recent saved purchase (by booking date). */
async function lastSupplierKontos(db: Tx, firmId: string): Promise<Map<string, SupplierKontoMemory>> {
  const P = await db.select({ id: purchases.id, partnerId: purchases.partnerId }).from(purchases)
    .where(and(eq(purchases.firmId, firmId), sql`${purchases.partnerId} is not null`))
    .orderBy(desc(purchases.date), desc(purchases.createdAt));
  const last = new Map<string, string>();
  for (const p of P) if (!last.has(p.partnerId!)) last.set(p.partnerId!, p.id);
  if (!last.size) return new Map();
  const G = await db.select({ purchaseId: purchaseVatGroups.purchaseId, account: purchaseVatGroups.account, rate: purchaseVatGroups.rate, base: purchaseVatGroups.base })
    .from(purchaseVatGroups).where(inArray(purchaseVatGroups.purchaseId, [...last.values()]));
  const out = new Map<string, SupplierKontoMemory>();
  for (const [pid, id] of last) {
    const m = supplierKontoMemory(G.filter((g) => g.purchaseId === id));
    if (m) out.set(pid, m);
  }
  return out;
}

/**
 * Invoices of the firm's other purchase reads by content ({@link scanContentSig}): a pro-forma and its invoice (or two
 * photos of one document) have the same supplier, lines and total under different numbers.
 */
async function readSigs(db: Tx, firmId: string, exceptId: string | null | undefined): Promise<Map<string, { number: string; date: string; proforma: boolean }>> {
  const D = await db.select({ id: aiDocuments.id, result: aiDocuments.result }).from(aiDocuments)
    .where(and(eq(aiDocuments.firmId, firmId), eq(aiDocuments.kind, 'purchase'), inArray(aiDocuments.status, ['done', 'saved']), exceptId ? ne(aiDocuments.id, exceptId) : undefined))
    .orderBy(desc(aiDocuments.createdAt)).limit(300);
  const out = new Map<string, { number: string; date: string; proforma: boolean }>();
  for (const d of D) {
    const r = d.result as ScanResult | null;
    if (!r || typeof r !== 'object' || 'split' in r) continue;
    for (const x of scanInvoices(r)) {
      const sig = scanContentSig(x);
      if (sig && !out.has(sig)) out.set(sig, { number: String(x.number ?? ''), date: String(x.date ?? ''), proforma: !!notInvoiceMsg(x) });
    }
  }
  return out;
}

export async function purchaseDrafts(db: Tx, f: Firm, r: ScanResult, opts: { cash?: boolean; warehouseId?: string | null; costOnly?: boolean; docId?: string | null }, o: DraftOpts = {}): Promise<AiDraft[]> {
  const ctx = await firmPostingContext(db, f);
  // electricity: the scheme key, else 4030 / 4020 „Електрична енергија“ of the firm's chart, else the purchase default
  const energy = schemeValue(ctx, 'costEnergy') || energyKontoFromChart(await effectiveChart(db, f.id)) || schemeValue(ctx, 'purDefault');
  const mem = await lastSupplierKontos(db, f.id);
  const sigs = await readSigs(db, f.id, opts.docId);
  const M = await matchData(db, f.id);
  const closed = new Set((await db.select({ d: journals.date }).from(journals).where(and(eq(journals.firmId, f.id), eq(journals.kind, 'ddv'))))
    .map((j) => periodOf(j.d, f.vatPeriod)));
  const today = todaySkopje();
  const prev = await db.select({ id: purchases.id, partnerId: purchases.partnerId, number: purchases.number, total: purchases.total, date: purchases.date, docDate: purchases.docDate, edb: partners.edb, sedb: purchases.supplierEdb })
    .from(purchases).leftJoin(partners, eq(partners.id, purchases.partnerId)).where(eq(purchases.firmId, f.id));
  // the document date of a saved purchase (the booking date when none was kept)
  const cand: { id?: string; partnerId: string | null; partnerEdb: string | null; number: string; total: number; date: string | null; inRead?: number }[] =
    prev.map((p) => ({ id: p.id, partnerId: p.partnerId, partnerEdb: p.edb ?? p.sedb, number: p.number, total: Number(p.total), date: p.docDate ?? p.date }));
  const s = (f.settings ?? {}) as Record<string, unknown>;
  // the firm's own accounts printed on the invoice (as the buyer's) are never the supplier's account
  const own = new Set((await db.select({ a: bankAccounts.account, i: bankAccounts.iban }).from(bankAccounts).where(eq(bankAccounts.firmId, f.id)))
    .flatMap((b) => [accountKey(b.a), accountKey(b.i)]).filter(Boolean));
  const I = scanInvoices(mergeAttachedInvoices(r));
  const out: AiDraft[] = [];
  for (const [k, x1] of I.entries()) {
    // a utility bill's previous debt is never booked: total = this invoice's own amount
    const { inv: x0, debt } = prevDebtFix(x1);
    const x = x0.supplierBankAccount && own.has(accountKey(x0.supplierBankAccount)) ? { ...x0, supplierBankAccount: '' } : x0;
    const d = purchaseDraftFromScan(x, {
      ...M, today, cash: opts.cash, warehouseId: opts.warehouseId ?? null, costOnly: opts.costOnly,
      accounts: { goods: schemeValue(ctx, 'stock'), material: schemeValue(ctx, 'material'), other: schemeValue(ctx, 'purDefault'), energy },
      supplierKontos: (pid) => mem.get(pid),
      defMargin: Number(s.defMargin) || 25, mgRound: Number(s.mgRound) || 1,
      vatClosed: (dt) => closed.has(periodOf(dt, f.vatPeriod)),
    });
    // paid in cash (a cash nalog / „во готово“): the firm's cash rules — e.g. fuel → 4033, everything else → 4199 — as
    // costs (no stock); a fiscal receipt without an invoice number gets one from its date and amount
    if (opts.cash) applyCashScanRules(d, cashScanRules(s));
    // the supplier read is this firm itself (its own sales invoice): never a partner of its own purchase
    if (isOwnParty(d.supplierName, d.supplierEdb, f.edb, f.name)) { d.partnerId = ''; d.match = undefined; }
    else if (!d.partnerId && !ownerCheck('purchase', x, f.edb, f.name)) {
      const a = await autoPartner(db, f, o, M, { name: d.supplierName, id: d.supplierEdb, bankAccount: d.bankAcc, type: 'supplier' }, d.match);
      if (a) { d.partnerId = a.id; d.match = a.match; }
    }
    // duplicate: already in the purchases (supplier + number + amount, or supplier ЕДБ + number + document date), or
    // the same invoice printed twice in this file (original + copy)
    const me = { partnerId: d.partnerId || null, partnerEdb: d.supplierEdb, number: d.number, total: purchaseTotal(d), date: d.docDate || null };
    const dup = findDuplicate(me, cand);
    let st: { status: AiDraft['status']; msg: string } = batchStatus(d, x, dup, ownerCheck('purchase', x, f.edb, f.name) ?? (isOwnParty(d.supplierName, d.supplierEdb, f.edb, f.name) ? 'Добавувачот на документот е оваа фирма – ова е излезна, не влезна фактура.' : null));
    if (dup?.inRead != null) st = { status: 'dup', msg: `истата фактура е веќе прочитана погоре во овој документ (фактура ${dup.inRead + 1} од ${I.length})` };
    else if (dup) st = { status: 'dup', msg: `веќе е заведена: ${d.number}${dup.date ? ' од ' + dup.date.split('-').reverse().join('.') : ''} – прескокната` };
    // one invoice read with a range of numbers („101-103“): several invoices merged by the read — never saved as one
    else if (numberRange(d.number)) st = { status: 'check', msg: [`бројот „${d.number}“ е опсег – можеби се повеќе фактури; прочитајте подетално или поделете го документот`, st.msg].filter(Boolean).join(', ') };
    if (d.match?.created && st.status === 'ok') st = { status: 'ok', msg: 'нов партнер креиран: ' + d.supplierName };
    if (debt) {
      d.prevDebt = debt;
      const note = `претходниот долг ${debt.toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} не се книжи`;
      st = { ...st, msg: [st.msg, note].filter(Boolean).join(', ') };
    }
    // a pro-forma / offer / delivery note is never booked: left out of the list („Врати“ shows it, never a bulk save)
    const nonInv = notInvoiceMsg(x);
    const sig = scanContentSig(x);
    const twin = sig ? sigs.get(sig) : undefined;
    let skipped = false;
    if (nonInv) { st = { status: 'skip', msg: nonInv }; skipped = true; }
    // the same supplier, lines and total as another read under another number: one of them is a pro-forma (or the same
    // document twice) — never both booked; the pro-forma is marked when the read says which one it is
    else if (twin && !twin.proforma && st.status !== 'dup' && normDocNo(twin.number) !== normDocNo(d.number)) {
      st = { status: 'check', msg: [`исти ставки и износ како ${twin.number || 'друга фактура'}${twin.date ? ' од ' + twin.date.split('-').reverse().join('.') : ''} – едната е можеби профактура; проверете`, st.msg].filter(Boolean).join(', ') };
    }
    if (sig && !sigs.has(sig)) sigs.set(sig, { number: d.number, date: d.docDate, proforma: !!nonInv });
    cand.push({ ...me, inRead: k });
    out.push({ draft: d as unknown as Record<string, unknown>, ...st, ...(skipped ? { skipped: true } : {}) });
  }
  return out;
}

/** The firm's rules for documents paid in cash (`firms.settings.cashScan`): keyword → konto, and the konto of the rest. */
export interface CashScanRules { other?: string; rules?: { match: string; konto: string }[] }
export const cashScanRules = (settings: unknown): CashScanRules => {
  const v = ((settings ?? {}) as { cashScan?: unknown }).cashScan as CashScanRules | undefined;
  return v && typeof v === 'object' ? { other: typeof v.other === 'string' ? v.other : undefined, rules: Array.isArray(v.rules) ? v.rules.filter((r) => r && typeof r.match === 'string' && typeof r.konto === 'string') : [] } : {};
};

/** Apply the cash rules to a read purchase: one konto for the whole receipt (by the supplier and the line names), costs only. */
export function applyCashScanRules(d: ScanPurchaseDraft, R: CashScanRules): void {
  const text = [d.supplierName, ...(d.stock ?? []).map((x) => x.name)].join(' ');
  const hit = (R.rules ?? []).find((r) => { try { return new RegExp(r.match, 'iu').test(text); } catch { return false; } });
  const konto = hit?.konto || R.other;
  if (konto) {
    d.groups = d.groups.map((g) => ({ ...g, konto }));
    d.stock = [];
    d.ptype = 'cost';
  }
  if (!String(d.number ?? '').trim()) {
    const dt = String(d.docDate || d.date || '').split('-').reverse().join('.');
    d.number = `БФ ${dt} ${purchaseTotal(d).toFixed(2)}`.trim();
  }
}

/** „101-103“ / „101 – 103“: a range of numbers (several invoices read as one), not one invoice number. */
export function numberRange(n: string): boolean {
  const m = /^\s*(\d{1,8})\s*[-–—]\s*(\d{1,8})\s*$/.exec(n);
  return !!m && +m[2]! > +m[1]! && +m[2]! - +m[1]! < 50;
}

export async function saleDrafts(db: Tx, f: Firm, r: ScanResult, o: DraftOpts = {}): Promise<AiDraft[]> {
  const ctx = await firmPostingContext(db, f);
  const M = await matchData(db, f.id);
  const today = todaySkopje();
  const used = (await db.select({ n: invoices.number }).from(invoices).where(and(eq(invoices.firmId, f.id), eq(invoices.kind, 'invoice'),
    sql`extract(year from ${invoices.date}) = ${Number(today.slice(0, 4))}`))).map((x) => x.n);
  const out: AiDraft[] = [];
  const baseUsed = used.length;
  const fm =(v: number) => v.toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tracksStock = M.items.some((i) => i.type !== 'service');
  for (const x of scanInvoices(mergeAttachedInvoices(r))) {
    const d = saleDraftFromScan(x, { ...M, revKonto: schemeValue(ctx, 'revDefault'), today, nextNumber: nextDocNumber(used, today.slice(0, 4)), noVat: scanNoVatRule(f.settings) });
    const own = ownerCheck('sale', x, f.edb, f.name);
    // the buyer read is this firm itself: never the partner of its own sales invoice (also when a partner card of it exists)
    if (own) { d.partnerId = ''; d.match = undefined; }
    if (!d.partnerId && !own) {
      const a = await autoPartner(db, f, o, M, { name: d.buyer.name, id: d.buyer.edb, address: d.buyer.address, city: d.buyer.city, type: 'customer' }, d.match);
      if (a) { d.partnerId = a.id; d.match = a.match; }
    }
    // legacy `outCheck` (8402): existing number → „веќе внесена“; a new buyer alone does not block „спремна“
    const why: string[] = [];
    const dup = used.some((u) => String(u).trim() === d.number.trim());
    const before = used.slice(0, baseUsed).some((u) => String(u).trim() === d.number.trim());
    if (dup) why.push(before ? 'бројот ' + d.number + ' веќе постои – прескокната' : 'бројот ' + d.number + ' се појавува двапати во документот – прескокната');
    // several invoices read as one with a range of numbers („101-103“): never ready to save as one document
    if (numberRange(d.number)) why.push(`бројот „${d.number}“ е опсег – можеби се повеќе фактури; прочитајте подетално или поделете го документот`);
    used.push(d.number);
    if (d.match?.created) why.push('нов партнер креиран: ' + d.buyer.name);
    else if (!d.partnerId) why.push(d.match?.candidates.length ? 'изберете го купувачот (слични комитенти)' : d.buyer.name ? 'нов купувач: ' + d.buyer.name : 'купувачот не е препознаен');
    const c = calcLines(d.items, d.art32);
    if (d.total && Math.abs(c.total - d.total) > Math.max(2, d.total * 0.005)) why.push('износот не се совпаѓа (' + fm(c.total) + ' / ' + fm(d.total) + ')');
    // unlinked lines matter only where stock is kept: a services firm (no goods / materials / products in the codebook)
    // books revenue without an article, so they do not block „спремна“
    const free = tracksStock ? d.items.filter((l) => !l.itemId && Number(l.qty) && !/услуг|транспорт|превоз/i.test(l.name)).length : 0;
    if (free) why.push(free + ' ставки не се поврзани со артикл');
    if (!d.items.length) why.push('нема ставки');
    // no VAT and no note (чл. 32-а / ослободување) on the document: never guessed, the accountant decides
    if (d.vatCheck) why.push(d.vatNote ? 'провери: ослободено со или без право на одбивка (ДДВ-04 поле 08 / 09)?' : NO_VAT_NOTE_MSG);
    if (own) why.push(own);
    // the invoice says the firm is not a VAT payer while its card says it is: the card decides the posting (1200 / 1200009, ДДВ-04)
    if (d.issuerNoVat && f.vatRegistered) why.push('на фактурата пишува „не е ДДВ обврзник“, а во картичката фирмата е ДДВ обврзник – исправете ја картичката на фирмата');
    const status = dup ? 'dup' : why.some((m) => !m.startsWith('нов купувач') && !m.startsWith('нов партнер креиран')) ? 'check' : 'ok';
    // no lines and no amount: a work order / „налог-потврда за извршена услуга“, a delivery page — never an invoice to post
    const nonInv = notInvoiceMsg(x) || (!c.total && !Number(d.total) ? 'не е фактура (налог / потврда за услуга, без износ) – не се книжи, само архива' : '');
    if (nonInv) { out.push({ draft: { ...d, calcTotal: c.total } as unknown as Record<string, unknown>, status: 'skip', msg: nonInv, skipped: true, ...(!notInvoiceMsg(x) ? { archived: new Date().toISOString() } : {}) }); continue; }
    out.push({ draft: { ...d, calcTotal: c.total } as unknown as Record<string, unknown>, status, msg: why.join(' · ') });
  }
  return out;
}

type ReadOpts = { cash?: boolean; warehouseId?: string | null; costOnly?: boolean; rulesV?: number };

/** A finished purchase / sale read whose drafts can be rebuilt from its stored result (not a split parent, not all saved). */
export function scanDraftsRebuildable(d: Pick<AiDocument, 'kind' | 'status' | 'result' | 'drafts'>): boolean {
  if (d.status !== 'done' || (d.kind !== 'purchase' && d.kind !== 'sale')) return false;
  const r = d.result as ScanResult | null;
  if (!r || typeof r !== 'object' || 'split' in r || !scanInvoices(r).length) return false;
  return !d.drafts.length || d.drafts.some((x) => !x.savedId);
}

/**
 * The stored result cannot give better drafts — only a new AI read can (the new prompt asks for `prevDebt` and
 * `docType`): amounts that do not match with no previous debt read, or the same lines as another read with no pro-forma
 * marked. Never for a read with a saved invoice.
 */
export function scanNeedsReread(d: Pick<AiDocument, 'kind' | 'status' | 'result' | 'drafts'>): boolean {
  if (d.kind !== 'purchase' || d.status !== 'done' || d.drafts.some((x) => x.savedId)) return false;
  const I = scanInvoices(d.result as ScanResult | null);
  const live = d.drafts.filter((x) => !x.skipped && x.status === 'check');
  if (live.some((x) => /не се совпаѓаат/.test(x.msg ?? '')) && !I.some((x) => Number(x.prevDebt) > 0)) return true;
  return live.some((x) => /профактура; проверете/.test(x.msg ?? '')) && !I.some((x) => x.docType);
}

/**
 * Rebuild the drafts of an unsaved read from its stored `result` with the current rules (attached pages, supplier konto
 * memory, electricity konto, previous debt, pro-forma) — deterministic, no AI. Saved purchases / invoices are never
 * touched: the entry of a saved draft is kept as it is, and a read with a saved draft is rebuilt only when it still gives
 * the same number of invoices. „Прескокни“ marks are kept. Returns the updated row, or null when nothing was rebuilt.
 */
export async function rebuildScanDrafts(db: Tx, f: Firm, doc: AiDocument, o: DraftOpts = {}): Promise<AiDocument | null> {
  if (!scanDraftsRebuildable(doc)) return null;
  const res = mergeAttachedInvoices(doc.result as ScanResult);
  const same = scanInvoices(res).length === doc.drafts.length;
  if (!same && doc.drafts.some((x) => x.savedId)) return null;
  const opts = (doc.options ?? {}) as ReadOpts;
  const D = doc.kind === 'sale' ? await saleDrafts(db, f, res, o)
    : await purchaseDrafts(db, f, res, { cash: opts.cash, warehouseId: opts.warehouseId ?? null, costOnly: opts.costOnly, docId: doc.id }, o);
  const drafts = D.map((x, i) => {
    const old = same ? doc.drafts[i] : undefined;
    if (old?.savedId) return old;
    const y = old?.deleted ? { ...x, deleted: old.deleted } : x;
    // the user's decisions stay: skipped („Прескокни“), „📁 Само за архива“ — a skip the program made itself
    // (status `skip`: „испратница – не се книжи“) is decided again by the current rules
    const z = old?.archived ? { ...y, archived: old.archived } : y;
    const userSkip = !!old?.skipped && (old.status !== 'skip' || !!old.archived);
    return userSkip && !z.skipped ? { ...z, skipped: true } : z;
  });
  const up = await db.update(aiDocuments).set({ drafts, result: res, options: { ...(doc.options ?? {}), rulesV: SCAN_RULES_V } })
    .where(and(eq(aiDocuments.id, doc.id), eq(aiDocuments.status, 'done'))).returning();
  return up[0] ?? null;
}

/**
 * Reads built with older rules (`options.rulesV` < {@link SCAN_RULES_V}) are rebuilt when their list / draft is opened
 * (`force`: every unsaved read given — „↻ Примени ги правилата повторно“). Each read in its own transaction; one that
 * cannot be rebuilt only gets the version mark. Returns the rows as they are now and how many were rebuilt.
 */
export async function refreshStaleScanDrafts(db: Tx, f: Firm, docs: readonly AiDocument[], o: DraftOpts & { force?: boolean } = {}): Promise<{ docs: AiDocument[]; rebuilt: number }> {
  let rebuilt = 0;
  const out: AiDocument[] = [];
  for (const d of docs) {
    const v = Number((d.options as ReadOpts | null)?.rulesV ?? 0);
    if (!(o.force || v < SCAN_RULES_V) || !scanDraftsRebuildable(d)) { out.push(d); continue; }
    try {
      const r = await db.transaction(async (tx0) => {
        const tx = tx0 as unknown as Tx;
        const x = await rebuildScanDrafts(tx, f, d, o);
        if (x) return { row: x, done: true };
        const [y] = await tx.update(aiDocuments).set({ options: sql`${aiDocuments.options} || ${JSON.stringify({ rulesV: SCAN_RULES_V })}::jsonb` })
          .where(eq(aiDocuments.id, d.id)).returning();
        return { row: y ?? d, done: false };
      });
      if (r.done) rebuilt++;
      out.push(r.row);
    } catch { out.push(d); }
  }
  return { docs: out, rebuilt };
}
