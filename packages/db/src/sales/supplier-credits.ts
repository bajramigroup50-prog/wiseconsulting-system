/**
 * Supplier returns (повратница) and supplier credits (одобрение од добавувач) — legacy `docs.type='supcr'`
 * (`scrSave` 8826, `scrEntries` 8768, `scrNextNo` 8772, `scrPurQty` 8771).
 *
 * Journal (`supplier_credit`, id), kind `povrat`. Returns also write negative stock moves (`supret`).
 * FIX (LEGACY-MAP 3.4 item 12): legacy posted these live in `ledger()` (recomputed on every view); here the journal is
 * persisted when the document is saved, like every other document.
 */
import { and, eq, ne, sql } from 'drizzle-orm';
import { locationAccounts, PostingError as CorePostingError, schemeValue, scrCalc, scrEntries } from '@wise/core';
import { audit, type Tx } from '../audit';
import { postJournal, unpostSource } from '../posting';
import { partners, purchases, purchaseStockLines, stockMoves, supplierCreditLines, supplierCredits } from '../schema/index';
import { assertLocation, DocumentError, firmItems, firmPostingContext, loadFirmForUpdate, stockLocations, type Actor } from './context';

export interface SupplierCreditInput {
  id?: string | null; kind: 'ret' | 'disc'; number?: string | null; date: string; supNo?: string | null;
  partnerId: string; refPurchaseId?: string | null; warehouseId?: string | null; note?: string | null; scanned?: boolean;
  rows: { itemId?: string | null; name: string; qty: number | string; price: number | string; rate: number | string; account?: string | null }[];
}

const n = (v: unknown) => Number(v) || 0;

/** Legacy `scrNextNo`: `001/2026` per year. */
export async function nextSupplierCreditNo(tx: Tx, firmId: string, date: string, exceptId?: string | null): Promise<string> {
  const y = date.slice(0, 4);
  const rows = await tx.select({ n: supplierCredits.number }).from(supplierCredits).where(and(eq(supplierCredits.firmId, firmId),
    sql`extract(year from ${supplierCredits.date}) = ${Number(y)}`, exceptId ? ne(supplierCredits.id, exceptId) : undefined));
  const mx = rows.reduce((m, r) => Math.max(m, parseInt(r.n.replace(/\/.*$/, '').replace(/\D/g, ''), 10) || 0), 0);
  return String(mx + 1).padStart(3, '0') + '/' + y;
}

