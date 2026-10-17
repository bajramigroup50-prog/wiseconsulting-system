/**
 * Turn a read result into review drafts (legacy `scanFile` / `batchRun` → `draftFromScan` + `batchCheck`, and
 * `outRun` → `outDraft`). Loads the firm's partners, items, duplicates and closed VAT periods.
 */
import { and, eq, sql } from 'drizzle-orm';
import { calcLines, periodOf, schemeValue } from '@wise/core';
import { todaySkopje } from '@wise/core/office/dates';
import {
  batchStatus, findDuplicate, nextDocNumber, ownerCheck, purchaseDraftFromScan, purchaseTotal, saleDraftFromScan, scanInvoices,
  type MatchItem, type ScanResult,
} from '@wise/core/sales';
import { accountKey } from '@wise/core/bank/mk-banks';
import { classifyPartnerId, type DraftPartnerMatch, type MatchablePartnerRow } from '@wise/core/partners/match';
import {
  audit, bankAccounts, ensurePartner, firmPostingContext, invoices, itemBarcodes, items, itemSupplierCodes, journals, partners, purchases,
  type AiDraft, type Firm, type Tx,
} from '@wise/db';

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

export async function purchaseDrafts(db: Tx, f: Firm, r: ScanResult, opts: { cash?: boolean; warehouseId?: string | null; costOnly?: boolean }, o: DraftOpts = {}): Promise<AiDraft[]> {
  const ctx = await firmPostingContext(db, f);
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
  const I = scanInvoices(r);
  const out: AiDraft[] = [];
  for (const [k, x0] of I.entries()) {
    const x = x0.supplierBankAccount && own.has(accountKey(x0.supplierBankAccount)) ? { ...x0, supplierBankAccount: '' } : x0;
    const d = purchaseDraftFromScan(x, {
      ...M, today, cash: opts.cash, warehouseId: opts.warehouseId ?? null, costOnly: opts.costOnly,
      accounts: { goods: schemeValue(ctx, 'stock'), material: schemeValue(ctx, 'material'), other: schemeValue(ctx, 'purDefault') },
      defMargin: Number(s.defMargin) || 25, mgRound: Number(s.mgRound) || 1,
      vatClosed: (dt) => closed.has(periodOf(dt, f.vatPeriod)),
    });
    if (!d.partnerId && !ownerCheck('purchase', x, f.edb)) {
      const a = await autoPartner(db, f, o, M, { name: d.supplierName, id: d.supplierEdb, bankAccount: d.bankAcc, type: 'supplier' }, d.match);
      if (a) { d.partnerId = a.id; d.match = a.match; }
    }
    // duplicate: already in the purchases (supplier + number + amount, or supplier ЕДБ + number + document date), or
    // the same invoice printed twice in this file (original + copy)
    const me = { partnerId: d.partnerId || null, partnerEdb: d.supplierEdb, number: d.number, total: purchaseTotal(d), date: d.docDate || null };
    const dup = findDuplicate(me, cand);
    let st = batchStatus(d, x, dup, ownerCheck('purchase', x, f.edb));
    if (dup?.inRead != null) st = { status: 'dup', msg: `истата фактура е веќе прочитана погоре во овој документ (фактура ${dup.inRead + 1} од ${I.length})` };
    else if (dup) st = { status: 'dup', msg: `веќе е заведена: ${d.number}${dup.date ? ' од ' + dup.date.split('-').reverse().join('.') : ''} – прескокната` };
    // one invoice read with a range of numbers („101-103“): several invoices merged by the read — never saved as one
    else if (numberRange(d.number)) st = { status: 'check', msg: [`бројот „${d.number}“ е опсег – можеби се повеќе фактури; прочитајте подетално или поделете го документот`, st.msg].filter(Boolean).join(', ') };
    if (d.match?.created && st.status === 'ok') st = { status: 'ok', msg: 'нов партнер креиран: ' + d.supplierName };
    cand.push({ ...me, inRead: k });
    out.push({ draft: d as unknown as Record<string, unknown>, ...st });
  }
  return out;
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
  for (const x of scanInvoices(r)) {
    const d = saleDraftFromScan(x, { ...M, revKonto: schemeValue(ctx, 'revDefault'), today, nextNumber: nextDocNumber(used, today.slice(0, 4)) });
    const own = ownerCheck('sale', x, f.edb);
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
    if (own) why.push(own);
    const status = dup ? 'dup' : why.some((m) => !m.startsWith('нов купувач') && !m.startsWith('нов партнер креиран')) ? 'check' : 'ok';
    out.push({ draft: { ...d, calcTotal: c.total } as unknown as Record<string, unknown>, status, msg: why.join(' · ') });
  }
  return out;
}
