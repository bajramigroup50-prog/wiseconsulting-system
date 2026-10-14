/**
 * Payment orders (ПП30 / ПП50 / ПП10) and the office exchange-rate list (Курсна листа).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  fixYuscii, mkBankName, openAmount, parseAccount, partnerAccounts, ppBatchOrders, ppErrors, ppIbanOn, ppPartyText, PP_T, r2,
  type PaymentOrder, type PpBatchItem, type PpKind, type PpOpenInvoice,
} from '@wise/core';
import { ppFillBanks, ppMuniCode, ppSortByDue, ppToStamp } from '@wise/core/bank/fin-parity';
import { audit, type Tx } from '../audit';
import { bankLines, employees, fxRates, partners, paymentOrders, purchases } from '../schema/index';
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

/**
 * The firm as payer (legacy `ppFirmPayer`): first MKD bank account, else `settings.bank`. The bank name comes from the
 * account's bank code (`MK_BANK_CODES`) — the bank-account record's `name` is a label such as „Сметка 270…“ given at
 * import, not the bank. Name / address / city are repaired from YUSCII leftovers („ДЕЛ^ЕВ“ → „ДЕЛЧЕВ“).
 */
export async function payerOf(tx: Tx, firmId: string) {
  const f = await loadFirm(tx, firmId);
  const A = (await loadBankAccounts(tx, firmId)).filter((a) => a.cur === 'MKD' && a.active !== false);
  const s = (f.settings ?? {}) as Record<string, unknown>;
  // Legacy `ppMuni` 15765: municipality code of the seat = `mpOpsFrom(muni ‖ city ‖ address)`.
  const muni = ppMuniCode({ muni: (s.muni as string) || '', city: f.city, address: f.address });
  const ok = A.find((a) => parseAccount(a.account || a.iban));
  const rec = ok ?? A[0];
  const acc = (ok ? ok.account || ok.iban : rec?.account) || (s.bank as string) || '';
  const accDigits = parseAccount(acc)?.acc || String(acc).replace(/\D/g, '');
  const label = rec?.name || (s.bankName as string) || '';
  // a label that is only the account / „Сметка …“ / „Банка …“ + digits is not a bank name
  const bankName = mkBankName(accDigits) || (/\d{6,}/.test(label) ? '' : label);
  return { name: fixYuscii(f.name), address: fixYuscii(f.address), city: fixYuscii(f.city), edb: f.edb, account: accDigits, bankName, muni };
}

export interface PpSuggestion { label: string; amount: number; date: string; due: string | null; recip: string; recipAcc: string; recipBank: string; refCredit: string; refId: string; partnerId: string; warn: string }

interface OpenPurchase { refId: string; partnerId: string; number: string; date: string; due: string | null; /** denars */ open: number }

/** Unpaid purchase invoices (open-items source minus bank payments), oldest due date first. */
async function openPurchases(tx: Tx, firmId: string, year: number): Promise<OpenPurchase[]> {
  const items = await openItemsSource().load(tx, firmId, year);
  const L = await tx.select().from(bankLines).where(and(eq(bankLines.firmId, firmId), eq(bankLines.refType, 'purchase')));
  const rows = L.map(toBankRow);
  // Legacy `ppSuggest` 15773: oldest due date first (else the document date).
  const D = await tx.select({ id: purchases.id, due: purchases.due }).from(purchases).where(eq(purchases.firmId, firmId));
  const due = new Map(D.map((d) => [d.id, d.due]));
  const open = items.purchases.map((x) => ({ x, o: openAmount(rows, 'purchase', x), date: x.date, due: due.get(x.id) ?? null })).filter((z) => z.o > 0);
  return ppSortByDue(open).map(({ x, o, due: dd }) => ({ refId: x.id, partnerId: x.partner ?? '', number: x.number || '', date: x.date, due: dd, open: den(o) }));
}

async function partnerMap(tx: Tx, firmId: string) {
  const P = await tx.select({ id: partners.id, name: partners.name, address: partners.address, city: partners.city, bankAccount: partners.bankAccount, bankName: partners.bankName, data: partners.data, active: partners.active })
    .from(partners).where(eq(partners.firmId, firmId));
  return new Map(P.map((p) => [p.id, { ...p, accounts: partnerAccounts(p) }]));
}

/**
 * Legacy `ppSuggest`: unpaid supplier invoices, oldest first (max `limit`, default 40), as ПП30 drafts with the
 * supplier's default account.
 */
