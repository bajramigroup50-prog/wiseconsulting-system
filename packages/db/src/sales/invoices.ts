/**
 * Outgoing documents service — save / post / unpost / approve / delete invoices, credit notes, proformas and
 * dispatch notes in one transaction with their stock moves and journals.
 *
 * FIX (LEGACY-MAP 3.4 item 18): legacy `saveInv` was a chain of wrappers that each re-read the form (and one called
 * `render()` mid-chain). This is one explicit pipeline: validate → number → totals → persist → stock → post → audit.
 *
 * Journals: (`invoice`, id) kind `izlez` (credit notes `odobr`) for the sale itself; stock moves through Phase 7
 * `replaceSourceMoves` (sources `invoice` / `dispatch`) with their stock journal `stock:invoice` / `stock:dispatch`, kind `zaliha`.
 */
import { removeInvoiceProduction, runInvoiceProduction, type InvoiceProductionInput } from './invoice-production';
import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import {
  cogsAccount, invoiceEntries, needsPartner, postOut, schemeValue, PostingError as CorePostingError, r2, stockAccount,
  type AdvanceDeduction, type InvoiceItem, type JournalLine, type StockContext, type StockItem, type StockMove,
} from '@wise/core';
import { checkCredit, invoiceTotals, nextDocNumber, VALID_LINE_RATES, type DocKind } from '@wise/core/sales';
import { audit, type Tx } from '../audit';
import { postJournal, unpostSource, type PostLineInput } from '../posting';
import {
  invoiceAdvances, invoiceLines, invoices, partners, stockMoves, type Firm, type Invoice, type InvoiceData, type InvoiceLine, type InvoiceProdState,
} from '../schema/index';
import {
  assertLocation, DocumentError, firmItems, firmPostingContext, loadFirmForUpdate, pendingFor, type DocActor,
} from './context';
import { loadStockContext, removeSourceMoves, replaceSourceMoves } from '../stock-service';

export interface InvoiceLineInput {
  itemId?: string | null; code?: string | null; name: string; unit?: string | null;
  qty: number | string; price: number | string; disc?: number | string | null; rate: number | string; account?: string | null;
}
export interface InvoiceInput {
  id?: string | null;
  kind: DocKind;
  number?: string | null;
  date: string;
  pdate?: string | null;
  due?: string | null;
  partnerId?: string | null;
  warehouseId?: string | null;
  art32?: boolean; advance?: boolean; export?: boolean; svc?: boolean;
  currency?: string | null; fx?: number | string | null;
  refInvoiceId?: string | null;
  creditKind?: 'price' | 'gross' | 'ret' | null;
  creditGross?: number | string | null;
  fromDocId?: string | null;
  note?: string | null;
  scanned?: boolean;
  data?: InvoiceData;
  lines: InvoiceLineInput[];
  advances?: { advanceId: string; amount: number | string }[];
  /** Save an invoice as an unbooked `draft` (Phase 9 recurring invoices); `approveInvoice` books it. */
  draft?: boolean;
  /** „Производство = Да“: materials of the produced lines (`sales/invoice-production.ts`). */
  production?: InvoiceProductionInput | null;
}
export interface SaveResult { id: string; number: string; status: string; renumbered: boolean; warnings: string[] }

const yearOf = (d: string) => d.slice(0, 4);
const n = (v: unknown) => Number(v) || 0;
const n4 = (v: number) => String(Math.round(v * 1e4) / 1e4);
const kindOfJournal = (k: DocKind) => (k === 'credit' ? 'odobr' : 'izlez');

/** Numbers already used by a kind in the year of `date` (excluding one document). */
async function usedNumbers(tx: Tx, firmId: string, kind: DocKind, date: string, exceptId?: string | null) {
  const rows = await tx.select({ n: invoices.number }).from(invoices).where(and(
    eq(invoices.firmId, firmId), eq(invoices.kind, kind), sql`extract(year from ${invoices.date}) = ${Number(yearOf(date))}`,
    exceptId ? ne(invoices.id, exceptId) : undefined,
  ));
  return rows.map((r) => r.n);
}

