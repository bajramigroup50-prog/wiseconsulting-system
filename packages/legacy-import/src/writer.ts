/**
 * Database side of the legacy import: one firm per transaction.
 *
 * Order: firm → chart overrides → codebooks, partners, items, employees → bank accounts, cash registers → documents
 * (invoices, purchases, credits, cash, compensations, statements, Z reports, payroll, production, stock documents,
 * stock moves, fixed assets, office / HR / industry records, everything else as `firm_docs`) → journals (the legacy
 * ledger, posted through the posting service `postJournal`) → VAT periods, year closings → lock date → trial-balance
 * check → one `audit_log` row.
 *
 * Idempotency: every imported record is registered in `legacy_id_map` (firm, kind, legacy id → new id). Re-importing
 * updates the mapped rows in place (children are replaced), journals are re-posted in place (same source / same id),
 * so nothing is duplicated. Records removed from the legacy data since the last import are left alone and reported.
 *
 * A record that cannot be written to its table (missing partner, duplicate number against data entered on the server,
 * …) is written as a `firm_docs` row of its legacy type instead, inside a savepoint, and listed in the report.
 */
import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { NEW_ACCOUNT_CODE_RE, nalogNumber, r2 } from '@wise/core';
import {
  accounts, appSettings, appointments, audit, bankAccounts, bankLines, bankStatements, boms, cashRegisters, cashVouchers, codes,
  compensations, constructionDiary, constructionProjects, constructionSituations, depreciationRuns, dossierDocs, employees,
  fileLinks, files, firmDocs, firmNalogSettings, firms, fixedAssets, fleetVehicles, freightTours, fxRates, hotelReservations,
  hotelRooms, hrDocs, inboxItems, invoiceAdvances, invoiceLines, invoices, itemBarcodes, items, journalLines, journals, legacyIdMap,
  levellingDocs, missingAccounts, partners, paymentOrders, payrollEmp, payrollLines, payrollRuns, postJournal, productionOrders,
  purchaseCosts, purchaseStockLines, purchaseVatGroups, purchases, recurringInvoices, rentRentals, salesDaily, serviceContracts,
  stockCounts, stockMoves, supplierCreditLines, supplierCredits, transfers, travelArrangements, travelBookings, updateJournal,
  userFirms, users, vatPeriods, yearClosings, type Tx,
} from '@wise/db';
import { LEGACY_COLS, collectionCounts, type LDoc, type LegacyBundle, type LegacyFirmBackup, type LegacyUser } from './format';
import { compareTrialBalances, legacyLedger, trialBalanceOf, type LegacySource, type TbDiff, type TbRow } from './ledger';
import * as M from './map';
import { MapSkip, type RefKind, type Resolve } from './map';
import { arr, isoDate, obj, str } from './util';

/* ------------------------------------------------------------------ report */

export interface SkipEntry { what: string; reason: string }
export interface FirmReport {
  legacyId: string;
  name: string;
  firmId: string | null;
  /** `created` = new firm on the server, `updated` = re-import of an already imported firm, `failed` = rolled back. */
  status: 'created' | 'updated' | 'failed';
  source: string;
  backupAt: string | null;
  /** Records in the backup per legacy collection. */
  legacyCounts: Record<string, number>;
  /** Rows written per target (`partners`, `invoices`, `journals`, …). */
  counts: Record<string, number>;
  /** Records stored as `firm_docs` because their table does not exist (by legacy `docs.type`). */
  firmDocs: Record<string, number>;
  skipped: SkipEntry[];
  warnings: string[];
  journals: { posted: number; failed: number };
  trialBalance: { ok: boolean; legacy: { debit: number; credit: number }; imported: { debit: number; credit: number }; diffs: TbDiff[] };
  files: { imported: number; unavailable: number };
  /** Previously imported records that are no longer in the backup (left untouched). */
  stale: number;
  error?: string;
  ms: number;
}
export interface UsersReport { imported: number; updated: number; skipped: SkipEntry[] }
export interface ImportReport { firms: FirmReport[]; users: UsersReport | null; settings: string[]; warnings: string[] }

/** Object storage for files found inside the backup (data-URL images). */
export interface FileSink { put(key: string, body: Uint8Array, mime: string): Promise<void> }

export interface ImportOptions {
  userId: string | null;
  runId?: string | null;
  glob?: Record<string, unknown>;
  /** Off-balance VAT-base lines (994/999), default true like legacy. */
  vatBaseLines?: boolean;
  files?: FileSink | null;
  progress?: (step: string) => void | Promise<void>;
}

/* ------------------------------------------------------------------ id map */

const ZERO = '00000000-0000-0000-0000-000000000000';

class IdMap {
  private m = new Map<string, string>();
  private journal: string[][] = [];
  touched = new Set<string>();
  constructor(private tx: Tx, private firmId: string | null, private runId: string | null) {}
  async load(): Promise<void> {
    const rows = await this.tx.select({ kind: legacyIdMap.kind, legacyId: legacyIdMap.legacyId, entityId: legacyIdMap.entityId }).from(legacyIdMap)
      .where(this.firmId ? eq(legacyIdMap.firmId, this.firmId) : isNull(legacyIdMap.firmId));
    for (const r of rows) this.m.set(r.kind + '\u0000' + r.legacyId, r.entityId);
  }
  setFirm(firmId: string) { this.firmId = firmId; }
  get(kind: string, legacyId: unknown): string | null {
    if (legacyId == null || legacyId === '') return null;
    return this.m.get(kind + '\u0000' + String(legacyId)) ?? null;
  }
  keys(kindPrefix: string): [string, string][] {
    return [...this.m].filter(([k]) => k.startsWith(kindPrefix)).map(([k, v]) => [k.split('\u0000')[1]!, v]);
  }
  async set(kind: string, legacyId: string, entityId: string): Promise<void> {
    const key = kind + '\u0000' + legacyId;
    this.touched.add(key);
    const prev = this.m.get(key);
    if (prev === entityId) {
      await this.tx.update(legacyIdMap).set({ runId: this.runId })
        .where(and(this.firmId ? eq(legacyIdMap.firmId, this.firmId) : isNull(legacyIdMap.firmId), eq(legacyIdMap.kind, kind), eq(legacyIdMap.legacyId, legacyId)));
      return;
    }
    this.journal.at(-1)?.push(key);
    if (prev) {
      await this.tx.update(legacyIdMap).set({ entityId, runId: this.runId })
        .where(and(this.firmId ? eq(legacyIdMap.firmId, this.firmId) : isNull(legacyIdMap.firmId), eq(legacyIdMap.kind, kind), eq(legacyIdMap.legacyId, legacyId)));
    } else {
      await this.tx.insert(legacyIdMap).values({ firmId: this.firmId, kind, legacyId, entityId, runId: this.runId });
    }
    this.m.set(key, entityId);
  }
  /** Savepoint bookkeeping: forget keys set inside a rolled-back savepoint. */
  begin() { this.journal.push([]); }
  commit() { const j = this.journal.pop() ?? []; this.journal.at(-1)?.push(...j); }
  rollback(snapshot: Map<string, string>) { this.journal.pop(); this.m = snapshot; }
  snapshot() { return new Map(this.m); }
  /** Mapped records of the firm that were not touched by this import. */
  staleCount(): number { return [...this.m.keys()].filter((k) => !this.touched.has(k)).length; }
}

/* ------------------------------------------------------------------ helpers */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTable = any;

const errMsg = (e: unknown): string => {
  const x = e as { message?: string; cause?: { message?: string }; detail?: string };
  const m = x?.cause?.message ?? x?.message ?? String(e);
  return m.length > 300 ? m.slice(0, 300) + '…' : m;
};

const DATA_URL_RE = /^data:([\w.+-]+\/[\w.+-]+)?(;base64)?,(.*)$/s;
const extOf = (mime: string) => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'application/pdf': 'pdf' } as Record<string, string>)[mime] ?? 'bin';

