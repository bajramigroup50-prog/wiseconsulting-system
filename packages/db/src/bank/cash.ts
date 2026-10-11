/**
 * Cash register (благајна): registers, vouchers (уплатница / исплатница) posted through `blgEntries`, and the
 * cash book (благајнички дневник = account card of the register konto with the vouchers).
 *
 * Nalog numbering: one nalog per register and period whose code is the register konto (legacy note in
 * `blgSetHTML`: "1020/7-9, 1051/7-9…"), journal kind `kasa`.
 */
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  accountCard, blgEntries, CASH_EXPENSE_CATEGORIES, cashExpenseAccount, cashVoucherDuplicate, cashVoucherNextNo, defaultCashRegisters, fxRate, nalogNumber, r2,
  type CashVoucher,
} from '@wise/core';
import { audit, type Tx } from '../audit';
import { firmNalogSettings, assertOpenPeriod, missingAccounts, postJournal, unpostSource } from '../posting';
import { loadLedgerLines } from '../ledger-queries';
import { cashRegisters, cashVouchers, fileLinks, files, journalLines, journals, partners, type CashRegister, type CashVoucherRow } from '../schema/index';
import { firmPostingContext, loadFirm, loadFxSources } from './context';

export const CASH_SOURCE_TYPE = 'cash_voucher';

/** Every expense konto a category may use (to check which exist in the firm chart). */
const CASH_KONTA = [...new Set(['44010', '44011', '44021', ...Object.values(CASH_EXPENSE_CATEGORIES).flatMap((c) => [...c[1]])])];

export class CashError extends Error {
  constructor(m: string) { super(m); this.name = 'CashError'; }
}

export async function loadRegisters(tx: Tx, firmId: string): Promise<CashRegister[]> {
  return tx.select().from(cashRegisters).where(eq(cashRegisters.firmId, firmId)).orderBy(asc(cashRegisters.sort), asc(cashRegisters.createdAt));
}

/** Create the legacy default registers (1020 MKD, 1051/1052 EUR when in the chart). */
export async function createDefaultRegisters(tx: Tx, a: { firmId: string; userId: string | null }): Promise<number> {
  if ((await loadRegisters(tx, a.firmId)).length) return 0;
  const missing = new Set(await missingAccounts(tx, a.firmId, ['1020', '1051', '1052']));
  const R = defaultCashRegisters((k) => !missing.has(k));
  await tx.insert(cashRegisters).values(R.map((r, i) => ({ firmId: a.firmId, name: r.name, konto: r.konto, cur: r.cur, sort: i })));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'blgSetSave', entityType: 'cash_register', data: { registers: R } });
  return R.length;
}

export interface RegisterInput { id?: string | null; name: string; konto: string; cur: string }

export async function saveRegister(tx: Tx, a: { firmId: string; userId: string | null; input: RegisterInput }): Promise<string> {
  const v = a.input;
  if (!v.name.trim()) throw new CashError('Внесете назив на благајната.');
  if (!/^\d{2,10}$/.test(v.konto)) throw new CashError('Неважечко конто.');
  const cur = (v.cur || 'MKD').toUpperCase();
  if ((await missingAccounts(tx, a.firmId, [v.konto])).length) throw new CashError(`Контото ${v.konto} не постои во контниот план.`);
  const data = { name: v.name.trim(), konto: v.konto, cur };
  if (v.id) {
    const [b] = await tx.select().from(cashRegisters).where(and(eq(cashRegisters.id, v.id), eq(cashRegisters.firmId, a.firmId))).limit(1);
    if (!b) throw new CashError('Благајната не постои.');
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(cashVouchers).where(eq(cashVouchers.registerId, v.id))) as [{ n: number }];
    if (n && (b.konto !== v.konto || b.cur !== cur)) throw new CashError('Благајната има документи – контото и валутата не може да се менуваат.');
    await tx.update(cashRegisters).set(data).where(eq(cashRegisters.id, v.id));
    await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'blgSetSave', entityType: 'cash_register', entityId: v.id, data });
    return v.id;
  }
  const [{ mx }] = (await tx.select({ mx: sql<number>`coalesce(max(${cashRegisters.sort}), 0)::int` }).from(cashRegisters).where(eq(cashRegisters.firmId, a.firmId))) as [{ mx: number }];
  const [r] = await tx.insert(cashRegisters).values({ firmId: a.firmId, ...data, sort: mx + 1 }).returning({ id: cashRegisters.id });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'blgSetAdd', entityType: 'cash_register', entityId: r!.id, data });
  return r!.id;
}