/** Next number for a new document of `kind` in the year of `date` (legacy `nextNumber`). */
export async function nextInvoiceNumber(tx: Tx, firmId: string, kind: DocKind, date: string): Promise<string> {
  return nextDocNumber(await usedNumbers(tx, firmId, kind, date), yearOf(date));
}

const toItems = (L: readonly Pick<InvoiceLine, 'name' | 'itemId' | 'unit' | 'qty' | 'price' | 'disc' | 'rate' | 'account'>[], fx = 1): InvoiceItem[] =>
  L.map((l) => ({ name: l.name, itemId: l.itemId ?? undefined, unit: l.unit ?? undefined, qty: Number(l.qty), price: Number(l.price) * fx, disc: Number(l.disc), rate: l.rate, konto: l.account }));

/** Advance deductions of an invoice, resolved to the advance invoices (for `invoiceEntries` / totals / print). */
export async function loadAdvances(tx: Tx, rows: readonly { advanceId: string; amount: number | string }[], fx = 1): Promise<AdvanceDeduction[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.advanceId);
  const [A, L] = await Promise.all([
    tx.select().from(invoices).where(inArray(invoices.id, ids)),
    tx.select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, ids)).orderBy(asc(invoiceLines.lineNo)),
  ]);
  return rows.map((r) => {
    const a = A.find((x) => x.id === r.advanceId);
    if (!a) throw new DocumentError('Авансната фактура не постои.');
    return { amount: n(r.amount) * fx, invoice: { id: a.id, number: a.number, date: a.date, art32: a.art32, items: toItems(L.filter((l) => l.invoiceId === a.id), fx) } };
  });
}

/** Amount (base) of an advance invoice already deducted on other invoices (legacy `advUsed`). */
async function advanceUsed(tx: Tx, advanceId: string, exceptInvoiceId: string | null): Promise<number> {
  const [r] = await tx.select({ s: sql<string>`coalesce(sum(${invoiceAdvances.amount}), 0)` }).from(invoiceAdvances)
    .where(and(eq(invoiceAdvances.advanceId, advanceId), exceptInvoiceId ? ne(invoiceAdvances.invoiceId, exceptInvoiceId) : undefined));
  return n(r?.s);
}

/** Total of a saved invoice in its currency incl. advance deduction (legacy `invTotal`). */
async function savedTotal(tx: Tx, inv: Invoice): Promise<number> {
  const L = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));
  const A = inv.kind === 'invoice' && !inv.advance ? await loadAdvances(tx, await tx.select().from(invoiceAdvances).where(eq(invoiceAdvances.invoiceId, inv.id))) : [];
  const T = invoiceTotals({ items: toItems(L), art32: inv.art32, advance: inv.advance, credit: inv.kind === 'credit', advances: A });
  return r2(T.total - T.advTotal);
}

function wrapCore<T>(f: () => T): T {
  try { return f(); } catch (e) {
    if (e instanceof CorePostingError) throw new DocumentError(e.message);
    throw e;
  }
}

const journalLinesOf = (L: readonly JournalLine[]): PostLineInput[] =>
  L.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, partnerId: l.partnerId || null, note: l.note ?? null, doc: l.doc ?? null, currency: l.cur ?? null, amountCur: l.amtCur ?? null }));

/** Phase 7 `stock_moves` source type of a document: dispatch notes are their own source, everything else `invoice`. */
const stockSource = (kind: DocKind) => (kind === 'dispatch' ? 'dispatch' : 'invoice');

/**
 * Stock part of an invoice / dispatch / return credit note: issue moves at average cost (legacy `postOut` per line)
 * or return moves (legacy `crMoves`), each carrying its journal lines; `replaceSourceMoves` (Phase 7) stores them and
 * posts the aggregated stock journal (`stock:invoice` / `stock:dispatch`, kind `zaliha`).
 */