/** Count references to claude.ai assets (`files[]`, `photos[]`, `scans[]` items with an id, `/_blob/<id>` strings). */
function countAssetRefs(v: unknown, depth = 0): number {
  if (depth > 6 || v == null) return 0;
  if (typeof v === 'string') return v.startsWith('/_blob/') ? 1 : 0;
  if (Array.isArray(v)) return v.reduce((s, x) => s + countAssetRefs(x, depth + 1), 0);
  if (typeof v === 'object') {
    let n = 0;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if ((k === 'files' || k === 'photos' || k === 'scans') && Array.isArray(x)) n += x.filter((f) => f && typeof f === 'object' && 'id' in f).length;
      else n += countAssetRefs(x, depth + 1);
    }
    return n;
  }
  return 0;
}

/* ------------------------------------------------------------------ firm import */

class FirmImport {
  rep: FirmReport;
  ids!: IdMap;
  firmId = '';
  private usedNumbers = new Map<string, Set<string>>();
  private journalIds: string[] = [];

  constructor(private tx: Tx, private fb: LegacyFirmBackup, private o: ImportOptions) {
    this.rep = {
      legacyId: fb.firm.id, name: String(fb.firm.name ?? fb.firm.id), firmId: null, status: 'created', source: fb.source, backupAt: fb.at,
      legacyCounts: collectionCounts(fb.data), counts: {}, firmDocs: {}, skipped: [], warnings: [], journals: { posted: 0, failed: 0 },
      trialBalance: { ok: true, legacy: { debit: 0, credit: 0 }, imported: { debit: 0, credit: 0 }, diffs: [] },
      files: { imported: 0, unavailable: 0 }, stale: 0, ms: 0,
    };
  }

  private count(k: string, n = 1) { this.rep.counts[k] = (this.rep.counts[k] ?? 0) + n; }
  private async step(s: string) { await this.o.progress?.(s); }

  /** Run `fn` in a savepoint; the id map follows the savepoint (rolled back keys are forgotten). */
  private async trySp<T>(fn: (tx: Tx) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
    const snap = this.ids.snapshot();
    this.ids.begin();
    try {
      const value = await this.tx.transaction(async (sp) => fn(sp as unknown as Tx));
      this.ids.commit();
      return { ok: true, value };
    } catch (error) {
      this.ids.rollback(snap);
      return { ok: false, error };
    }
  }

  /** Run `fn` in a savepoint; on failure record the reason and return undefined. */
  private async attempt<T>(what: string, fn: (tx: Tx) => Promise<T>): Promise<T | undefined> {
    const r = await this.trySp(fn);
    if (r.ok) return r.value;
    this.rep.skipped.push({ what, reason: errMsg(r.error) });
    return undefined;
  }

  /** Insert or update (by the id map) one row; returns its id. */
  private async upsert(tx: Tx, kind: string, legacyId: string, table: AnyTable, values: Record<string, unknown>): Promise<{ id: string; created: boolean }> {
    const id = this.ids.get(kind, legacyId);
    if (id) {
      const r = await tx.update(table).set(values).where(eq(table.id, id)).returning({ id: table.id });
      if (r.length) { await this.ids.set(kind, legacyId, id); return { id, created: false }; }
    }
    const [r] = await tx.insert(table).values(values).returning({ id: table.id });
    const nid = (r as { id: string }).id;
    await this.ids.set(kind, legacyId, nid);
    return { id: nid, created: true };
  }

  /** Unique document number inside a scope (duplicates in the legacy data get a suffix, LEGACY-MAP 11.4 item 4). */
  private uniq(scope: string, number: string, what: string): string {
    const S = this.usedNumbers.get(scope) ?? new Set<string>();
    this.usedNumbers.set(scope, S);
    let n = number, i = 2;
    while (S.has(n)) n = `${number}/${i++}`;
    if (n !== number) this.rep.warnings.push(`${what}: бројот „${number}“ се повторува – увезен е како „${n}“.`);
    S.add(n);
    return n;
  }

  /** Store a record in the generic `firm_docs` table. */
  private async firmDoc(d: LDoc, type: string, reason?: string): Promise<void> {
    const v = M.mapFirmDoc(d, type);
    const r = await this.attempt(`${type} ${d.number ?? d.id}`, (tx) => this.upsert(tx, 'firm_doc', d.id, firmDocs, { ...v, firmId: this.firmId, data: { ...v.data, legacyId: d.id, ...(reason ? { importNote: reason } : {}) } }));
    if (r) { this.rep.firmDocs[type] = (this.rep.firmDocs[type] ?? 0) + 1; this.count('firm_docs'); }
  }

  /** Insert into the record's own table, falling back to `firm_docs` when it cannot be mapped. */
  private async docOr(d: LDoc, what: string, fn: (tx: Tx) => Promise<unknown>): Promise<boolean> {
    const r = await this.trySp(fn);
    if (r.ok) return true;
    const reason = errMsg(r.error);
    this.rep.skipped.push({ what, reason: reason + ' – зачувано како општ документ (firm_docs)' });
    await this.firmDoc(d, String(d.type ?? 'doc'), reason);
    return false;
  }

  R: Resolve = (kind: RefKind, legacyId: unknown) => {
    if (legacyId == null || legacyId === '') return null;
    if (kind === 'location' && legacyId === 'main') return null;
    if (kind === 'register' && legacyId === '__default') return this.ids.keys('register\u0000')[0]?.[1] ?? null;
    return this.ids.get(kind, legacyId);
  };

