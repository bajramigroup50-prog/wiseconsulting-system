/**
 * Year-end domain logic (Phase 8): AOP statements (ЦРМ forms 35–38), ДБ / ДБ-ВП, ЦРСМ XML, sole-trader and NPO
 * variants, depreciation, close / carry-forward mapping and the year-end phase gate. Pure — no I/O.
 *
 * Ported from the final effective legacy definitions (docs/LEGACY-MAP.md, Phase 8). Deliberate fixes are listed in
 * packages/core/src/yearend/YEAREND.md.
 */
import { yeBalanceSet, type YeBalanceSet, type YeLine, type YeTrialBalanceRow } from './yearend/balances';
import { zsCompute, zsRules, type ZsPayrollRun, type ZsResult, type ZsRule } from './yearend/aop';
import { computeDb, dbAkontFromTurnover, type DbResult } from './yearend/tax';
import { npoChart, npoCompute, type NpoChart, type NpoResult } from './yearend/npo';
import { tpCompute, type DldAdj, type TpResult } from './yearend/soleTrader';

export * from './yearend/balances';
export * from './yearend/aop';
export * from './yearend/tax';
export * from './yearend/close';
export * from './yearend/depreciation';
export * from './yearend/npo';
export * from './yearend/soleTrader';
export * from './yearend/crm';
export * from './yearend/findings';
export * from './yearend/entity';
export * from './yearend/notes';
export * from './yearend/rebuild';
export * from './yearend/inputs';
export * from './yearend/year';

/** Entity type (legacy `ENT`): company, sole trader, self-employed, non-profit. */
export type YeEntity = 'co' | 'tp' | 'sd' | 'npo';

/** Firm settings the year-end engine reads (subset of the legacy firm record). */
export interface YeFirm {
  ent?: YeEntity;
  zsRules?: ZsRule[];
  zsMan?: Record<string | number, Record<string, number>>;
  dbAdj?: Record<string | number, Record<string, number | string>>;
  dldAdj?: Record<string | number, DldAdj>;
  regDate?: string;
  founded?: string;
  /** firm chart overrides — only used to detect the NPO chart (konto 730) */
  accounts?: Record<string, unknown>;
}

export interface AnnualAccountInput {
  year: number;
  /** trial balance of the year: turnover without opening and without the closing journal */
  tb: readonly YeTrialBalanceRow[];
  /** the closing journal `close-<year>`, when the year is closed */
  close?: { tax: number; lines: readonly YeLine[] } | null;
  firm?: YeFirm;
  payroll?: readonly ZsPayrollRun[];
  activeEmployees?: number;
  firstPostingMonth?: string;
  hasImportedTb?: boolean;
  /** reproduce legacy behaviour (no provisional tax, legacy rounding quirks) */
  legacy?: boolean;
}

export interface AnnualAccount {
  balances: YeBalanceSet;
  rules: readonly ZsRule[];
  zs: ZsResult;
  db: DbResult;
}

/**
 * Balance sheet + income statement AOPs and the ДБ return for a company (`co`), in one call.
 * Before the year is closed, bu252 carries the ДБ tax (fix F1) so bu255 is already the net result.
 */
export function computeAnnualAccount(inp: AnnualAccountInput): AnnualAccount {
  const f = inp.firm ?? {};
  const balances = yeBalanceSet(inp.tb, inp.close?.lines ?? []);
  const rules = zsRules(f.zsRules);
  const hasOpening = inp.tb.some((r) => +(r.openingDebit ?? 0) || +(r.openingCredit ?? 0));
  const base = {
    year: inp.year,
    ...balances,
    close: inp.close ? { tax: inp.close.tax } : null,
    rules,
    manual: f.zsMan?.[inp.year] ?? null,
    payroll: inp.payroll ?? [],
    activeEmployees: inp.activeEmployees ?? 0,
    regDate: f.regDate || f.founded || '',
    firstPostingMonth: inp.firstPostingMonth ?? '',
    hasOpening,
    hasImportedTb: !!inp.hasImportedTb,
    legacy: !!inp.legacy,
  };
  const akont = dbAkontFromTurnover(inp.tb);
  const dbAdj = f.dbAdj?.[inp.year] ?? null;
  let zs = zsCompute(base);
  let db = computeDb(zs, dbAdj, akont);
  if (!inp.close && !inp.legacy && db.tax) {
    zs = zsCompute({ ...base, provisionalTax: db.tax });
    db = computeDb(zs, dbAdj, akont);
  }
  return { balances, rules, zs, db };
}

/** Sole trader / self-employed: Образец Б + ДЛД-ДБ for the year. */
export function computeSoleTrader(year: number, tb: readonly YeTrialBalanceRow[], firm: YeFirm = {}, opt: { legacy?: boolean } = {}): TpResult {
  return tpCompute(yeBalanceSet(tb).pre, firm.dldAdj?.[year] ?? null, opt);
}

/** Non-profit organisation: NPO balance sheet and income/expense statement for the year. */
export function computeNpo(tb: readonly YeTrialBalanceRow[], close: { lines: readonly YeLine[] } | null | undefined, firm: YeFirm = {}, chart?: NpoChart): NpoResult {
  const B = yeBalanceSet(tb, close?.lines ?? []);
  return npoCompute({ pre: B.pre, all: B.all, closed: !!close, chart: chart ?? npoChart(firm.accounts) });
}