async function stockFor(tx: Tx, inv: Invoice, L: readonly InvoiceLine[], ref: Invoice | null): Promise<{ moves: StockMove[]; warnings: string[] }> {
  const ids = L.map((l) => l.itemId).filter((x): x is string => !!x);
  if (!ids.length) return { moves: [], warnings: [] };
  const SC: StockContext = (await loadStockContext(tx, inv.firmId, { excludeSource: { sourceType: stockSource(inv.kind), sourceId: inv.id } })).ctx;
  const item = (id: string) => SC.items!.find((i) => i.id === id);
  const wh = inv.warehouseId ?? 'main';
  const moves: StockMove[] = [], warnings: string[] = [];
  const label = (inv.kind === 'dispatch' ? 'Испратница ' : inv.kind === 'credit' ? 'Повратница (одобрение ' : 'Фактура ') + inv.number + (inv.kind === 'credit' ? ')' : '');
  if (inv.kind === 'credit') {
    if (inv.creditKind !== 'ret' || !ref) return { moves, warnings };
    const refLines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, ref.id));
    const OM = await tx.select().from(stockMoves).where(and(eq(stockMoves.firmId, inv.firmId), eq(stockMoves.direction, 'out'), or(
      and(eq(stockMoves.sourceType, 'invoice'), eq(stockMoves.sourceId, ref.id)),
      ref.fromDocId ? and(eq(stockMoves.sourceType, 'dispatch'), eq(stockMoves.sourceId, ref.fromDocId)) : undefined,
    )));
    const rwh = ref.warehouseId ?? 'main';
    for (const l of L) {
      const it = l.itemId ? item(l.itemId) : undefined;
      const q = Number(l.qty);
      if (!it || !it.type || it.type === 'service' || !q) continue;
      const om = OM.filter((m) => m.itemId === it.id);
      const sold = refLines.filter((x) => x.itemId === it.id).reduce((a, x) => a + Number(x.qty), 0);
      let value: number, qty: number;
      if (om.length && sold) {
        const ratio = q / sold;
        qty = -om.reduce((a, m) => a + Number(m.qty), 0) * ratio;
        value = Math.round(-om.reduce((a, m) => a + Number(m.value), 0) * ratio);
      } else {
        const s = SC.moves.filter((m) => m.item === it.id && (m.wh ?? 'main') === rwh && !m.pend);
        const sq = s.reduce((a, m) => a + m.qty, 0), sv = s.reduce((a, m) => a + m.value, 0);
        qty = q;
        value = Math.round(q * (sq > 0 ? sv / sq : Number(it.cost) || 0));
      }
      moves.push({
        id: '', item: it.id, wh: rwh, date: inv.date, qty, value, type: 'return', label,
        lines: value ? [{ account: stockAccount(SC, rwh, it), debit: value, credit: 0 }, { account: cogsAccount(SC, it), debit: 0, credit: value }] : [],
      });
    }
    return { moves, warnings };
  }
  const need = new Map<string, number>();
  for (const l of L) {
    const it = l.itemId ? item(l.itemId) : undefined;
    const q = Number(l.qty);
    if (!it || !it.type || it.type === 'service' || !q) continue;
    const r = postOut(SC, { item: it as StockItem, qty: q, date: inv.date, type: inv.kind === 'dispatch' ? 'dispatch' : 'sale', src: inv.id + '-' + l.lineNo, label, debitAccount: cogsAccount(SC, it), wh });
    if (!String(it.rawK ?? '').trim()) need.set(it.id, (need.get(it.id) ?? 0) + q);
    // later lines of the same item see this issue
    (SC.moves as StockMove[]).push(r.move);
    moves.push(r.move);
    if (r.warning?.code === 'noCost') warnings.push(`${it.name}: нема набавна цена – раздолжено без вредност.`);
  }
  for (const [id, q] of need) {
    const have = SC.moves.filter((m) => m.item === id && (m.wh ?? 'main') === wh && !m.pend && !String(m.src ?? '').startsWith(inv.id + '-')).reduce((a, m) => a + m.qty, 0);
    if (have < q - 1e-9) warnings.push(`${item(id)?.name}: се бара ${q}, на залиха ${Math.round(have * 1e4) / 1e4}.`);
  }
  return { moves, warnings };
}