  async run(): Promise<void> {
    const t0 = Date.now();
    const { firm, data } = this.fb;
    const glob = this.o.glob ?? {};

    /* ---- firm ---- */
    await this.step('фирма');
    const firmVals = M.mapFirm(firm);
    const globalIds = new IdMap(this.tx, null, this.o.runId ?? null);
    await globalIds.load();
    let firmId = globalIds.get('firm', firm.id);
    if (!firmId) {
      const [byLegacy] = await this.tx.select({ id: firms.id }).from(firms).where(eq(firms.legacyId, firm.id)).limit(1);
      firmId = byLegacy?.id ?? null;
    }
    if (!firmId && firmVals.edb) {
      const [byEdb] = await this.tx.select({ id: firms.id }).from(firms).where(and(eq(firms.edb, firmVals.edb), isNull(firms.legacyId))).limit(1);
      if (byEdb) { firmId = byEdb.id; this.rep.warnings.push(`Фирмата е поврзана со постоечка фирма на серверот според ЕДБ ${firmVals.edb}.`); }
    }
    const lockDate = firmVals.lockDate;
    const base = { ...firmVals, lockDate: null };
    if (firmId) {
      const [cur] = await this.tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, firmId)).limit(1);
      await this.tx.update(firms).set({ ...base, settings: { ...(cur?.settings ?? {}), ...base.settings } }).where(eq(firms.id, firmId));
      this.rep.status = 'updated';
    } else {
      const [f] = await this.tx.insert(firms).values(base).returning({ id: firms.id });
      firmId = f!.id;
    }
    await globalIds.set('firm', firm.id, firmId);
    this.firmId = firmId;
    this.rep.firmId = firmId;
    this.ids = new IdMap(this.tx, firmId, this.o.runId ?? null);
    await this.ids.load();

    // Re-import: closed VAT periods from the previous import are reopened while journals are re-posted.
    const prevVat = this.ids.keys('vat_period\u0000').map(([, id]) => id);
    if (prevVat.length) await this.tx.update(vatPeriods).set({ status: 'open' }).where(inArray(vatPeriods.id, prevVat));

    await this.firmImages();

    /* ---- chart overrides ---- */
    await this.step('контен план');
    for (const a of M.mapAccountOverrides(firm)) {
      await this.attempt(`Конто ${a.code}`, async (tx) => {
        const [ex] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.firmId, firmId!), eq(accounts.code, a.code))).limit(1);
        if (ex) await tx.update(accounts).set(a).where(eq(accounts.id, ex.id));
        else await tx.insert(accounts).values({ ...a, firmId: firmId! });
        this.count('accounts');
      });
    }

    /* ---- masters ---- */
    await this.step('шифрарници');
    for (const c of data.codes) {
      await this.attempt(`Шифрарник ${c.cb}/${c.code ?? c.id}`, async (tx) => {
        const v = M.mapCode(c);
        const r = await this.upsert(tx, c.cb === 'warehouse' || c.cb === 'store' ? 'location' : 'code', c.id, codes, { ...v, firmId });
        if (c.cb === 'warehouse' || c.cb === 'store') await this.ids.set('code', c.id, r.id);
        this.count('codes');
      });
    }

    await this.step('комитенти');
    const taken = async (table: AnyTable) => {
      const rows = await this.tx.select({ id: table.id, code: table.code }).from(table).where(eq(table.firmId, firmId!));
      return new Map(rows.filter((r: { code: string | null }) => r.code).map((r: { id: string; code: string }) => [r.code, r.id]));
    };
    const pCodes = await taken(partners);
    for (const p of data.partners) {
      await this.attempt(`Комитент ${p.name ?? p.id}`, async (tx) => {
        const v = M.mapPartner(p);
        const mine = this.ids.get('partner', p.id);
        if (v.code && pCodes.has(v.code) && pCodes.get(v.code) !== mine) { this.rep.warnings.push(`Комитент „${v.name}“: шифрата ${v.code} е зафатена – увезен е без шифра.`); v.code = null; }
        const r = await this.upsert(tx, 'partner', p.id, partners, { ...v, firmId });
        if (v.code) pCodes.set(v.code, r.id);
        this.count('partners');
      });
    }

    await this.step('артикли');
    const iCodes = await taken(items);
    const barcodesUsed = new Map((await this.tx.select({ b: itemBarcodes.barcode, i: itemBarcodes.itemId }).from(itemBarcodes).where(eq(itemBarcodes.firmId, firmId))).map((r) => [r.b, r.i]));
    for (const it of data.items) {
      await this.attempt(`Артикл ${it.name ?? it.id}`, async (tx) => {
        const v = M.mapItem(it);
        const mine = this.ids.get('item', it.id);
        if (v.code && iCodes.has(v.code) && iCodes.get(v.code) !== mine) { this.rep.warnings.push(`Артикл „${v.name}“: шифрата ${v.code} е зафатена – увезен е без шифра.`); v.code = null; }
        const r = await this.upsert(tx, 'item', it.id, items, { ...v, firmId });
        if (v.code) iCodes.set(v.code, r.id);
        await tx.delete(itemBarcodes).where(eq(itemBarcodes.itemId, r.id));
        M.itemBarcodes(it).forEach((b, i) => { if (barcodesUsed.has(b) && barcodesUsed.get(b) !== r.id) this.rep.warnings.push(`Баркодот ${b} (${v.name}) веќе припаѓа на друг артикл – прескокнат.`); });
        const B = M.itemBarcodes(it).filter((b) => !barcodesUsed.has(b) || barcodesUsed.get(b) === r.id);
        if (B.length) await tx.insert(itemBarcodes).values(B.map((b, i) => ({ firmId: firmId!, itemId: r.id, barcode: b, primary: i === 0 })));
        for (const b of B) barcodesUsed.set(b, r.id);
        this.count('items');
      });
    }
    for (const it of data.items) {
      const bom = M.mapBom(it, this.R);
      const pid = this.R('item', it.id);
      if (!bom || !pid) continue;
      await this.attempt(`Норматив ${it.name}`, async (tx) => {
        const [ex] = await tx.select({ id: boms.id }).from(boms).where(and(eq(boms.firmId, firmId!), eq(boms.productId, pid))).limit(1);
        if (ex) await tx.update(boms).set(bom).where(eq(boms.id, ex.id));
        else await tx.insert(boms).values({ ...bom, firmId: firmId!, productId: pid });
        this.count('boms');
      });
    }

    await this.step('вработени');
    for (const e of data.employees) {
      await this.attempt(`Вработен ${e.name ?? e.id}`, async (tx) => { await this.upsert(tx, 'employee', e.id, employees, { ...M.mapEmployee(e), firmId }); this.count('employees'); });
    }

    /* ---- bank accounts, cash registers ---- */
    const bankRows = M.mapBankAccounts(firm);
    for (const b of bankRows) await this.attempt(`Банкарска сметка ${b.name}`, async (tx) => { await this.upsert(tx, 'bank_account', b.legacyId, bankAccounts, { ...b, firmId }); this.count('bank_accounts'); });
    // keep `firms.settings.banks` in sync (the posting service numbers bank journals from it)
    const settingsBanks = bankRows.map((b) => ({ id: this.R('bank_account', b.legacyId), name: b.name, account: b.account, konto: b.konto, cur: b.cur, nal: b.nal })).filter((b) => b.id);
    const [fs] = await this.tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, firmId)).limit(1);
    await this.tx.update(firms).set({ settings: { ...(fs?.settings ?? {}), banks: settingsBanks } }).where(eq(firms.id, firmId));
    for (const r of M.mapCashRegisters(firm)) await this.attempt(`Благајна ${r.name}`, async (tx) => { await this.upsert(tx, 'register', r.legacyId, cashRegisters, { ...r, firmId }); this.count('cash_registers'); });

    /* ---- documents ---- */
    await this.step('фактури');
    const docsOf = (t: string) => data.docs.filter((d) => d.type === t);
    const outDocs = [...data.invoices, ...docsOf('proforma'), ...docsOf('dispatch')];
    for (const x of outDocs) await this.invoice(x);
    for (const x of outDocs) await this.invoiceLinks(x);
    await this.step('влезни фактури');
    for (const x of data.purchases) await this.purchase(x);
    for (const x of docsOf('supcr')) {
      await this.docOr(x, `Поврат ${x.number ?? x.id}`, async (tx) => {
        const v = M.mapSupplierCredit(x, this.R, firm.ddv);
        v.head.number = this.uniq('supcr:' + v.head.date.slice(0, 4), v.head.number, 'Поврат');
        const r = await this.upsert(tx, 'supplier_credit', x.id, supplierCredits, { ...v.head, firmId, createdBy: this.o.userId });
        await tx.delete(supplierCreditLines).where(eq(supplierCreditLines.creditId, r.id));
        if (v.lines.length) await tx.insert(supplierCreditLines).values(v.lines.map((l) => ({ ...l, creditId: r.id })));
        this.count('supplier_credits');
      });
    }

    await this.step('благајна и изводи');
    for (const x of docsOf('blg')) {
      await this.docOr(x, `Благајна ${x.number ?? x.id}`, async (tx) => {
        const v = M.mapCashVoucher(x, this.R);
        v.number = this.uniq(`blg:${v.registerId}:${v.kind}:${v.date.slice(0, 4)}`, v.number, 'Благајна');
        await this.upsert(tx, 'cash_voucher', x.id, cashVouchers, { ...v, firmId, createdBy: this.o.userId });
        this.count('cash_vouchers');
      });
    }
    for (const x of docsOf('komp')) {
      await this.docOr(x, `Компензација ${x.number ?? x.id}`, async (tx) => {
        const v = M.mapCompensation(x, this.R);
        v.number = this.uniq('komp', v.number, 'Компензација');
        await this.upsert(tx, 'compensation', x.id, compensations, { ...v, firmId, createdBy: this.o.userId });
        this.count('compensations');
      });
    }
    for (const x of docsOf('pp')) {
      await this.docOr(x, `Налог за плаќање ${x.id}`, async (tx) => { await this.upsert(tx, 'payment_order', x.id, paymentOrders, { ...M.mapPaymentOrder(x), firmId, createdBy: this.o.userId }); this.count('payment_orders'); });
    }
    await this.bank();

    await this.step('каса, плати, залиха');
    for (const s of data.sales) {
      await this.attempt(`Дневен извештај ${s.date}`, async (tx) => {
        const v = M.mapSalesDay(s, this.R);
        try {
          await tx.transaction(async (sp) => { await this.upsert(sp as unknown as Tx, 'sales_day', s.id, salesDaily, { ...v, firmId, createdBy: this.o.userId }); });
        } catch {
          // a second POS day for the same location and date → keep it as a fiscal report row
          await this.upsert(tx, 'sales_day', s.id, salesDaily, { ...v, kind: 'fisk', firmId, createdBy: this.o.userId });
        }
        this.count('sales_daily');
      });
    }
    for (const p of data.payroll) {
      await this.attempt(`Плата ${p.month ?? p.id}`, async (tx) => {
        const v = M.mapPayroll(p, this.R);
        const r = await this.upsert(tx, 'payroll', p.id, payrollRuns, { ...v.head, firmId, createdBy: this.o.userId });
        await tx.delete(payrollEmp).where(eq(payrollEmp.runId, r.id));
        for (const e of v.emps) {
          const [pe] = await tx.insert(payrollEmp).values({ ...e.emp, runId: r.id, firmId: firmId! }).returning({ id: payrollEmp.id });
          if (e.lines.length) await tx.insert(payrollLines).values(e.lines.map((l) => ({ ...l, runEmpId: pe!.id, runId: r.id, firmId: firmId! })));
        }
        this.count('payroll_runs');
      });
    }
    const bomOf = (pid: string) => M.mapBom(data.items.find((i) => i.id === pid) ?? { id: '' }, this.R)?.lines ?? [];
    for (const p of data.production) {
      await this.attempt(`Производство ${p.id}`, async (tx) => {
        const v = M.mapProduction(p, this.R, bomOf);
        v.number = this.uniq('prod', v.number, 'Производство');
        await this.upsert(tx, 'production', p.id, productionOrders, { ...v, firmId, createdBy: this.o.userId });
        this.count('production_orders');
      });
    }
    for (const n of docsOf('nivel')) {
      await this.docOr(n, `Нивелација ${n.number ?? n.id}`, async (tx) => {
        const v = M.mapLevelling(n, this.R); v.number = this.uniq('nivel', v.number, 'Нивелација');
        await this.upsert(tx, 'levelling', n.id, levellingDocs, { ...v, firmId, createdBy: this.o.userId }); this.count('levelling_docs');
      });
    }
    for (const t of docsOf('prenos')) {
      await this.docOr(t, `Преносница ${t.number ?? t.id}`, async (tx) => {
        const v = M.mapTransfer(t, this.R); v.number = this.uniq('prenos', v.number, 'Преносница');
        if ((v.fromLocationId ?? 'main') === (v.toLocationId ?? 'main')) throw new MapSkip('Преносница во ист објект');
        const r = await this.upsert(tx, 'transfer', t.id, transfers, { ...v, firmId, createdBy: this.o.userId });
        if (t.src) await this.ids.set('transfer_src', String(t.src), r.id);
        this.count('transfers');
      });
    }
    for (const d of docsOf('mout')) {
      await this.docOr(d, `Излез/попис ${d.number ?? d.id}`, async (tx) => {
        const v = M.mapStockCount(d, this.R); v.number = this.uniq('mout:' + v.kind, v.number, 'Попис/отпис');
        await this.upsert(tx, 'stock_count', d.id, stockCounts, { ...v, firmId, createdBy: this.o.userId }); this.count('stock_counts');
      });
    }
    await this.moves();

    await this.step('основни средства');
    for (const a of data.assets) {
      await this.attempt(`Основно средство ${a.name ?? a.id}`, async (tx) => {
        const r = await this.upsert(tx, 'asset', a.id, fixedAssets, { ...M.mapFixedAsset(a), firmId, createdBy: this.o.userId });
        this.count('fixed_assets');
        const fv = M.mapFleetVehicle(a);
        if (fv) {
          try {
            await tx.transaction(async (sp) => { await this.upsert(sp as unknown as Tx, 'vehicle', a.id, fleetVehicles, { ...fv, firmId, assetId: r.id }); });
            this.count('fleet_vehicles');
          } catch (e) { this.rep.warnings.push(`Возило ${fv.plate}: ${errMsg(e)}`); }
        }
      });
    }

    await this.step('канцеларија и дејности');
    await this.otherDocs();

    /* ---- journals ---- */
    await this.step('налози');
    await this.journalsAll();

    /* ---- lock date, closed VAT periods ---- */
    const closed = this.ids.keys('vat_period\u0000').map(([, id]) => id);
    if (closed.length) await this.tx.update(vatPeriods).set({ status: 'closed' }).where(inArray(vatPeriods.id, closed));
    await this.tx.update(firms).set({ lockDate }).where(eq(firms.id, firmId));

    await this.step('проверка на бруто билансот');
    await this.verify();

    this.rep.stale = this.ids.staleCount();
    this.rep.files.unavailable = countAssetRefs(data);
    if (this.rep.files.unavailable) this.rep.warnings.push(`${this.rep.files.unavailable} прикачени датотеки (скенови, PDF, фотографии) се во складиштето на claude.ai и не се дел од резервната копија – не се пренесени.`);
    this.rep.ms = Date.now() - t0;
    await audit(this.tx, {
      userId: this.o.userId, firmId, action: 'legacyImport', entityType: 'firm', entityId: firmId,
      data: { legacyId: firm.id, source: this.fb.source, backupAt: this.fb.at, status: this.rep.status, counts: this.rep.counts, skipped: this.rep.skipped.length, journals: this.rep.journals, trialBalanceOk: this.rep.trialBalance.ok, runId: this.o.runId ?? null },
    });
  }

  /* ---------------- firm images (data URLs in the "Само оваа фирма" export) ---------------- */
  private async firmImages() {
    const roles = { logo: 'logo', sign: 'signature', stamp: 'stamp' } as const;
    for (const [k, role] of Object.entries(roles)) {
      const v = this.fb.firm[k];
      if (typeof v !== 'string' || !v) continue;
      const m = DATA_URL_RE.exec(v);
      if (!m) { this.rep.files.unavailable++; continue; }
      if (!this.o.files) { this.rep.warnings.push(`Сликата „${k}“ на фирмата не е пренесена (нема складиште за датотеки).`); continue; }
      const mime = m[1] ?? 'application/octet-stream';
      const body = m[2] ? new Uint8Array(Buffer.from(m[3]!, 'base64')) : new TextEncoder().encode(decodeURIComponent(m[3]!));
      const sha = createHash('sha256').update(body).digest('hex');
      let [f] = await this.tx.select({ id: files.id }).from(files).where(and(eq(files.firmId, this.firmId), eq(files.sha256, sha), eq(files.status, 'ready'))).limit(1);
      if (!f) {
        const key = `firms/${this.firmId}/${new Date().getFullYear()}/${crypto.randomUUID()}.${extOf(mime)}`;
        await this.o.files.put(key, body, mime);
        [f] = await this.tx.insert(files).values({ firmId: this.firmId, bucketKey: key, name: `${k}.${extOf(mime)}`, mime, size: body.byteLength, sha256: sha, status: 'ready', uploadedBy: this.o.userId }).returning({ id: files.id });
        this.rep.files.imported++;
      }
      await this.tx.insert(fileLinks).values({ fileId: f!.id, entityType: 'firm', entityId: this.firmId, role }).onConflictDoNothing();
    }
  }

  /* ---------------- invoices ---------------- */
  private async invoice(x: LDoc) {
    const isDoc = x.type === 'proforma' || x.type === 'dispatch';
    await this.docOr(x, `${isDoc ? x.type : 'Фактура'} ${x.number ?? x.id}`, async (tx) => {
      const v = M.mapInvoice(x, this.R, this.fb.firm.ddv);
      v.head.number = this.uniq(`inv:${v.head.kind}:${v.head.date.slice(0, 4)}`, v.head.number, 'Фактура');
      const r = await this.upsert(tx, 'invoice', x.id, invoices, { ...v.head, firmId: this.firmId, createdBy: this.o.userId });
      await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, r.id));
      if (v.lines.length) await tx.insert(invoiceLines).values(v.lines.map((l) => ({ ...l, invoiceId: r.id })));
      this.count(isDoc ? 'invoices (' + x.type + ')' : 'invoices');
    });
  }
  private async invoiceLinks(x: LDoc) {
    const id = this.R('invoice', x.id);
    if (!id) return;
    const v = M.mapInvoice(x, this.R, this.fb.firm.ddv);
    const ref = v.refInvoice ? this.R('invoice', v.refInvoice) : null;
    await this.attempt(`Врски на фактура ${x.number ?? x.id}`, async (tx) => {
      if (x.credit && ref) await tx.update(invoices).set({ refInvoiceId: ref }).where(eq(invoices.id, id));
      else if (ref) await tx.update(invoices).set({ fromDocId: ref }).where(eq(invoices.id, id));
      if (x.invoiced && typeof x.invoiced === 'string') { const inv = this.R('invoice', x.invoiced); if (inv) await tx.update(invoices).set({ invoicedId: inv }).where(eq(invoices.id, id)); }
      await tx.delete(invoiceAdvances).where(eq(invoiceAdvances.invoiceId, id));
      const adv = v.advances.map((a) => ({ invoiceId: id, advanceId: this.R('invoice', a.legacyId), amount: a.amount })).filter((a): a is { invoiceId: string; advanceId: string; amount: string } => !!a.advanceId);
      if (adv.length) await tx.insert(invoiceAdvances).values(adv);
    });
  }

  /* ---------------- purchases ---------------- */
  private async purchase(x: LDoc) {
    await this.docOr({ ...x, type: 'purchase' }, `Влезна фактура ${x.number ?? x.id}`, async (tx) => {
      const v = M.mapPurchase(x, this.R);
      for (const s of v.skipped) this.rep.warnings.push(`Влезна фактура ${x.number ?? x.id}: ${s}.`);
      const r = await this.upsert(tx, 'purchase', x.id, purchases, { ...v.head, firmId: this.firmId, createdBy: this.o.userId });
      await tx.delete(purchaseVatGroups).where(eq(purchaseVatGroups.purchaseId, r.id));
      await tx.delete(purchaseStockLines).where(eq(purchaseStockLines.purchaseId, r.id));
      await tx.delete(purchaseCosts).where(eq(purchaseCosts.purchaseId, r.id));
      if (v.groups.length) await tx.insert(purchaseVatGroups).values(v.groups.map((g) => ({ ...g, purchaseId: r.id })));
      if (v.stockLines.length) await tx.insert(purchaseStockLines).values(v.stockLines.map((g) => ({ ...g, purchaseId: r.id })));
      if (v.costs.length) await tx.insert(purchaseCosts).values(v.costs.map((g) => ({ ...g, purchaseId: r.id })));
      this.count('purchases');
    });
  }

  /* ---------------- bank statements ---------------- */
  private async bank() {
    const G = new Map<string, LDoc[]>();
    for (const b of this.fb.data.bank) {
      const d = isoDate(b.date);
      if (!d) { this.rep.skipped.push({ what: `Ставка од извод ${b.id}`, reason: 'нема датум' }); continue; }
      const k = String(b.acct || 'main') + '|' + d;
      G.set(k, [...(G.get(k) ?? []), b]);
    }
    for (const [k, L] of G) {
      const [acct, date] = k.split('|') as [string, string];
      const accountId = this.R('bank_account', acct) ?? this.R('bank_account', 'main') ?? this.ids.keys('bank_account\u0000')[0]?.[1];
      if (!accountId) { this.rep.skipped.push({ what: `Извод ${k}`, reason: 'нема банкарска сметка' }); continue; }
      await this.attempt(`Извод ${acct} ${date}`, async (tx) => {
        const st = M.mapStatement(this.fb.firm, acct, date);
        const r = await this.upsert(tx, 'bank_statement', k, bankStatements, { ...st, firmId: this.firmId, bankAccountId: accountId, createdBy: this.o.userId });
        await tx.delete(bankLines).where(eq(bankLines.statementId, r.id));
        const rows = L.map((b, i) => ({ ...M.mapBankLine(b, this.R, i + 1), firmId: this.firmId, statementId: r.id, bankAccountId: accountId }));
        const ins = await tx.insert(bankLines).values(rows.map(({ legacyId, ...v }) => { void legacyId; return v; })).returning({ id: bankLines.id, lineNo: bankLines.lineNo });
        for (const x of ins) await this.ids.set('bank_line', L[x.lineNo - 1]!.id, x.id);
        this.count('bank_statements'); this.count('bank_lines', rows.length);
      });
    }
  }

  /* ---------------- stock moves ---------------- */
  private moveSourceOf(src: string) {
    const salesBy = (id: string) => this.R('sales_day' as RefKind, id);
    return M.moveSource(src, (k, id) => (k === 'supplier_credit' ? this.ids.get('supplier_credit', id) : this.R(k, id)), {
      transfer: (s) => this.ids.get('transfer_src', s) ?? this.ids.get('transfer', s),
      stockCount: (id) => this.ids.get('stock_count', id),
      production: (id) => this.ids.get('production', id),
      salesDay: (id) => salesBy(id),
    });
  }
  private async moves() {
    for (const m of this.fb.data.moves) {
      await this.attempt(`Движење на залиха ${m.label ?? m.id}`, async (tx) => {
        const v = M.mapMove(m, this.R);
        const s = this.moveSourceOf(String(m.src || m.id));
        await this.upsert(tx, 'move', m.id, stockMoves, { ...v, firmId: this.firmId, sourceType: s.sourceType, sourceId: s.sourceId, sourceLine: 0, createdBy: this.o.userId });
        this.count('stock_moves');
      });
    }
  }

  /* ---------------- office, HR, industry, everything else ---------------- */
  private async otherDocs() {
    const handled = new Set(['proforma', 'dispatch', 'supcr', 'blg', 'komp', 'pp', 'nivel', 'prenos', 'mout', 'outscan']);
    const D = this.fb.data.docs;
    const by = (t: string) => D.filter((d) => d.type === t);
    const f = this.firmId, u = this.o.userId;
    for (const d of by('hroom')) await this.docOr(d, `Хотелска соба ${d.no ?? d.id}`, async (tx) => { await this.upsert(tx, 'hotel_room', d.id, hotelRooms, { ...M.mapHotelRoom(d), firmId: f }); this.count('hotel_rooms'); });
    for (const d of by('hres')) await this.docOr(d, `Резервација ${d.number ?? d.id}`, async (tx) => { await this.upsert(tx, 'hotel_reservation', d.id, hotelReservations, { ...M.mapHotelReservation(d, this.R), firmId: f, createdBy: u }); this.count('hotel_reservations'); });
    for (const d of by('appt')) await this.docOr(d, `Термин ${d.date ?? d.id}`, async (tx) => { await this.upsert(tx, 'appointment', d.id, appointments, { ...M.mapAppointment(d, this.R), firmId: f }); this.count('appointments'); });
    for (const d of by('cproj')) await this.docOr(d, `Градежен проект ${d.code ?? d.id}`, async (tx) => { await this.upsert(tx, 'construction_project', d.id, constructionProjects, { ...M.mapConstructionProject(d, this.R), firmId: f }); this.count('construction_projects'); });
    for (const d of by('csit')) await this.docOr(d, `Ситуација ${d.no ?? d.id}`, async (tx) => { await this.upsert(tx, 'construction_situation', d.id, constructionSituations, { ...M.mapConstructionSituation(d, this.R), firmId: f }); this.count('construction_situations'); });
    for (const d of by('cdiary')) await this.docOr(d, `Градежен дневник ${d.date ?? d.id}`, async (tx) => { await this.upsert(tx, 'construction_diary', d.id, constructionDiary, { ...M.mapConstructionDiary(d, this.R), firmId: f }); this.count('construction_diary'); });
    for (const d of by('tarr')) await this.docOr(d, `Аранжман ${d.code ?? d.id}`, async (tx) => { await this.upsert(tx, 'travel_arrangement', d.id, travelArrangements, { ...M.mapTravelArrangement(d), firmId: f }); this.count('travel_arrangements'); });
    for (const d of by('tbook')) await this.docOr(d, `Резервација (тура) ${d.number ?? d.id}`, async (tx) => { await this.upsert(tx, 'travel_booking', d.id, travelBookings, { ...M.mapTravelBooking(d, this.R), firmId: f }); this.count('travel_bookings'); });
    for (const d of by('rres')) await this.docOr(d, `Изнајмување ${d.number ?? d.id}`, async (tx) => { await this.upsert(tx, 'rent_rental', d.id, rentRentals, { ...M.mapRentRental(d, this.R), firmId: f, createdBy: u }); this.count('rent_rentals'); });
    for (const d of by('frt')) await this.docOr(d, `Тура ${d.number ?? d.id}`, async (tx) => { await this.upsert(tx, 'freight_tour', d.id, freightTours, { ...M.mapFreightTour(d, this.R), firmId: f }); this.count('freight_tours'); });
    for (const d of by('arch')) {
      if (!d.dos) { await this.firmDoc(d, 'arch'); continue; }
      await this.docOr(d, `Досие ${d.title ?? d.id}`, async (tx) => { await this.upsert(tx, 'dossier', d.id, dossierDocs, { ...M.mapDossier(d), firmId: f, createdBy: u }); this.count('dossier_docs'); });
    }
    for (const d of by('inbox')) await this.docOr(d, `Пратка ${d.id}`, async (tx) => { await this.upsert(tx, 'inbox', d.id, inboxItems, { ...M.mapInbox(d), firmId: f }); this.count('inbox_items'); });
    for (const d of by('recur')) await this.docOr(d, `Периодична фактура ${d.id}`, async (tx) => { await this.upsert(tx, 'recurring', d.id, recurringInvoices, { ...M.mapRecurring(d, this.R), firmId: f, createdBy: u }); this.count('recurring_invoices'); });
    for (const d of by('kdog')) await this.docOr(d, `Договор ${d.number ?? d.id}`, async (tx) => { await this.upsert(tx, 'service_contract', d.id, serviceContracts, { ...M.mapServiceContract(d), firmId: f, createdBy: u }); this.count('service_contracts'); });
    for (const d of by('hr')) await this.docOr(d, `HR документ ${d.no ?? d.id}`, async (tx) => { await this.upsert(tx, 'hr_doc', d.id, hrDocs, { ...M.mapHrDoc(d, this.R), firmId: f, createdBy: u }); this.count('hr_docs'); });
    const mapped = new Set(['hroom', 'hres', 'appt', 'cproj', 'csit', 'cdiary', 'tarr', 'tbook', 'rres', 'frt', 'arch', 'inbox', 'recur', 'kdog', 'hr']);
    for (const d of D) {
      const t = String(d.type ?? 'doc');
      if (handled.has(t) || mapped.has(t)) continue;
      await this.firmDoc(d, t);
    }
  }

  /* ---------------- journals ---------------- */
  private async journalsAll() {
    const { firm, data } = this.fb;
    const chart = new Set((await this.tx.select({ code: accounts.code }).from(accounts)).map((r) => r.code));
    const L = legacyLedger(this.fb, { glob: this.o.glob, vatBaseLines: this.o.vatBaseLines, accountExists: (k) => chart.has(k) });
    this.rep.warnings.push(...L.warnings);
    this.legacyLines = L.sources.flatMap((s) => s.lines);

    // Accounts used by legacy lines but missing from the chart → firm accounts (named so they can be found and renamed).
    const used = [...new Set(L.sources.flatMap((s) => s.lines.map((l) => l.k)))].filter((k) => /^\d{2,10}$/.test(k));
    const missing = await missingAccounts(this.tx, this.firmId, used);
    if (missing.length) {
      await this.tx.insert(accounts).values(missing.map((code) => ({ firmId: this.firmId, code, name: `Конто ${code} (од старата програма)` }))).onConflictDoNothing();
      this.rep.warnings.push(`Додадени конта во контниот план на фирмата: ${missing.join(', ')} – проверете ги називите.`);
      void NEW_ACCOUNT_CODE_RE;
    }

    // Years that have real documents (a `bbimp` journal of such a year is posted as a manual journal, LEGACY-MAP 11.3).
    const docYears = new Set(L.sources.filter((s) => !(s.kind === 'journal' && ['open', 'close', 'bbimp'].includes(s.journalKind))).map((s) => s.date.slice(0, 4)));
    const journalsById = new Map(data.journal.map((j) => [j.id, j]));

    // Group sources that become one journal (several legacy moves of one invoice → one stock journal).
    type Target = { sourceType: string | null; sourceId: string | null; kind: string; date: string; description: string; lines: LegacySource['lines']; legacyKey: string; numbering?: { bankAccountId?: string; payMonth?: number }; number?: string; meta?: Record<string, unknown>; after?: (journalId: string, tx: Tx) => Promise<void> };
    const T = new Map<string, Target>();
    const add = (key: string, t: Target) => {
      const prev = T.get(key);
      if (prev) { prev.lines.push(...t.lines); if (t.date < prev.date) prev.date = t.date; return; }
      T.set(key, { ...t, lines: [...t.lines] });
    };
    const ySeen = new Set<string>();
    for (const s of L.sources) {
      const base = { kind: s.journalKind, date: s.date, description: s.description, lines: s.lines, legacyKey: s.key };
      const via = (type: string, kind: RefKind | string) => {
        const id = this.ids.get(kind, s.legacyId);
        return id ? { sourceType: type, sourceId: id } : { sourceType: 'legacy:' + s.kind, sourceId: s.legacyId };
      };
      switch (s.kind) {
        case 'invoice': add(s.key, { ...base, ...via('invoice', 'invoice') }); break;
        case 'purchase': add(s.key, { ...base, ...via('purchase', 'purchase') }); break;
        case 'supcr': add(s.key, { ...base, ...via('supplier_credit', 'supplier_credit') }); break;
        case 'sales': add(s.key, { ...base, ...via('sales_daily', 'sales_day') }); break;
        case 'komp': add(s.key, { ...base, ...via('compensation', 'compensation') }); break;
        case 'nivel': add(s.key, { ...base, ...via('levelling', 'levelling') }); break;
        case 'pdd': add(s.key, { ...base, ...via('legacy_pdd', 'firm_doc') }); break;
        case 'blg': {
          const t = via('cash_voucher', 'cash_voucher');
          const doc = data.docs.find((d) => d.id === s.legacyId);
          const reg = M.mapCashRegisters(firm).find((r) => r.legacyId === String(doc?.reg ?? '')) ?? M.mapCashRegisters(firm)[0]!;
          const [fr] = await this.tx.select().from(firms).where(eq(firms.id, this.firmId)).limit(1);
          const st = firmNalogSettings(fr!);
          const n = nalogNumber({ kind: 'kasa', date: s.date, settings: { ...st, nalCodes: { ...(st.nalCodes ?? {}), kasa: reg.konto } } });
          add(s.key, { ...base, ...t, ...(n.no ? { number: n.no } : {}), meta: { registerId: this.R('register', reg.legacyId) } });
          break;
        }
        case 'payroll': {
          const t = via('payroll', 'payroll');
          const pay = data.payroll.find((p) => p.id === s.legacyId);
          const mo = Number(String(pay?.month ?? '').slice(5, 7)) || undefined;
          add(s.key, { ...base, ...t, ...(mo ? { numbering: { payMonth: mo } } : {}), after: async (jid, tx) => { if (t.sourceType === 'payroll') await tx.update(payrollRuns).set({ journalId: jid }).where(eq(payrollRuns.id, t.sourceId)); } });
          break;
        }
        case 'bank': {
          const id = this.ids.get('bank_statement', s.legacyId);
          const acct = s.legacyId.split('|')[0]!;
          const accId = this.R('bank_account', acct) ?? undefined;
          add(s.key, { ...base, ...(id ? { sourceType: 'bank_statement', sourceId: id } : { sourceType: 'legacy:bank', sourceId: s.legacyId }), ...(accId ? { numbering: { bankAccountId: accId }, meta: { bankAccountId: accId } } : {}) });
          break;
        }
        case 'moves': {
          const m = this.moveSourceOf(s.legacyId);
          add(`stock:${m.sourceType}:${m.sourceId}`, { ...base, sourceType: 'stock:' + m.sourceType, sourceId: m.sourceId });
          break;
        }
        case 'journal': {
          const j = journalsById.get(s.legacyId)!;
          const y = s.date.slice(0, 4);
          const ye = (type: string, id: string) => { const k = type + ':' + id; if (ySeen.has(k)) return { sourceType: 'legacy:journal', sourceId: s.legacyId }; ySeen.add(k); return { sourceType: type, sourceId: id }; };
          if (s.journalKind === 'open') add(s.key, { ...base, ...ye('opening', `open-${y}`), after: (jid, tx) => this.yearRow(tx, Number(y) - 1, { openJournalId: jid }) });
          else if (s.journalKind === 'close') add(s.key, { ...base, ...ye('yearClose', `close-${y}`), after: (jid, tx) => this.yearRow(tx, Number(y), { closeJournalId: jid, status: 'closed', imported: true }) });
          else if (s.journalKind === 'amort') add(s.key, { ...base, ...ye('depreciation', `dep-${y}`), after: (jid, tx) => this.depRun(tx, Number(y), jid, j) });
          else if (s.journalKind === 'bbimp') {
            if (docYears.has(y)) { this.rep.warnings.push(`Увезениот бруто биланс за ${y} е книжен како рачен налог – во истата година има и документи.`); add(s.key, { ...base, kind: 'manual', sourceType: null, sourceId: null, meta: { legacyKind: 'bbimp' } }); }
            else add(s.key, { ...base, ...ye('bbimp', `bbimp-${y}`) });
          } else if (s.journalKind === 'ddv') {
            const vp = M.vatPeriodOfJournal(j, firm.per);
            const vid = await this.vatPeriod(vp, s.legacyId);
            if (vid) add(s.key, { ...base, sourceType: 'vatPeriod', sourceId: vid, after: async (jid, tx) => { await tx.update(vatPeriods).set({ closingJournalId: jid }).where(eq(vatPeriods.id, vid)); } });
            else add(s.key, { ...base, kind: 'manual', sourceType: null, sourceId: null, meta: { legacyKind: 'ddv' } });
          } else add(s.key, { ...base, kind: ['kamata', 'kauc', 'mpin', 'kr', 'pos'].includes(s.journalKind) ? s.journalKind : 'manual', sourceType: null, sourceId: null, ...(j.nalNo ? { number: String(j.nalNo) } : {}), meta: { ...(j.pFrom ? {} : {}) } });
          break;
        }
      }
    }

    let i = 0;
    for (const [key, t] of T) {
      if (++i % 200 === 0) await this.step(`налози ${i}/${T.size}`);
      const lines = t.lines.filter((l) => l.d || l.p).map((l) => ({
        account: l.k, debit: l.d, credit: l.p, partnerId: l.partner ? this.R('partner', l.partner) : null, note: l.note ?? null, doc: l.doc ?? null,
        currency: l.amtCur ? l.cur ?? null : null, amountCur: l.amtCur ?? null,
      }));
      if (!lines.length) continue;
      const jr = journalsById.get(key.startsWith('journal:') ? key.slice(8) : '');
      const input = {
        firmId: this.firmId, date: t.date, kind: t.kind, description: t.description || null, sourceType: t.sourceType, sourceId: t.sourceId,
        lines, userId: this.o.userId, requirePartner: false, auditAction: 'legacyImportJournal',
        ...(t.number ? { number: t.number } : {}), ...(t.numbering ? { numbering: t.numbering } : {}),
        ...(jr?.pFrom ? { periodFrom: isoDate(jr.pFrom) } : {}), ...(jr?.pTo ? { periodTo: isoDate(jr.pTo) } : {}),
        meta: { ...(t.meta ?? {}), legacy: key },
      };
      const ok = await this.attempt(`Налог ${t.description || key}`, async (tx) => {
        const mapped = this.ids.get('journal', key);
        let jid: string;
        if (!t.sourceId && mapped) {
          const [ex] = await tx.select({ id: journals.id }).from(journals).where(eq(journals.id, mapped)).limit(1);
          jid = ex ? (await updateJournal(tx, mapped, input)).id : (await postJournal(tx, input)).id;
        } else jid = (await postJournal(tx, input)).id;
        await this.ids.set('journal', key, jid);
        if (t.after) await t.after(jid, tx);
        return jid;
      });
      if (ok) { this.rep.journals.posted++; this.journalIds.push(ok); } else this.rep.journals.failed++;
    }
    this.count('journals', this.rep.journals.posted);
  }
  private legacyLines: { k: string; d: number; p: number }[] = [];

  private async vatPeriod(vp: ReturnType<typeof M.vatPeriodOfJournal>, legacyId: string): Promise<string | null> {
    const mine = this.ids.get('vat_period', legacyId);
    const [ex] = await this.tx.select({ id: vatPeriods.id }).from(vatPeriods).where(and(eq(vatPeriods.firmId, this.firmId), eq(vatPeriods.period, vp.period))).limit(1);
    if (ex && ex.id !== mine) { this.rep.warnings.push(`ДДВ период ${vp.period} веќе постои на серверот – налогот за затворање е книжен како рачен налог.`); return null; }
    const vals = { ...vp, status: 'open' as const, firmId: this.firmId, submittedAt: new Date(), submittedBy: this.o.userId };
    if (ex) { await this.tx.update(vatPeriods).set(vals).where(eq(vatPeriods.id, ex.id)); await this.ids.set('vat_period', legacyId, ex.id); return ex.id; }
    const [r] = await this.tx.insert(vatPeriods).values(vals).returning({ id: vatPeriods.id });
    await this.ids.set('vat_period', legacyId, r!.id);
    this.count('vat_periods');
    return r!.id;
  }
  private async yearRow(tx: Tx, year: number, set: Record<string, unknown>) {
    const [ex] = await tx.select({ id: yearClosings.id }).from(yearClosings).where(and(eq(yearClosings.firmId, this.firmId), eq(yearClosings.year, year))).limit(1);
    if (ex) await tx.update(yearClosings).set(set).where(eq(yearClosings.id, ex.id));
    else { await tx.insert(yearClosings).values({ firmId: this.firmId, year, ...set }); this.count('year_closings'); }
  }
  private async depRun(tx: Tx, year: number, journalId: string, j: LDoc) {
    const total = r2(arr(j.lines).reduce((s, l) => s + (Number(l?.d) || 0), 0));
    const rows = arr(j.detail).map((r) => ({ id: this.R('asset', r.id) ?? String(r.id ?? ''), year: Number(r.year) || 0, acc: Number(r.acc) || 0, konto: String(r.konto ?? '') }));
    const vals = { journalId, total: total.toFixed(2), rows, runBy: this.o.userId };
    const [ex] = await tx.select({ id: depreciationRuns.id }).from(depreciationRuns).where(and(eq(depreciationRuns.firmId, this.firmId), eq(depreciationRuns.year, year))).limit(1);
    if (ex) await tx.update(depreciationRuns).set(vals).where(eq(depreciationRuns.id, ex.id));
    else { await tx.insert(depreciationRuns).values({ firmId: this.firmId, year, ...vals }); this.count('depreciation_runs'); }
  }

  /* ---------------- trial balance ---------------- */
  private async verify() {
    const legacy = trialBalanceOf(this.legacyLines);
    const imported = new Map<string, TbRow>();
    for (let i = 0; i < this.journalIds.length; i += 500) {
      const chunk = this.journalIds.slice(i, i + 500);
      const rows = await this.tx.select({ account: journalLines.account, d: sql<string>`sum(${journalLines.debit})`, p: sql<string>`sum(${journalLines.credit})` })
        .from(journalLines).where(inArray(journalLines.journalId, chunk)).groupBy(journalLines.account);
      for (const r of rows) {
        const x = imported.get(r.account) ?? { account: r.account, debit: 0, credit: 0 };
        x.debit = r2(x.debit + Number(r.d)); x.credit = r2(x.credit + Number(r.p));
        imported.set(r.account, x);
      }
    }
    const tot = (m: Map<string, TbRow>) => [...m.values()].reduce((a, r) => ({ debit: r2(a.debit + r.debit), credit: r2(a.credit + r.credit) }), { debit: 0, credit: 0 });
    const diffs = compareTrialBalances(legacy, imported);
    this.rep.trialBalance = { ok: diffs.length === 0, legacy: tot(legacy), imported: tot(imported), diffs: diffs.slice(0, 100) };
    if (diffs.length) this.rep.warnings.push(`Бруто билансот не се совпаѓа на ${diffs.length} конта – видете ги прескокнатите налози.`);
  }
}