export async function saveSupplierCredit(tx: Tx, firmId: string, input: SupplierCreditInput, actor: Actor): Promise<{ id: string; number: string; warnings: string[] }> {
  if (actor.role === 'klient') throw new DocumentError('Немате право за оваа операција.');
  const f = await loadFirmForUpdate(tx, firmId);
  const existing = input.id ? (await tx.select().from(supplierCredits).where(and(eq(supplierCredits.id, input.id), eq(supplierCredits.firmId, firmId))).for('update').limit(1))[0] : undefined;
  if (input.id && !existing) throw new DocumentError('Документот не постои.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new DocumentError('Неважечки датум.');
  if (!input.partnerId) throw new DocumentError('Изберете добавувач.');
  const [p] = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.id, input.partnerId), eq(partners.firmId, firmId))).limit(1);
  if (!p) throw new DocumentError('Добавувачот не постои во оваа фирма.');
  await assertLocation(tx, firmId, input.warehouseId ?? null);
  const warnings: string[] = [];
  const ctx = await firmPostingContext(tx, f);
  const locs = await stockLocations(tx, firmId);
  const loc = input.warehouseId ? locs.find((l) => l.id === input.warehouseId) : undefined;
  if (input.kind === 'ret' && loc?.kind === 'store') throw new DocumentError('Повратница се прави од магацин (не од продавница со малопродажни цени).');
  const rows = input.rows.filter((r) => (r.name || r.itemId) && n(r.qty) && n(r.price)).map((r, i) => ({ ...r, lineNo: i + 1, qty: n(r.qty), price: n(r.price), rate: n(r.rate), account: String(r.account ?? '').trim() }));
  if (!rows.length) throw new DocumentError('Внесете барем една ставка со количина и цена.');
  const IT = await firmItems(tx, firmId, rows.map((r) => r.itemId ?? ''));
  for (const r of rows) {
    if (input.kind === 'ret' && !r.itemId) throw new DocumentError(`Повратница: секоја ставка мора да биде артикл од шифрарникот (${r.name}).`);
    if (!r.account) r.account = input.kind === 'ret' ? (IT.get(r.itemId!)?.type === 'material' ? schemeValue(ctx, 'material') : IT.get(r.itemId!)?.type === 'product' ? schemeValue(ctx, 'product') : locationAccounts(ctx, loc ? { kind: loc.kind, konto: loc.konto } : null).goodsStock) : '';
    if (!/^\d{2,10}$/.test(r.account) && !(input.kind === 'disc' && !r.account)) throw new DocumentError(`Неважечко конто „${r.account}“.`);
  }
  let pur = null;
  if (input.refPurchaseId) {
    [pur] = await tx.select().from(purchases).where(and(eq(purchases.id, input.refPurchaseId), eq(purchases.firmId, firmId))).limit(1);
    if (!pur) throw new DocumentError('Влезната фактура не постои.');
    if (pur.partnerId !== input.partnerId) throw new DocumentError('Добавувачот не е ист како на влезната фактура.');
    if (input.kind === 'ret') {
      const got = await tx.select().from(purchaseStockLines).where(eq(purchaseStockLines.purchaseId, pur.id));
      const prev = await tx.select({ itemId: supplierCreditLines.itemId, qty: supplierCreditLines.qty }).from(supplierCreditLines)
        .innerJoin(supplierCredits, eq(supplierCredits.id, supplierCreditLines.creditId))
        .where(and(eq(supplierCredits.refPurchaseId, pur.id), eq(supplierCredits.kind, 'ret'), existing ? ne(supplierCredits.id, existing.id) : undefined));
      const sum = new Map<string, number>();
      for (const r of rows) sum.set(r.itemId!, (sum.get(r.itemId!) ?? 0) + r.qty);
      for (const [id, q] of sum) {
        const g = got.filter((s) => s.itemId === id).reduce((a, s) => a + n(s.qty), 0);
        const b = prev.filter((s) => s.itemId === id).reduce((a, s) => a + n(s.qty), 0);
        if (q > g - b + 1e-9) throw new DocumentError(`${IT.get(id)?.name}: враќате ${q}, примено ${g}${b ? ', веќе вратено ' + b : ''}.`);
      }
    }
    const used = await tx.select({ t: supplierCredits.total }).from(supplierCredits).where(and(eq(supplierCredits.refPurchaseId, pur.id), existing ? ne(supplierCredits.id, existing.id) : undefined));
    const c = scrCalc({ rows }, ctx);
    const rest = n(pur.total) - used.reduce((a, x) => a + n(x.t), 0);
    if (c.total > rest + 1) throw new DocumentError(`Износот (${c.total}) е поголем од остатокот на влезната фактура (${rest.toFixed(2)}).`);
  } else warnings.push('Документот не е поврзан со влезна фактура.');

  let number = String(input.number ?? '').trim();
  const clash = number ? (await tx.select({ id: supplierCredits.id }).from(supplierCredits).where(and(eq(supplierCredits.firmId, firmId), eq(supplierCredits.number, number),
    sql`extract(year from ${supplierCredits.date}) = ${Number(input.date.slice(0, 4))}`, existing ? ne(supplierCredits.id, existing.id) : undefined)).limit(1)).length : 0;
  if (!number || clash) {
    const nn = await nextSupplierCreditNo(tx, firmId, input.date, existing?.id);
    if (clash) warnings.push(`Бројот ${number} веќе постои – доделен е следниот: ${nn}.`);
    number = nn;
  }
  const c = scrCalc({ rows }, ctx);
  const header = {
    firmId, status: 'posted' as const, kind: input.kind, number, date: input.date, supNo: input.supNo?.trim() || null, partnerId: input.partnerId,
    refPurchaseId: pur?.id ?? null, warehouseId: input.warehouseId || null, note: input.note?.trim() || null, scanned: !!input.scanned,
    base: c.base.toFixed(2), vat: c.vat.toFixed(2), total: c.total.toFixed(2), updatedBy: actor.userId,
  };
  let id: string;
  if (existing) {
    await tx.update(supplierCredits).set(header).where(eq(supplierCredits.id, existing.id));
    await tx.delete(supplierCreditLines).where(eq(supplierCreditLines.creditId, existing.id));
    id = existing.id;
  } else id = (await tx.insert(supplierCredits).values({ ...header, createdBy: actor.userId }).returning({ id: supplierCredits.id }))[0]!.id;
  await tx.insert(supplierCreditLines).values(rows.map((r) => ({ creditId: id, lineNo: r.lineNo, itemId: r.itemId || null, name: r.name || IT.get(r.itemId!)?.name || '', qty: String(r.qty), price: String(r.price), rate: r.rate, account: r.account || '' })));

  let lines;
  try {
    lines = scrEntries({ id, kind: input.kind, date: input.date, number, partner: input.partnerId, wh: input.warehouseId ?? undefined,
      refPurchase: pur ? { imp: pur.imp, supKonto: pur.supplierAccount ?? undefined } : null,
      rows: rows.map((r) => ({ item: r.itemId ?? undefined, name: r.name, qty: r.qty, price: r.price, rate: r.rate, konto: r.account || undefined })) },
    ctx, loc ? { kind: loc.kind, konto: loc.konto, kMarg: loc.kMarg, kVat: loc.kVat } : null);
  } catch (e) {
    if (e instanceof CorePostingError) throw new DocumentError(e.message);
    throw e;
  }
  await postJournal(tx, {
    firmId, date: input.date, kind: 'povrat', sourceType: 'supplier_credit', sourceId: id, userId: actor.userId,
    description: (input.kind === 'ret' ? 'Повратница до добавувач ' : 'Одобрение од добавувач ') + number,
    lines: lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, partnerId: l.partnerId || null, note: l.note ?? null, doc: input.supNo || number })),
    auditAction: 'postSupplierCredit',
  });
  await tx.delete(stockMoves).where(and(eq(stockMoves.firmId, firmId), eq(stockMoves.sourceType, 'supplier_credit'), eq(stockMoves.sourceId, id)));
  if (input.kind === 'ret') await tx.insert(stockMoves).values(rows.map((r) => ({
    firmId, itemId: r.itemId!, warehouseId: input.warehouseId || null, date: input.date, qty: String(-r.qty), value: String(-Math.round(r.qty * r.price)),
    direction: 'out' as const, moveType: 'supret', sourceType: 'supplier_credit', sourceId: id, lineNo: r.lineNo, label: 'Повратница до добавувач ' + number,
  })));
  await audit(tx, { userId: actor.userId, firmId, action: 'scrSave', entityType: 'supplier_credit', entityId: id, data: { kind: input.kind, number, total: c.total } });
  return { id, number, warnings };
}

export async function deleteSupplierCredit(tx: Tx, firmId: string, id: string, actor: Actor): Promise<void> {
  const [d] = await tx.select().from(supplierCredits).where(and(eq(supplierCredits.id, id), eq(supplierCredits.firmId, firmId))).limit(1);
  if (!d) throw new DocumentError('Документот не постои.');
  await unpostSource(tx, { firmId, sourceType: 'supplier_credit', sourceId: id, userId: actor.userId });
  await tx.delete(stockMoves).where(and(eq(stockMoves.firmId, firmId), eq(stockMoves.sourceType, 'supplier_credit'), eq(stockMoves.sourceId, id)));
  await tx.delete(supplierCredits).where(eq(supplierCredits.id, id));
  await audit(tx, { userId: actor.userId, firmId, action: 'scrDel', entityType: 'supplier_credit', entityId: id, data: { number: d.number } });
}