/** Book (or re-book) a saved document: sale journal, stock moves and stock journal. */
async function postInvoice(tx: Tx, f: Firm, inv: Invoice, userId: string | null): Promise<string[]> {
  const ctx = await firmPostingContext(tx, f);
  const L = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)).orderBy(asc(invoiceLines.lineNo));
  const fx = n(inv.fx) || 1;
  const ref = inv.refInvoiceId ? (await tx.select().from(invoices).where(eq(invoices.id, inv.refInvoiceId)).limit(1))[0] ?? null : null;
  if (inv.kind === 'invoice' || inv.kind === 'credit') {
    const adv = inv.kind === 'invoice' && !inv.advance ? await loadAdvances(tx, await tx.select().from(invoiceAdvances).where(eq(invoiceAdvances.invoiceId, inv.id)), fx) : [];
    const lines = wrapCore(() => invoiceEntries({
      id: inv.id, date: inv.date, number: inv.number, partner: inv.partnerId ?? undefined, items: toItems(L, fx), art32: inv.art32,
      credit: inv.kind === 'credit', advance: inv.advance, export: inv.export, advances: adv,
    }, ctx));
    // Legacy `stornoOn` / `stF` (3444): credit notes are booked with minus on the original side (red storno) unless the
    // firm chose „на обратната страна“ (`settings.crMode = 'flip'`). Balances are the same; only the turnovers differ.
    if (inv.kind === 'credit' && ((f.settings ?? {}) as { crMode?: string }).crMode !== 'flip') {
      for (const l of lines) { const dr = l.debit, cr = l.credit; l.debit = cr ? -cr : 0; l.credit = dr ? -dr : 0; }
    }
    // Advance lines (2220) are partner accounts too: book them on the buyer (legacy posted them without a partner).
    for (const l of lines) if (!l.partnerId && needsPartner(l.account) && inv.partnerId) l.partnerId = inv.partnerId;
    if (inv.currency !== 'MKD') {
      const cur = invoiceTotals({ items: toItems(L), art32: inv.art32, credit: inv.kind === 'credit', advance: inv.advance });
      for (const l of lines) if (l.partnerId && l.partnerId === inv.partnerId && (l.debit || l.credit) && !l.note) { l.cur = inv.currency; l.amtCur = inv.art32 ? cur.base : cur.total; }
    }
    await postJournal(tx, {
      firmId: f.id, date: inv.date, kind: kindOfJournal(inv.kind), sourceType: 'invoice', sourceId: inv.id, userId,
      description: (inv.kind === 'credit' ? 'Одобрение ' : inv.advance ? 'Авансна фактура ' : 'Фактура ') + inv.number,
      lines: journalLinesOf(lines).map((l) => ({ ...l, doc: l.doc ?? inv.number })), auditAction: 'postInvoice',
    });
  } else await unpostSource(tx, { firmId: f.id, sourceType: 'invoice', sourceId: inv.id, userId });
  const fromDispatch = inv.fromDocId ? (await tx.select({ k: invoices.kind }).from(invoices).where(eq(invoices.id, inv.fromDocId)).limit(1))[0]?.k === 'dispatch' : false;
  const S = inv.kind === 'proforma' || fromDispatch ? { moves: [], warnings: [] } : await stockFor(tx, inv, L, ref);
  await replaceSourceMoves(tx, {
    firmId: f.id, sourceType: stockSource(inv.kind), sourceId: inv.id, moves: S.moves, date: inv.date, userId, partnerId: inv.partnerId,
    description: (inv.kind === 'dispatch' ? 'Испратница ' : inv.kind === 'credit' ? 'Повратница ' : 'Излез на залиха – фактура ') + inv.number,
  });
  return S.warnings;
}