export async function orderSuggestions(tx: Tx, firmId: string, year: number, limit = 40): Promise<PpSuggestion[]> {
  const [open, pm] = await Promise.all([openPurchases(tx, firmId, year), partnerMap(tx, firmId)]);
  return open.slice(0, limit).map((x) => {
    const p = x.partnerId ? pm.get(x.partnerId) : undefined;
    const a = p?.accounts.find((y) => y.def);
    const acc = a?.acc ?? '';
    return {
      label: `${p?.name ?? '—'} · ф-ра ${x.number || 'без број'} · ${(x.due || x.date).split('-').reverse().join('.')}`, amount: x.open, date: x.date, due: x.due,
      recip: p ? ppPartyText(p) : '', recipAcc: acc, recipBank: a?.bank ?? '',
      refCredit: x.number, refId: x.refId, partnerId: x.partnerId, warn: acc ? '' : 'нема жиро сметка кај добавувачот',
    };
  });
}

/** One choice of the „Примач“ picker on ПП30 (serializable — passed to the client). */
export interface PpRecipientOption {
  key: string; kind: 'partner' | 'employee'; name: string; address: string; city: string;
  accounts: { acc: string; bank: string; def: boolean }[];
  invoices: PpOpenInvoice[];
}

/**
 * Recipients for ПП30: partners with a bank account or an unpaid purchase invoice (with those invoices), and the active
 * employees with an account (net salary). Names / addresses repaired from YUSCII leftovers.
 */
export async function ppRecipients(tx: Tx, firmId: string, year: number): Promise<PpRecipientOption[]> {
  const [open, pm, E] = await Promise.all([
    openPurchases(tx, firmId, year), partnerMap(tx, firmId),
    tx.select({ id: employees.id, name: employees.name, address: employees.address, city: employees.city, bankAcc: employees.bankAcc, bank: employees.bank })
      .from(employees).where(and(eq(employees.firmId, firmId), eq(employees.active, true))),
  ]);
  const inv = new Map<string, PpOpenInvoice[]>();
  for (const x of open) if (x.partnerId) inv.set(x.partnerId, [...(inv.get(x.partnerId) ?? []), { refId: x.refId, number: x.number, date: x.date, due: x.due, open: x.open }]);
  const out: PpRecipientOption[] = [];
  for (const p of pm.values()) {
    const I = inv.get(p.id) ?? [];
    if (!p.accounts.length && !I.length) continue;
    if (!p.active && !I.length) continue;
    out.push({ key: 'p:' + p.id, kind: 'partner', name: fixYuscii(p.name), address: fixYuscii(p.address ?? ''), city: fixYuscii(p.city ?? ''),
      accounts: p.accounts.map((a) => ({ acc: a.acc, bank: a.bank, def: !!a.def })), invoices: I });
  }
  for (const e of E) {
    const a = parseAccount(e.bankAcc);
    if (!a) continue;
    out.push({ key: 'e:' + e.id, kind: 'employee', name: fixYuscii(e.name), address: fixYuscii(e.address ?? ''), city: fixYuscii(e.city ?? ''),
      accounts: [{ acc: a.acc || a.iban, bank: String(e.bank ?? '').trim() || a.bank, def: true }], invoices: [] });
  }
  return out.sort((a, b) => (b.invoices.length ? 1 : 0) - (a.invoices.length ? 1 : 0) || a.name.localeCompare(b.name, 'mk'));
}

/**
 * „Подготви ПП30 за избраните“: one saved ПП30 per supplier for the picked unpaid invoices (amount = Σ open,
 * purpose / reference = the invoice numbers). Returns the new order ids (for printing on one PDF) and the suppliers
 * without an account.
 */
export async function createSupplierPaymentOrders(tx: Tx, a: { firmId: string; userId: string | null; year: number; refIds: string[]; date: string }): Promise<{ ids: string[]; missing: string[] }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date)) throw new OrderError('Неважечки датум.');
  const want = new Set(a.refIds);
  const [open, pm, payer] = await Promise.all([openPurchases(tx, a.firmId, a.year), partnerMap(tx, a.firmId), payerOf(tx, a.firmId)]);
  const picked = open.filter((x) => want.has(x.refId) && x.partnerId);
  if (!picked.length) throw new OrderError('Изберете барем една неплатена фактура (со добавувач).');
  const items: PpBatchItem[] = picked.map((x) => {
    const p = pm.get(x.partnerId);
    const d = p?.accounts.find((y) => y.def);
    return { ...x, party: { name: p?.name ?? '', address: p?.address, city: p?.city, acc: d?.acc ?? '', bank: d?.bank ?? '' } };
  });
  const ids: string[] = [];
  const missing: string[] = [];
  for (const b of ppBatchOrders(items, payer, a.date, { iban: ppIbanOn(a.date) })) {
    ids.push(await savePaymentOrder(tx, { firmId: a.firmId, userId: a.userId, order: { ...b.order, refIds: b.refIds }, refId: b.refIds[0] ?? null }));
    if (b.missing) missing.push(pm.get(b.partnerId)?.name ?? '—');
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'ppBatch', entityType: 'payment_order', data: { ids, refIds: picked.map((x) => x.refId), missing } });
  return { ids, missing };
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