export async function removeRegister(tx: Tx, a: { firmId: string; userId: string | null; id: string }): Promise<void> {
  const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(cashVouchers).where(eq(cashVouchers.registerId, a.id))) as [{ n: number }];
  if (n) throw new CashError(`Благајната има ${n} документи и не може да се отстрани.`);
  const [r] = await tx.delete(cashRegisters).where(and(eq(cashRegisters.id, a.id), eq(cashRegisters.firmId, a.firmId))).returning();
  if (r) await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'blgSetRm', entityType: 'cash_register', entityId: r.id, data: { name: r.name, konto: r.konto } });
}

/** Next У-/И- number of a register for the year of `date`. */
export async function nextVoucherNo(tx: Tx, registerId: string, kind: 'in' | 'out', date: string): Promise<string> {
  const y = date.slice(0, 4);
  const L = await tx.select({ n: cashVouchers.number }).from(cashVouchers)
    .where(and(eq(cashVouchers.registerId, registerId), eq(cashVouchers.kind, kind), sql`${cashVouchers.date} between ${y + '-01-01'} and ${y + '-12-31'}`));
  return cashVoucherNextNo(kind, L.map((r) => r.n));
}

export interface VoucherInput {
  id?: string | null;
  registerId: string;
  kind: 'in' | 'out';
  date: string;
  number?: string | null;
  docNo?: string | null;
  merchant?: string | null;
  vatId?: string | null;
  country?: string | null;
  cur?: string | null;
  amt: number;
  /** MKD per unit; empty = from the rate list (`fxRate`). */
  fx?: number | null;
  vatRate?: number | null;
  vat?: number | null;
  cat?: string | null;
  konto?: string | null;
  partnerId?: string | null;
  note?: string | null;
  payK?: string | null;
  liters?: number | null;
  fileId?: string | null;
}

export const voucherToCore = (v: Pick<CashVoucherRow, 'id' | 'kind' | 'date' | 'number' | 'docNo' | 'merchant' | 'vatId' | 'country' | 'cur' | 'amt' | 'fx' | 'vatRate' | 'vat' | 'cat' | 'konto' | 'partnerId' | 'note' | 'payK' | 'registerId'>): CashVoucher => ({
  id: v.id, kind: v.kind, reg: v.registerId, date: v.date, number: v.number, docNo: v.docNo ?? undefined, merchant: v.merchant ?? undefined,
  vatId: v.vatId ?? undefined, country: v.country, cur: v.cur, amt: Number(v.amt), fx: Number(v.fx), rate: v.vatRate,
  vat: v.vat == null ? null : Number(v.vat), cat: v.cat ?? undefined, konto: v.konto ?? undefined, partner: v.partnerId ?? undefined,
  note: v.note ?? undefined, payK: v.payK ?? undefined,
});

/** Post (or re-post) one voucher. */
export async function postVoucher(tx: Tx, v: CashVoucherRow, reg: CashRegister, userId: string | null): Promise<string> {
  const f = await loadFirm(tx, v.firmId);
  const ctx = await firmPostingContext(tx, f);
  const missing = new Set(await missingAccounts(tx, v.firmId, CASH_KONTA));
  const L = blgEntries(voucherToCore(v), ctx, { konto: reg.konto, cur: reg.cur }, { accountExists: (k) => !missing.has(k) });
  const settings = firmNalogSettings(f);
  const n = nalogNumber({ kind: 'kasa', date: v.date, settings: { ...settings, nalCodes: { ...(settings.nalCodes ?? {}), kasa: reg.konto } } });
  const j = await postJournal(tx, {
    firmId: v.firmId, date: v.date, kind: 'kasa', sourceType: CASH_SOURCE_TYPE, sourceId: v.id, userId,
    description: `${v.kind === 'in' ? 'Уплатница' : 'Исплатница'} ${v.number} – ${reg.name}`,
    ...(n.no ? { number: n.no } : {}),
    lines: L.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, partnerId: l.partnerId || null, note: l.note, doc: v.docNo || v.number, currency: l.cur ?? null, amountCur: l.amtCur ?? null })),
    meta: { registerId: reg.id },
    auditAction: 'postCashVoucher',
  });
  return j.number;
}

export interface SaveVoucherResult { id: string; number: string; nalog: string; duplicate?: string }