async function unpostInvoice(tx: Tx, firmId: string, inv: Pick<Invoice, 'id' | 'kind'>, userId: string | null) {
  await unpostSource(tx, { firmId, sourceType: 'invoice', sourceId: inv.id, userId });
  await removeSourceMoves(tx, { firmId, sourceType: stockSource(inv.kind), sourceId: inv.id, userId });
}

/**
 * Save a document and book it (legacy `saveInv` 7017 + wrappers). A klient user's document is stored `pending` and
 * not booked; a proforma is a `draft` and never booked. Re-saving re-books in place (same journal ids/numbers).
 */
export async function saveInvoice(tx: Tx, firmId: string, input: InvoiceInput, actor: DocActor): Promise<SaveResult> {
  const f = await loadFirmForUpdate(tx, firmId);
  const existing = input.id ? (await tx.select().from(invoices).where(and(eq(invoices.id, input.id), eq(invoices.firmId, firmId))).for('update').limit(1))[0] : undefined;
  if (input.id && !existing) throw new DocumentError('Документот не постои.');
  if (existing && existing.kind !== input.kind) throw new DocumentError('Видот на документот не може да се менува.');
  if (existing && existing.status === 'posted' && pendingFor(actor)) throw new DocumentError('Прокнижен документ не може да се менува од порталот.');
  const kind = input.kind;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new DocumentError('Неважечки датум.');
  if (!input.partnerId) throw new DocumentError('Изберете купувач.');
  const [p] = await tx.select().from(partners).where(and(eq(partners.id, input.partnerId), eq(partners.firmId, firmId))).limit(1);
  if (!p) throw new DocumentError('Купувачот не постои во оваа фирма.');
  await assertLocation(tx, firmId, input.warehouseId ?? null);
  const warnings: string[] = [];

  const art32 = !!input.art32 && kind !== 'dispatch';
  const isExport = !!input.export;
  // FIX (LEGACY-MAP 3.4 item 16): art. 32-a lines always carry rate 18 (the buyer's VAT), export lines rate 0.
  const lines = input.lines
    .filter((l) => l.itemId || String(l.name ?? '').trim() || n(l.price))
    .map((l, i) => ({
      lineNo: i + 1, itemId: l.itemId || null, code: l.code?.trim() || null, name: String(l.name ?? '').trim(), unit: l.unit?.trim() || null,
      qty: n(l.qty), price: n(l.price), disc: n(l.disc), rate: isExport ? 0 : art32 ? 18 : n(l.rate), account: String(l.account ?? '').trim(),
    }));
  if (!lines.length) throw new DocumentError('Додадете барем еден артикл.');
  const bad = lines.filter((l) => !(VALID_LINE_RATES as readonly number[]).includes(l.rate));
  if (bad.length) throw new DocumentError(`Неважечка ДДВ стапка (${bad.map((l) => l.rate).join(', ')}%). Дозволени: 18, 10, 5, 0.`);
  if (!lines.some((l) => l.qty && (kind === 'dispatch' || l.price))) throw new DocumentError('Додадете барем еден ред со количина' + (kind === 'dispatch' ? '.' : ' и цена.'));
  const IT = await firmItems(tx, firmId, lines.map((l) => l.itemId ?? ''));
  const ctx = await firmPostingContext(tx, f);
  // FIX (LEGACY-MAP 3.4 item 3): legacy fell back to the literal '7400' (~40 places); the scheme decides by item type (legacy REV_K).
  const revDefault = schemeValue(ctx, 'revDefault');
  const revOf = (t: string | undefined) => (t === 'service' ? schemeValue(ctx, 'revService') : t === 'product' ? schemeValue(ctx, 'revProduct') : t ? schemeValue(ctx, 'revGoods') : revDefault);
  for (const l of lines) {
    if (!l.name && l.itemId) l.name = IT.get(l.itemId)!.name;
    if (!l.name) throw new DocumentError('Секој ред мора да има назив.');
    if (!l.account) l.account = (l.itemId && (IT.get(l.itemId)?.revenueAccount || revOf(IT.get(l.itemId)?.type))) || revDefault;
    if (!/^\d{2,10}$/.test(l.account)) throw new DocumentError(`Неважечко конто „${l.account}“.`);
  }
  const currency = (input.currency || 'MKD').toUpperCase();
  const fx = currency === 'MKD' ? 1 : n(input.fx);
  if (!(fx > 0)) throw new DocumentError('Внесете курс за валутата.');

  // Number: free → keep; taken → next (legacy toast "доделен е следниот").
  const used = await usedNumbers(tx, firmId, kind, input.date, existing?.id);
  let number = String(input.number ?? '').trim();
  let renumbered = false;
  if (!number || used.includes(number)) {
    renumbered = !!number;
    number = nextDocNumber(used, yearOf(input.date));
    if (renumbered) warnings.push(`Бројот ${input.number} веќе постои – доделен е следниот: ${number}.`);
  }

  // Credit note against its invoice (legacy crCheck).
  let ref: Invoice | null = null;
  if (kind === 'credit') {
    if (!input.refInvoiceId) throw new DocumentError('Изберете ја фактурата на која се однесува одобрението.');
    [ref = null] = await tx.select().from(invoices).where(and(eq(invoices.id, input.refInvoiceId), eq(invoices.firmId, firmId), eq(invoices.kind, 'invoice'))).limit(1);
    if (!ref) throw new DocumentError('Фактурата не е најдена.');
    const others = await tx.select().from(invoices).where(and(eq(invoices.refInvoiceId, ref.id), eq(invoices.kind, 'credit'), existing ? ne(invoices.id, existing.id) : undefined));
    const otherRows = await Promise.all(others.map(async (o) => ({
      total: await savedTotal(tx, o), kind: o.creditKind ?? 'price',
      items: (await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, o.id))).map((x) => ({ itemId: x.itemId, qty: x.qty })),
    })));
    const refLines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, ref.id));
    const err = checkCredit(
      { partnerId: input.partnerId, date: input.date, total: invoiceTotals({ items: toItems(lines.map((l) => ({ ...l, qty: String(l.qty), price: String(l.price), disc: String(l.disc) }))), art32, credit: true }).total, kind: input.creditKind ?? 'price', items: lines },
      { id: ref.id, partnerId: ref.partnerId, date: ref.date, number: ref.number, total: await savedTotal(tx, ref), items: refLines.map((x) => ({ itemId: x.itemId, qty: x.qty })) },
      otherRows, (id) => IT.get(id)?.type,
    );
    if (err) throw new DocumentError(err);
  }

  // Advances (legacy saveInv: deduction not above the rest of the advance).
  const adv = kind === 'invoice' && !input.advance ? (input.advances ?? []).filter((a) => n(a.amount) > 0) : [];
  for (const a of adv) {
    const [ai] = await tx.select().from(invoices).where(and(eq(invoices.id, a.advanceId), eq(invoices.firmId, firmId), eq(invoices.advance, true))).limit(1);
    if (!ai) throw new DocumentError('Авансната фактура не постои.');
    const base = invoiceTotals({ items: toItems(await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, ai.id))), art32: ai.art32 }).base;
    const rest = r2(base - (await advanceUsed(tx, ai.id, existing?.id ?? null)));
    if (n(a.amount) > rest + 0.009) throw new DocumentError(`Одбиениот аванс е поголем од остатокот (${rest.toFixed(2)}).`);
  }

  const T = invoiceTotals({ items: toItems(lines.map((l) => ({ ...l, qty: String(l.qty), price: String(l.price), disc: String(l.disc) }))), art32, credit: kind === 'credit', advance: input.advance });
  const status = kind === 'proforma' || (kind === 'invoice' && input.draft) ? 'draft' : pendingFor(actor) ? 'pending' : 'posted';
  const header = {
    firmId, kind, status, number, date: input.date, pdate: kind === 'invoice' ? input.pdate || input.date : input.pdate || null, due: input.due || null,
    partnerId: input.partnerId, warehouseId: input.warehouseId || null, art32, advance: kind === 'invoice' && !!input.advance, export: isExport,
    svc: !!input.svc, currency, fx: String(fx), refInvoiceId: kind === 'credit' ? input.refInvoiceId! : null,
    creditKind: kind === 'credit' ? input.creditKind ?? 'price' : null, creditGross: kind === 'credit' && input.creditGross ? r2(n(input.creditGross)).toFixed(2) : null,
    fromDocId: input.fromDocId || existing?.fromDocId || null, note: input.note?.trim() || null, scanned: !!input.scanned || !!existing?.scanned,
    base: T.base.toFixed(2), vat: T.vat.toFixed(2), total: T.total.toFixed(2), data: input.data ?? {}, updatedBy: actor.userId,
  } satisfies Partial<typeof invoices.$inferInsert>;

  let inv: Invoice;
  if (existing) {
    [inv] = await tx.update(invoices).set(header).where(eq(invoices.id, existing.id)).returning() as [Invoice];
    await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, existing.id));
    await tx.delete(invoiceAdvances).where(eq(invoiceAdvances.invoiceId, existing.id));
  } else {
    [inv] = await tx.insert(invoices).values({ ...header, createdBy: actor.userId }).returning() as [Invoice];
  }
  await tx.insert(invoiceLines).values(lines.map((l) => ({ ...l, invoiceId: inv.id, qty: n4(l.qty), price: n4(l.price), disc: n4(l.disc) })));
  if (adv.length) await tx.insert(invoiceAdvances).values(adv.map((a) => ({ invoiceId: inv.id, advanceId: a.advanceId, amount: r2(n(a.amount)).toFixed(2) })));

  // production from the invoice: the old orders go, the new ones are made before the invoice issues the product
  const prevProd = ((existing?.data ?? {}) as InvoiceData).prodRun;
  if (prevProd?.orders?.length) await removeInvoiceProduction(tx, firmId, prevProd, actor);
  const P = input.production;
  if (kind === 'invoice' && input.data?.prod === 'Д' && P && P.lines.length) {
    let st: InvoiceProdState;
    if (status === 'posted') { const r = await runInvoiceProduction(tx, f, inv, P, actor); st = r.state; warnings.push(...r.warnings); }
    else st = { wh: P.wh ?? null, extra: r2(n(P.extra)), saveBom: !!P.saveBom, mat: 0, orders: [], lines: P.lines.map((l) => ({ ...l, qty: n(l.qty), materials: l.materials.map((m) => ({ itemId: m.itemId, qty: n(m.qty) })) })) };
    const data: InvoiceData = { ...(inv.data ?? {}), prodRun: st, ...(st.orders.length ? { prodCost: r2(st.mat + st.extra).toFixed(2) } : {}) };
    [inv] = await tx.update(invoices).set({ data }).where(eq(invoices.id, inv.id)).returning() as [Invoice];
  }

  if (status === 'posted') warnings.push(...(await postInvoice(tx, f, inv, actor.userId)));
  else await unpostInvoice(tx, firmId, inv, actor.userId);

  if (inv.fromDocId && kind === 'invoice') {
    await tx.update(invoices).set({ invoicedId: inv.id }).where(and(eq(invoices.id, inv.fromDocId), eq(invoices.firmId, firmId)));
  }
  await audit(tx, {
    userId: actor.userId, firmId, action: existing ? 'editInv' : 'saveInv', entityType: 'invoice', entityId: inv.id,
    data: { kind, number, date: inv.date, status, total: T.total, currency },
  });
  return { id: inv.id, number, status, renumbered, warnings };
}