/** Import one firm in its own transaction. Never throws: a failure is reported as `status: 'failed'` (rolled back). */
export async function importFirm(db: Tx, fb: LegacyFirmBackup, o: ImportOptions): Promise<FirmReport> {
  let job: FirmImport | null = null;
  const t0 = Date.now();
  try {
    await db.transaction(async (tx) => {
      job = new FirmImport(tx as unknown as Tx, fb, o);
      await job.run();
    });
    return job!.rep;
  } catch (e) {
    const rep = (job as FirmImport | null)?.rep;
    return {
      ...(rep ?? {
        legacyId: fb.firm.id, name: String(fb.firm.name ?? fb.firm.id), firmId: null, source: fb.source, backupAt: fb.at, legacyCounts: collectionCounts(fb.data),
        counts: {}, firmDocs: {}, skipped: [], warnings: [], journals: { posted: 0, failed: 0 },
        trialBalance: { ok: false, legacy: { debit: 0, credit: 0 }, imported: { debit: 0, credit: 0 }, diffs: [] }, files: { imported: 0, unavailable: 0 }, stale: 0,
      }),
      firmId: null, status: 'failed', error: errMsg(e), ms: Date.now() - t0,
    } as FirmReport;
  }
}

/* ------------------------------------------------------------------ users and office settings */

