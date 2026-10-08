/**
 * Phase 4 — what every bank / cash service needs to know about a firm: its bank accounts in matching form,
 * rules, partners, posting scheme and the configurable bank kontos, exchange-rate sources.
 */
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import {
  BANK_KONTA, r2, schemeValue,
  type BankAccount, type BankKonta, type BankRule, type FxRateRow, type Partner as MatchPartner, type PostingContext, type SchemeSettings,
} from '@wise/core';
import type { Tx } from '../audit';
import { appSettings, bankAccounts, bankRules, codes, firms, fxRates, partners, type BankAccountRow, type Firm } from '../schema/index';

/* ---------------- money helpers (cents ↔ numeric strings) ---------------- */

/** numeric / number → integer cents. */
export const cents = (v: string | number | null | undefined): number => Math.round(r2(Number(v ?? 0) || 0) * 100) || 0;
/** integer cents → numeric(18,2) string. */
export const dec = (c: number): string => (c / 100).toFixed(2);
/** integer cents → denars. */
export const den = (c: number): number => (c ? c / 100 : 0);

/* ---------------- posting context ---------------- */

const settingsOf = (f: Pick<Firm, 'settings'>) => (f.settings ?? {}) as Record<string, unknown>;

/**
 * Posting context of a firm: `firms.settings` scheme overrides (`sch`, `vatIn`, `vatOut`, `vatImp`, `vatInKonto`,
 * `posK`) and the office scheme (`app_settings` key `schemes`).
 * TODO(merge): Phase 3 builds the same context for invoices/purchases — keep one helper after merging.
 */
export async function firmPostingContext(tx: Tx, f: Firm, posPartnerId?: string | null): Promise<PostingContext> {
  const s = settingsOf(f);
  const [g] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, 'schemes')).limit(1);
  return {
    firm: {
      sch: (s.sch as SchemeSettings['sch']) ?? null,
      vatOut: (s.vatOut as SchemeSettings['vatOut']) ?? null,
      vatIn: (s.vatIn as SchemeSettings['vatIn']) ?? null,
      vatImp: (s.vatImp as SchemeSettings['vatImp']) ?? null,
      vatInKonto: (s.vatInKonto as string) ?? null,
      ddv: f.vatRegistered,
      posK: (s.posK as string) ?? null,
      posPartnerId: posPartnerId ?? null,
    },
    global: (g?.value as SchemeSettings | undefined) ?? null,
  };
}

/**
 * Bank kontos used by matching / classification. FIX(4.4 #10, #11): legacy hard-coded 1030/1039/1009 and
 * `sch('ddvPay')||'23008'` (dead fallback); here customer/supplier/FX/VAT/POS come from the posting scheme
 * and the rest can be overridden per firm in `firms.settings.bankKonta`.
 */
export function bankKontaFor(f: Firm, ctx: PostingContext): BankKonta {
  const s = settingsOf(f);
  return {
    ...BANK_KONTA,
    customer: schemeValue(ctx, 'customer') || BANK_KONTA.customer,
    supplier: schemeValue(ctx, 'supplier') || BANK_KONTA.supplier,
    importSupplier: schemeValue(ctx, 'supplierFx') || BANK_KONTA.importSupplier,
    fxGain: schemeValue(ctx, 'fxGain') || BANK_KONTA.fxGain,
    fxLoss: schemeValue(ctx, 'fxLoss') || BANK_KONTA.fxLoss,
    ddvPay: schemeValue(ctx, 'ddvPay') || BANK_KONTA.ddvPay,
    ddvClaim: schemeValue(ctx, 'ddvClaim') || BANK_KONTA.ddvClaim,
    pos: (s.posK as string) || schemeValue(ctx, 'posCard') || BANK_KONTA.pos,
    ...((s.bankKonta as Partial<BankKonta>) ?? {}),
  };
}

/** Name of the POS-terminal partner (legacy `POS_NAME`). */
export const POS_PARTNER_NAME = 'POS терминал';

export const toMatchAccount = (a: BankAccountRow): BankAccount & { iban?: string | null } => ({
  id: a.id, name: a.name, account: a.account ?? a.iban ?? '', konto: a.konto, cur: a.cur || 'MKD', nal: a.nal ?? undefined, iban: a.iban,
});