/** Approve a client-submitted (pending) document, or a draft invoice (recurring), and book it. */
export async function approveInvoice(tx: Tx, firmId: string, id: string, actor: DocActor): Promise<string[]> {
  if (pendingFor(actor)) throw new DocumentError('Немате право да одобрувате.');
  const f = await loadFirmForUpdate(tx, firmId);
  const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.firmId, firmId))).for('update').limit(1);
  if (!inv) throw new DocumentError('Документот не постои.');
  if (inv.status !== 'pending' && !(inv.status === 'draft' && inv.kind === 'invoice')) throw new DocumentError('Документот не чека одобрување.');
  let [u] = await tx.update(invoices).set({ status: 'posted', approvedBy: actor.userId, approvedAt: new Date() }).where(eq(invoices.id, id)).returning();
  const plan = ((u!.data ?? {}) as InvoiceData).prodRun;
  const pw: string[] = [];
  if (u!.kind === 'invoice' && (u!.data as InvoiceData).prod === 'Д' && plan?.lines.length && !plan.orders.length) {
    const r = await runInvoiceProduction(tx, f, u!, { wh: plan.wh, extra: plan.extra, saveBom: plan.saveBom, lines: plan.lines }, actor);
    pw.push(...r.warnings);
    [u] = await tx.update(invoices).set({ data: { ...(u!.data ?? {}), prodRun: r.state, prodCost: r2(r.state.mat + r.state.extra).toFixed(2) } }).where(eq(invoices.id, id)).returning();
  }
  const w = [...pw, ...(await postInvoice(tx, f, u!, actor.userId))];
  await audit(tx, { userId: actor.userId, firmId, action: 'approveDoc', entityType: 'invoice', entityId: id, data: { number: inv.number } });
  return w;
}