/** Save + post a voucher in one transaction (legacy ACT `blgSave`). */
export async function saveVoucher(tx: Tx, a: { firmId: string; userId: string | null; input: VoucherInput }): Promise<SaveVoucherResult> {
  const v = a.input;
  const f = await loadFirm(tx, a.firmId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) throw new CashError('Неважечки датум.');
  assertOpenPeriod(f, v.date);
  const [reg] = await tx.select().from(cashRegisters).where(and(eq(cashRegisters.id, v.registerId), eq(cashRegisters.firmId, a.firmId))).limit(1);
  if (!reg) throw new CashError('Благајната не постои.');
  if (!(v.amt > 0)) throw new CashError('Внесете износ.');
  const cur = (v.cur || reg.cur || 'MKD').toUpperCase();
  let fx = cur === 'MKD' ? 1 : Number(v.fx) || 0;
  if (cur !== 'MKD' && !fx) fx = fxRate(cur, v.date, await loadFxSources(tx, a.firmId));
  if (!fx) throw new CashError(`Нема курс за ${cur} – внесете го курсот.`);
  if (v.konto && !/^\d{2,10}$/.test(v.konto)) throw new CashError('Неважечко конто.');
  if (v.partnerId) {
    const [p] = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.id, v.partnerId), eq(partners.firmId, a.firmId))).limit(1);
    if (!p) throw new CashError('Комитентот не постои.');
  }
  const country = (v.country || 'MK').toUpperCase();
  let before: CashVoucherRow | undefined;
  if (v.id) {
    [before] = await tx.select().from(cashVouchers).where(and(eq(cashVouchers.id, v.id), eq(cashVouchers.firmId, a.firmId))).limit(1);
    if (!before) throw new CashError('Документот не постои.');
    assertOpenPeriod(f, before.date);
  }
  const number = v.number?.trim() || (before && before.registerId === reg.id && before.kind === v.kind ? before.number : await nextVoucherNo(tx, reg.id, v.kind, v.date));
  const row = {
    firmId: a.firmId, registerId: reg.id, kind: v.kind, date: v.date, number, docNo: v.docNo?.trim() || null, merchant: v.merchant?.trim() || null,
    vatId: v.vatId?.trim() || null, country, cur, amt: r2(v.amt).toFixed(2), fx: String(fx),
    vatRate: v.kind === 'out' && country === 'MK' ? Math.max(0, Math.round(Number(v.vatRate) || 0)) : 0,
    vat: v.vat == null || Number.isNaN(v.vat) ? null : r2(v.vat).toFixed(2), cat: v.kind === 'out' ? v.cat || 'other' : null,
    konto: v.konto || null, partnerId: v.partnerId || null, note: v.note?.trim() || null, payK: v.payK || null,
    liters: v.liters ? String(v.liters) : null, fileId: v.fileId || null,
  };
  let saved: CashVoucherRow;
  if (before) {
    [saved] = await tx.update(cashVouchers).set(row).where(eq(cashVouchers.id, before.id)).returning() as [CashVoucherRow];
  } else {
    [saved] = await tx.insert(cashVouchers).values({ ...row, createdBy: a.userId }).returning() as [CashVoucherRow];
  }
  if (saved.fileId) {
    const [fl] = await tx.select({ id: files.id }).from(files).where(and(eq(files.id, saved.fileId), eq(files.firmId, a.firmId))).limit(1);
    if (!fl) throw new CashError('Прикачената датотека не постои.');
    await tx.insert(fileLinks).values({ fileId: saved.fileId, entityType: CASH_SOURCE_TYPE, entityId: saved.id, role: 'receipt' }).onConflictDoNothing();
  }
  const nalog = await postVoucher(tx, saved, reg, a.userId);
  await audit(tx, {
    userId: a.userId, firmId: a.firmId, action: before ? 'blgSave' : 'blgNew', entityType: CASH_SOURCE_TYPE, entityId: saved.id,
    data: { number, kind: v.kind, date: v.date, amt: row.amt, cur, fx, register: reg.konto },
  });
  const others = await tx.select({ id: cashVouchers.id, docNo: cashVouchers.docNo, date: cashVouchers.date, amt: cashVouchers.amt, number: cashVouchers.number })
    .from(cashVouchers).where(and(eq(cashVouchers.firmId, a.firmId), eq(cashVouchers.date, v.date), ne(cashVouchers.id, saved.id)));
  const dup = cashVoucherDuplicate({ id: saved.id, docNo: saved.docNo, date: saved.date, amt: saved.amt }, others);
  return { id: saved.id, number, nalog, ...(dup ? { duplicate: dup.number } : {}) };
}

export async function deleteVoucher(tx: Tx, a: { firmId: string; userId: string | null; id: string }): Promise<void> {
  const f = await loadFirm(tx, a.firmId);
  const [v] = await tx.select().from(cashVouchers).where(and(eq(cashVouchers.id, a.id), eq(cashVouchers.firmId, a.firmId))).limit(1);
  if (!v) throw new CashError('Документот не постои.');
  assertOpenPeriod(f, v.date);
  await unpostSource(tx, { firmId: a.firmId, sourceType: CASH_SOURCE_TYPE, sourceId: v.id, userId: a.userId });
  await tx.delete(fileLinks).where(and(eq(fileLinks.entityType, CASH_SOURCE_TYPE), eq(fileLinks.entityId, v.id)));
  await tx.delete(cashVouchers).where(eq(cashVouchers.id, v.id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'blgDel', entityType: CASH_SOURCE_TYPE, entityId: v.id, data: { number: v.number, date: v.date, amt: v.amt, cur: v.cur } });
}