export interface BankEnv {
  firm: Firm;
  accountRows: BankAccountRow[];
  accounts: (BankAccount & { iban?: string | null })[];
  rules: BankRule[];
  osnovK: Record<string, string>;
  partners: MatchPartner[];
  posting: PostingContext;
  konta: BankKonta;
  posPartner?: string;
}

export async function loadFirm(tx: Tx, firmId: string): Promise<Firm> {
  const [f] = await tx.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!f) throw new Error('Фирмата не постои.');
  return f;
}

export async function loadBankAccounts(tx: Tx, firmId: string): Promise<BankAccountRow[]> {
  return tx.select().from(bankAccounts).where(eq(bankAccounts.firmId, firmId)).orderBy(asc(bankAccounts.sort), asc(bankAccounts.createdAt));
}

export async function loadBankEnv(tx: Tx, firmId: string): Promise<BankEnv> {
  const firm = await loadFirm(tx, firmId);
  const [accountRows, R, P] = await Promise.all([
    loadBankAccounts(tx, firmId),
    tx.select().from(bankRules).where(eq(bankRules.firmId, firmId)).orderBy(asc(bankRules.createdAt)),
    tx.select({ id: partners.id, name: partners.name, edb: partners.edb, embs: partners.embs, code: partners.code }).from(partners).where(eq(partners.firmId, firmId)),
  ]);
  const s = settingsOf(firm);
  const posPartner = (s.posP as string) && P.some((p) => p.id === s.posP) ? (s.posP as string) : P.find((p) => p.name === POS_PARTNER_NAME)?.id;
  const posting = await firmPostingContext(tx, firm, posPartner);
  return {
    firm,
    accountRows,
    accounts: accountRows.map(toMatchAccount),
    rules: R.filter((r) => r.kind === 'desc').map((r) => ({ match: r.match, konto: r.konto, learned: r.learned })),
    osnovK: Object.fromEntries(R.filter((r) => r.kind === 'osnov').map((r) => [r.match, r.konto])),
    partners: P.map((p) => ({ id: p.id, name: p.name, edb: p.edb ?? undefined, embs: p.embs ?? undefined, code: p.code ?? undefined })),
    posting,
    konta: bankKontaFor(firm, posting),
    ...(posPartner ? { posPartner } : {}),
  };
}

/* ---------------- exchange rates ---------------- */

export interface FxSources { firm: FxRateRow[]; office: FxRateRow[] }

/** Rate sources for `fxRate`: the firm's currency codebook, then the office rate list (`fx_rates`). */
export async function loadFxSources(tx: Tx, firmId: string | null): Promise<FxSources> {
  const [own, office] = await Promise.all([
    firmId
      ? tx.select({ code: codes.code, data: codes.data }).from(codes).where(and(eq(codes.firmId, firmId), eq(codes.cb, 'currency')))
      : Promise.resolve([] as { code: string | null; data: Record<string, unknown> }[]),
    tx.select({ cur: fxRates.cur, rate: fxRates.rate, date: fxRates.date }).from(fxRates),
  ]);
  return {
    firm: own.map((r) => ({ cur: String(r.code ?? '').toUpperCase(), rate: Number(r.data?.rate) || 0, date: (r.data?.date as string) || undefined }))
      .filter((r) => r.cur && r.rate),
    office: office.map((r) => ({ cur: r.cur, rate: Number(r.rate), date: r.date })),
  };
}

/** Keep `firms.settings.banks` (read by the nalog numbering, `bankNalCode`) in sync with `bank_accounts`. */
export async function syncFirmBanks(tx: Tx, firmId: string): Promise<void> {
  const A = await loadBankAccounts(tx, firmId);
  const f = await loadFirm(tx, firmId);
  const banks = A.map((a) => ({ id: a.id, name: a.name, cur: a.cur, ...(a.nal ? { nal: a.nal } : {}) }));
  await tx.update(firms).set({ settings: { ...settingsOf(f), banks } }).where(eq(firms.id, firmId));
}

/** Global codebook rows are not firm-specific; helper for the currency list in the UI. */
export async function currencyCodes(tx: Tx, firmId: string | null): Promise<string[]> {
  const rows = await tx.select({ code: codes.code }).from(codes)
    .where(and(eq(codes.cb, 'currency'), firmId ? or(isNull(codes.firmId), eq(codes.firmId, firmId)) : isNull(codes.firmId)));
  return [...new Set(rows.map((r) => String(r.code ?? '').toUpperCase()).filter(Boolean))].sort();
}