/** Delete a document with its journals and stock moves (legacy `delDoc`, guards of `delOk`). */
export async function deleteInvoice(tx: Tx, firmId: string, id: string, actor: DocActor): Promise<void> {
  await loadFirmForUpdate(tx, firmId);
  const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.firmId, firmId))).for('update').limit(1);
  if (!inv) throw new DocumentError('Документот не постои.');
  if (pendingFor(actor) && inv.status !== 'pending') throw new DocumentError('Прокнижен документ не може да се брише од порталот.');
  const crs = await tx.select({ n: invoices.number }).from(invoices).where(eq(invoices.refInvoiceId, id));
  if (crs.length) throw new DocumentError('Не може да се избрише: постои одобрение ' + crs.map((x) => x.n).join(', ') + ' кон оваа фактура. Прво избришете го одобрението.');
  // legacy `delDoc` (5061): an invoiced dispatch note stays — otherwise the invoice would issue the stock a second time
  if (inv.kind === 'dispatch' && inv.invoicedId) {
    const [fi] = await tx.select({ n: invoices.number }).from(invoices).where(eq(invoices.id, inv.invoicedId)).limit(1);
    if (fi) throw new DocumentError('Испратницата е фактурирана (' + fi.n + '). Прво избришете ја фактурата.');
  }
  const [ad] = await tx.select({ id: invoiceAdvances.invoiceId }).from(invoiceAdvances).where(eq(invoiceAdvances.advanceId, id)).limit(1);
  if (ad) throw new DocumentError('Авансот е одбиен во друга фактура – прво отстранете го од неа.');
  await unpostInvoice(tx, firmId, inv, actor.userId);
  await removeInvoiceProduction(tx, firmId, ((inv.data ?? {}) as InvoiceData).prodRun, actor);
  await tx.update(invoices).set({ invoicedId: null }).where(eq(invoices.invoicedId, id));
  await tx.update(invoices).set({ fromDocId: null }).where(eq(invoices.fromDocId, id));
  await tx.delete(invoices).where(eq(invoices.id, id));
  await audit(tx, { userId: actor.userId, firmId, action: 'delDoc', entityType: 'invoice', entityId: id, data: { kind: inv.kind, number: inv.number, date: inv.date } });
}

/** Re-post a booked document with the current schemes (legacy `schRepost`: `save('invoices', {...i, lines: invoiceEntries(i)})`). */
export async function repostInvoice(tx: Tx, f: Firm, id: string, userId: string | null): Promise<void> {
  const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.firmId, f.id))).limit(1);
  if (!inv || inv.status !== 'posted') return;
  await postInvoice(tx, f, inv, userId);
}