/** Users from a full export (legacy `appusers`). Legacy password hashes are kept; the first login re-hashes them (argon2). */
export async function importUsers(db: Tx, list: readonly LegacyUser[], o: ImportOptions): Promise<UsersReport> {
  const rep: UsersReport = { imported: 0, updated: 0, skipped: [] };
  await db.transaction(async (tx0) => {
    const tx = tx0 as unknown as Tx;
    const ids = new IdMap(tx, null, o.runId ?? null);
    await ids.load();
    for (const u0 of list) {
      let v: ReturnType<typeof M.mapUser>;
      try { v = M.mapUser(u0); } catch (e) { rep.skipped.push({ what: `Корисник ${u0.username ?? u0.id}`, reason: errMsg(e) }); continue; }
      const mine = ids.get('user', v.legacyId);
      const [byName] = await tx.select({ id: users.id }).from(users).where(eq(sql`lower(${users.username})`, v.username)).limit(1);
      if (byName && byName.id !== mine) { rep.skipped.push({ what: `Корисник ${v.username}`, reason: 'корисничкото име веќе постои на серверот' }); continue; }
      const { firms: F, legacyId, ...vals } = v;
      let id = mine;
      if (id) { await tx.update(users).set(vals).where(eq(users.id, id)); rep.updated++; }
      else { const [r] = await tx.insert(users).values({ ...vals, legacyId }).returning({ id: users.id }); id = r!.id; rep.imported++; }
      await ids.set('user', legacyId, id);
      await tx.delete(userFirms).where(eq(userFirms.userId, id));
      const firmIds = F.map((f) => ids.get('firm', f)).filter((x): x is string => !!x);
      if (firmIds.length) await tx.insert(userFirms).values(firmIds.map((firmId) => ({ userId: id!, firmId }))).onConflictDoNothing();
      await audit(tx, { userId: o.userId, action: 'legacyImportUser', entityType: 'user', entityId: id, data: { username: v.username, role: v.role } });
    }
  });
  return rep;
}

