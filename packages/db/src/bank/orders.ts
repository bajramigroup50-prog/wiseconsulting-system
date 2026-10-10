/**
 * Payment orders (ПП30 / ПП50 / ПП10) and the office exchange-rate list (Курсна листа).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { openAmount, ppErrors, PP_T, r2, type PaymentOrder, type PpKind } from '@wise/core';
import { ppFillBanks, ppMuniCode, ppSortByDue, ppToStamp } from '@wise/core/bank/fin-parity';
import { audit, type Tx } from '../audit';
import { bankLines, fxRates, partners, paymentOrders, purchases } from '../schema/index';
import { den, loadBankAccounts, loadFirm } from './context';
import { openItemsSource } from './open-items';
import { toBankRow } from './rows';
import { getOfficeProfile, patchOfficeProfile } from '../office';

export class OrderError extends Error {
  constructor(m: string) { super(m); this.name = 'OrderError'; }
}

const KINDS: PpKind[] = ['pp30', 'pp50', 'pp10'];

export async function savePaymentOrder(tx: Tx, a: { firmId: string; userId: string | null; id?: string | null; order: PaymentOrder; refId?: string | null }): Promise<string> {
  // Legacy `ppRender` 15820: empty bank names are filled from the account's bank code.
  const n = ppFillBanks(a.order);
  if (!KINDS.includes(n.kind)) throw new OrderError('Непознат вид налог.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(n.date)) throw new OrderError('Неважечки датум.');
  const E = ppErrors(n);
  if (E.length) throw new OrderError(E.join(' '));
  const amount = n.amount == null || Number.isNaN(Number(n.amount)) ? null : r2(Number(n.amount));
  const data = { ...n, amount } as unknown as Record<string, unknown>;
  const row = { firmId: a.firmId, kind: n.kind, date: n.date, amount: amount == null ? null : amount.toFixed(2), recipient: (n.recip || '').split('\n')[0] || null, data, refId: a.refId ?? null };
  if (a.id) {
    const [r] = await tx.update(paymentOrders).set(row).where(and(eq(paymentOrders.id, a.id), eq(paymentOrders.firmId, a.firmId))).returning({ id: paymentOrders.id });
    if (!r) throw new OrderError('Налогот не постои.');
    await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'ppSave', entityType: 'payment_order', entityId: r.id, data: { kind: n.kind, amount, recip: row.recipient } });
    return r.id;
  }
  const [r] = await tx.insert(paymentOrders).values({ ...row, createdBy: a.userId }).returning({ id: paymentOrders.id });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'ppSave', entityType: 'payment_order', entityId: r!.id, data: { kind: n.kind, amount, recip: row.recipient, new: true } });
  return r!.id;
}

export async function deletePaymentOrder(tx: Tx, a: { firmId: string; userId: string | null; id: string }): Promise<void> {
  const [r] = await tx.delete(paymentOrders).where(and(eq(paymentOrders.id, a.id), eq(paymentOrders.firmId, a.firmId))).returning();
  if (!r) throw new OrderError('Налогот не постои.');
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'ppDel', entityType: 'payment_order', entityId: r.id, data: { kind: r.kind, amount: r.amount, recip: r.recipient } });
}

/** Legacy `ppPrint` 15800: stamp `printed` on the printed orders — only on the first print (`!d.printed`). */
export async function markOrdersPrinted(tx: Tx, a: { firmId: string; userId: string | null; ids: string[] }): Promise<number> {
  if (!a.ids.length) return 0;
  const L = await tx.select({ id: paymentOrders.id, printedAt: paymentOrders.printedAt }).from(paymentOrders).where(and(eq(paymentOrders.firmId, a.firmId), inArray(paymentOrders.id, a.ids)));
  const ids = ppToStamp(L);
  if (!ids.length) return 0;
  await tx.update(paymentOrders).set({ printedAt: new Date() }).where(and(eq(paymentOrders.firmId, a.firmId), inArray(paymentOrders.id, ids), isNull(paymentOrders.printedAt)));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'ppPrint', entityType: 'payment_order', data: { ids } });
  return ids.length;
}

/** The firm as payer (legacy `ppFirmPayer`): first MKD bank account, else `settings.bank`. */
export async function payerOf(tx: Tx, firmId: string) {
  const f = await loadFirm(tx, firmId);
  const A = (await loadBankAccounts(tx, firmId)).filter((a) => a.cur === 'MKD');
  const s = (f.settings ?? {}) as Record<string, unknown>;
  // Legacy `ppMuni` 15765: municipality code of the seat = `mpOpsFrom(muni ‖ city ‖ address)`.
  const muni = ppMuniCode({ muni: (s.muni as string) || '', city: f.city, address: f.address });
  return { name: f.name, address: f.address, city: f.city, edb: f.edb, account: A[0]?.account || (s.bank as string) || '', bankName: A[0]?.name || (s.bankName as string) || '', muni };
}

export interface PpSuggestion { label: string; amount: number; date: string; due: string | null; recip: string; recipAcc: string; refCredit: string; refId: string; warn: string }