export interface CashBookRow {
  date: string; nalog: string | null; journalId?: string; voucher: CashVoucherRow | null; label: string; doc: string;
  debit: number; credit: number; balance: number; amtCur: number | null; balanceCur: number | null;
}

/**
 * Cash book of a register for [from, to] (legacy `blgLedger` + `VIEWS.blagajna` table): opening balance, every
 * ledger line on the register konto (vouchers and anything else booked there, e.g. cash withdrawn via the
 * bank statement) with the running balance, in denars and — for a foreign register — in its currency.
 */
export async function cashBook(tx: Tx, firmId: string, reg: CashRegister, from: string, to: string) {
  const y = from.slice(0, 4);
  const L = (await loadLedgerLines(tx, firmId, `${y}-01-01`, to)).filter((l) => l.account === reg.konto);
  const card = accountCard(L, { account: reg.konto, from, to });
  const ids = [...new Set(L.map((l) => l.journalId!).filter(Boolean))];
  const J = ids.length ? await tx.select({ id: journals.id, sourceType: journals.sourceType, sourceId: journals.sourceId }).from(journals).where(and(eq(journals.firmId, firmId), inArray(journals.id, ids))) : [];
  const jmap = new Map(J.map((j) => [j.id, j]));
  const V = await tx.select().from(cashVouchers).where(and(eq(cashVouchers.firmId, firmId), eq(cashVouchers.registerId, reg.id)));
  const vmap = new Map(V.map((v) => [v.id, v]));
  const fxR = reg.cur !== 'MKD';
  // currency amounts of the register konto (journal_lines.amount_cur), sign from the debit/credit side
  const curL = fxR ? await loadCurAmounts(tx, firmId, reg.konto, `${y}-01-01`, to) : new Map<string, number>();
  const curOf = (l: { journalId?: string; lineNo?: number; debit: number }) => {
    const v = curL.get(`${l.journalId}:${l.lineNo}`);
    return v == null ? 0 : (l.debit ? 1 : -1) * Math.abs(v);
  };
  const pre = L.filter((l) => l.date < from);
  let sc = fxR ? r2(pre.reduce((s, l) => s + curOf(l), 0)) : 0;
  const openingCur = sc;
  const rows: CashBookRow[] = card.rows.map(({ line: l, balance }) => {
    const j = jmap.get(l.journalId!);
    const v = j?.sourceType === CASH_SOURCE_TYPE ? vmap.get(j.sourceId!) ?? null : null;
    const ac = fxR ? curOf(l) : null;
    if (fxR) sc = r2(sc + (ac ?? 0));
    return {
      date: l.date, nalog: l.number ?? null, journalId: l.journalId, voucher: v,
      label: v ? v.merchant || v.note || (v.kind === 'in' ? 'Уплата' : '') : [l.description, l.note].filter(Boolean).join(' · '), // legacy: label · note
      doc: v ? v.docNo || '' : l.doc || '', debit: l.debit, credit: l.credit, balance, amtCur: ac, balanceCur: fxR ? sc : null,
    };
  });
  return { opening: card.opening, openingCur, debit: card.debit, credit: card.credit, closing: card.closing, closingCur: fxR ? sc : null, rows };
}

async function loadCurAmounts(tx: Tx, firmId: string, konto: string, from: string, to: string): Promise<Map<string, number>> {
  const R = await tx.select({ j: journalLines.journalId, n: journalLines.lineNo, a: journalLines.amountCur }).from(journalLines)
    .innerJoin(journals, eq(journals.id, journalLines.journalId))
    .where(and(eq(journalLines.firmId, firmId), eq(journalLines.account, konto), sql`${journals.date} between ${from} and ${to}`));
  return new Map(R.filter((r) => r.a != null).map((r) => [`${r.j}:${r.n}`, Number(r.a)]));
}

/** Expense konto suggested for a category (first candidate that exists in the firm's chart — legacy `blgKonto`). */
export async function suggestExpenseKonto(tx: Tx, firmId: string, cat: string, abroad: boolean): Promise<string> {
  const missing = new Set(await missingAccounts(tx, firmId, CASH_KONTA));
  return cashExpenseAccount(cat, abroad, (k) => !missing.has(k));
}