/** Office settings carried by a full export / backup index. Existing server settings are never overwritten. */
export async function importSettings(db: Tx, glob: Record<string, unknown>, o: ImportOptions): Promise<string[]> {
  const out: string[] = [];
  await db.transaction(async (tx0) => {
    const tx = tx0 as unknown as Tx;
    const keep = async (key: string, value: unknown, label: string) => {
      const [ex] = await tx.select({ key: appSettings.key }).from(appSettings).where(eq(appSettings.key, key)).limit(1);
      if (ex) { out.push(`${label}: постои на серверот – не е заменето.`); return; }
      await tx.insert(appSettings).values({ key, value: value as object, updatedBy: o.userId });
      out.push(`${label}: увезено.`);
    };
    if (glob['appsettings/schemes']) await keep('schemes', glob['appsettings/schemes'], 'Глобална шема за книжење');
    if (glob['appsettings/office']) await keep('office', glob['appsettings/office'], 'Податоци за канцеларијата');
    if (glob['settings/pay']) await keep('legacy:settings/pay', glob['settings/pay'], 'Параметри за плата (стара програма)');
    const fx = arr(obj(glob['appsettings/fx']).rows);
    let n = 0;
    for (const r of fx) {
      const date = isoDate(r.date), cur = str(r.cur), rate = Number(r.rate);
      if (!date || !cur || !(rate > 0)) continue;
      await tx.insert(fxRates).values({ date, cur, rate: rate.toFixed(6), updatedBy: o.userId }).onConflictDoNothing();
      n++;
    }
    if (n) out.push(`Курсна листа: ${n} курсеви.`);
    if (out.length) await audit(tx, { userId: o.userId, action: 'legacyImportSettings', data: { notes: out } });
  });
  return out;
}

/** Import a whole bundle: settings, firms (one transaction each), then users (they reference firms). */
export async function importBundle(db: Tx, b: LegacyBundle, o: ImportOptions & { onFirm?: (r: FirmReport, i: number, n: number) => void | Promise<void>; onFirmStart?: (name: string, i: number, n: number) => void | Promise<void> }): Promise<ImportReport> {
  const glob = { ...b.glob, ...(o.glob ?? {}) };
  const settings = Object.keys(glob).length ? await importSettings(db, glob, o) : [];
  const out: FirmReport[] = [];
  for (const [i, f] of b.firms.entries()) {
    await o.onFirmStart?.(String(f.firm.name ?? f.firm.id), i, b.firms.length);
    const r = await importFirm(db, f, { ...o, glob });
    out.push(r);
    await o.onFirm?.(r, i, b.firms.length);
  }
  const usersRep = b.users.length ? await importUsers(db, b.users, o) : null;
  return { firms: out, users: usersRep, settings, warnings: b.warnings };
}

export { LEGACY_COLS, ZERO };