/**
 * Legacy `ppSuggest`: unpaid supplier invoices, oldest first (max 40), as ПП30 drafts. Open amounts come from
 * the open-items source (Phase 3 documents — see open-items.ts) minus bank payments.
 */
export async function orderSuggestions(tx: Tx, firmId: string, year: number): Promise<PpSuggestion[]> {
  const items = await openItemsSource().load(tx, firmId, year);
  const L = await tx.select().from(bankLines).where(and(eq(bankLines.firmId, firmId), eq(bankLines.refType, 'purchase')));
  const rows = L.map(toBankRow);
  const P = await tx.select({ id: partners.id, name: partners.name, address: partners.address, city: partners.city, bank: partners.bankAccount }).from(partners).where(eq(partners.firmId, firmId));
  const pm = new Map(P.map((p) => [p.id, p]));
  // Legacy `ppSuggest` 15773: oldest due date first (else the document date).
  const D = await tx.select({ id: purchases.id, due: purchases.due }).from(purchases).where(eq(purchases.firmId, firmId));
  const due = new Map(D.map((d) => [d.id, d.due]));
  const open = items.purchases.map((x) => ({ x, o: openAmount(rows, 'purchase', x), date: x.date, due: due.get(x.id) ?? null })).filter((z) => z.o > 0);
  return ppSortByDue(open)
    .slice(0, 40)
    .map(({ x, o, due: dd }) => {
      const p = x.partner ? pm.get(x.partner) : undefined;
      const acc = String(p?.bank ?? '').replace(/\D/g, '');
      return {
        label: `${p?.name ?? '—'} · ф-ра ${x.number || 'без број'} · ${(dd || x.date).split('-').reverse().join('.')}`, amount: den(o), date: x.date, due: dd,
        recip: [p?.name, [p?.address, p?.city].filter(Boolean).join(', ')].filter(Boolean).join('\n'), recipAcc: acc,
        refCredit: x.number || '', refId: x.id, warn: acc.length !== 15 ? 'нема жиро сметка кај добавувачот' : '',
      };
    });
}

export const ppTitle = (k: PpKind) => PP_T[k];

/* ---------------- exchange-rate list ---------------- */

/** Save one day's rate list (legacy `fxSave` → `appsettings/fx`). Replaces that day's rows. */
export async function saveFxList(tx: Tx, a: { userId: string | null; date: string; rows: { cur: string; rate: number }[]; orig?: string | null }): Promise<number> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date)) throw new OrderError('Неважечки датум.');
  const R = a.rows.map((r) => ({ cur: r.cur.trim().toUpperCase(), rate: Number(r.rate) })).filter((r) => /^[A-Z]{3}$/.test(r.cur) && r.rate > 0 && r.cur !== 'MKD');
  const seen = new Set<string>();
  for (const r of R) { if (seen.has(r.cur)) throw new OrderError(`Валутата ${r.cur} е внесена двапати.`); seen.add(r.cur); }
  if (!R.length) throw new OrderError('Внесете барем еден курс.');
  // Legacy `fxSave` 7966: editing a list under a new date removes the list of the original date (`orig`).
  const orig = a.orig && /^\d{4}-\d{2}-\d{2}$/.test(a.orig) && a.orig !== a.date ? a.orig : null;
  await tx.delete(fxRates).where(orig ? inArray(fxRates.date, [a.date, orig]) : eq(fxRates.date, a.date));
  await tx.insert(fxRates).values(R.map((r) => ({ date: a.date, cur: r.cur, rate: String(r.rate), updatedBy: a.userId })));
  await audit(tx, { userId: a.userId, firmId: null, action: 'fxSave', entityType: 'fx_rates', entityId: a.date, data: { rows: R, ...(orig ? { orig } : {}) } });
  return R.length;
}

export async function deleteFxList(tx: Tx, a: { userId: string | null; date: string }): Promise<void> {
  const R = await tx.delete(fxRates).where(eq(fxRates.date, a.date)).returning();
  await audit(tx, { userId: a.userId, firmId: null, action: 'fxDel', entityType: 'fx_rates', entityId: a.date, data: { rows: R.map((r) => ({ cur: r.cur, rate: r.rate })) } });
}

/* ---------------- print calibration ---------------- */

/**
 * Legacy `ppRender` calibration listener 15823: offset (mm) of the data on pre-printed forms, per form kind, stored
 * office-wide in `appsettings/office.ppCal[kind] = {dx, dy}` (read by the print view).
 */
export async function savePpCalibration(tx: Tx, a: { userId: string | null; firmId?: string | null; kind: PpKind; dx: number; dy: number }): Promise<void> {
  if (!KINDS.includes(a.kind)) throw new OrderError('Непознат вид налог.');
  const off = (await getOfficeProfile(tx)) as Record<string, unknown>;
  const all = { ...((off.ppCal ?? {}) as Record<string, { dx?: number; dy?: number }>) };
  all[a.kind] = { dx: a.dx, dy: a.dy };
  await patchOfficeProfile(tx, { ppCal: all } as never, a.userId);
  await audit(tx, { userId: a.userId, firmId: a.firmId ?? null, action: 'ppCal', entityType: 'app_settings', entityId: 'office', data: { kind: a.kind, dx: a.dx, dy: a.dy } });
}
