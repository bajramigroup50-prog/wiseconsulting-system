/**
 * One year of a firm through the engine, by entity type — the single entry point the application uses for the
 * statements, the tax returns and the close (so the close, bu252 and the returns can never disagree).
 *
 * FIX(P8 #12): legacy `closeYear` was not entity-gated (an NPO or a sole trader got the company close with a ДБ/10 %
 * tax). The close here follows the entity:
 *   co  → `closeYearLines` with the ДБ tax (AOP 56), or the ДБ-ВП tax when the firm opted for the tax on total income;
 *   tp/sd → `closeYearLines` with the ДЛД-ДБ tax (the result and tax of Образец Б, fix T1);
 *   npo → `npoCloseLines` (statutory NPO accounts on the NPO chart, company mapping on the company chart).
 */
import { r2 } from '../money';
import { yeBalanceSet, type YeLine } from './balances';
import { computeVp, type VpAdj, type VpResult } from './tax';
import { closeYearLines, openYearLines, type PartnerBalance } from './close';
import { npoChart, npoCloseLines, npoCompute, type NpoChart, type NpoResult } from './npo';
import { tpCompute, type DldAdj, type TpResult } from './soleTrader';
import { dbAkontFromTurnover } from './tax';
import { zsCompute, zsRules, type ZsPayrollRun, type ZsResult, type ZsRule } from './aop';
import type { YeLedgerInputs } from './inputs';
import { computeAnnualAccount, type AnnualAccount, type YeEntity } from '../yearend';

/** Per-year inputs kept with the annual statement (manual amounts, return inputs). */
export interface YeYearSettings {
  zsMan?: Record<string, number> | null;
  dbAdj?: Record<string, number | string> | null;
  vpAdj?: (VpAdj & { on?: boolean }) | null;
  dldAdj?: DldAdj | null;
}

export interface YeYearInput {
  year: number;
  ent: YeEntity;
  inputs: YeLedgerInputs;
  settings: YeYearSettings;
  /** firm-wide AOP rules (`settings.zsRules`) */
  rules?: readonly ZsRule[] | null;
  /** firm chart overrides (only to detect the NPO chart) */
  accounts?: Readonly<Record<string, unknown>> | null;
  payroll?: readonly ZsPayrollRun[];
  activeEmployees?: number;
  regDate?: string;
  firm?: { name?: string | null; activity?: string | null };
  /** tax of the existing close when known (journal meta; an imported close has no 81x lines) */
  closeTax?: number;
  /** compute as if the year were not closed (used to build the close itself) */
  ignoreClose?: boolean;
}

export interface YeYear {
  ent: YeEntity;
  closed: boolean;
  /** company / sole-trader AOP statements and ДБ */
  co: AnnualAccount;
  vp: VpResult;
  /** sole trader / self-employed */
  tp: TpResult | null;
  /** NPO */
  npo: NpoResult | null;
  npoChart: NpoChart;
}

export function yeComputeYear(inp: YeYearInput): YeYear {
  const I = inp.inputs;
  const closeLines = inp.ignoreClose ? [] : I.closeLines;
  const closed = closeLines.length > 0;
  const S = inp.settings;
  const B = yeBalanceSet(I.tb, closeLines);
  // tax of the existing close = what it booked on 8100 (debit); the NPO chart books 810
  const closeTax = !closed ? 0 : inp.closeTax ?? r2(closeLines.filter((l) => /^81/.test(l.account)).reduce((s, l) => s + (+l.debit || 0), 0));
  const co = computeAnnualAccount({
    year: inp.year,
    tb: I.tb,
    close: closed ? { tax: closeTax, lines: closeLines } : null,
    firm: {
      ent: inp.ent,
      zsRules: inp.rules ? [...inp.rules] : undefined,
      zsMan: S.zsMan ? { [inp.year]: S.zsMan } : undefined,
      dbAdj: S.dbAdj ? { [inp.year]: S.dbAdj } : undefined,
      regDate: inp.regDate,
    },
    payroll: inp.payroll,
    activeEmployees: inp.activeEmployees,
    firstPostingMonth: I.firstPostingMonth,
    hasImportedTb: I.hasImportedTb,
  });
  const vp = computeVp(co.zs, S.vpAdj, dbAkontFromTurnover(I.tb), { name: inp.firm?.name ?? '', activity: inp.firm?.activity ?? '' });
  const tp = inp.ent === 'tp' || inp.ent === 'sd' ? tpCompute(B.pre, S.dldAdj) : null;
  const chart = npoChart(inp.accounts);
  const npo = inp.ent === 'npo' ? npoCompute({ pre: B.pre, all: B.all, closed, chart }) : null;
  return { ent: inp.ent, closed, co, vp, tp, npo, npoChart: chart };
}

/**
 * How the closing tax was set (shown on the close screen and kept in the year-closing snapshot):
 * `db` ДБ AOP 56, `vp` ДБ-ВП AOP 06, `dld` ДЛД-ДБ, `npo` NPO tax on economic activity.
 */
export type YeTaxSource = 'db' | 'vp' | 'dld' | 'npo';

export interface YeClosePlan {
  lines: YeLine[];
  profit: number;
  tax: number;
  net: number;
  taxSource: YeTaxSource;
  /** the year as computed before the close (statements, returns) */
  before: YeYear;
}

/** The closing journal for the year (always computed from the balances WITHOUT an existing close). */
export function yeClosePlan(inp: YeYearInput): YeClosePlan {
  const before = yeComputeYear({ ...inp, ignoreClose: true });
  const B = yeBalanceSet(inp.inputs.tb);
  if (before.ent === 'npo' && before.npo) {
    const r = npoCloseLines(B.pre, before.npo, before.npoChart);
    return { ...r, taxSource: 'npo', before };
  }
  let tax: number;
  let taxSource: YeTaxSource;
  if (before.tp) {
    tax = before.tp.tax;
    taxSource = 'dld';
  } else if (inp.settings.vpAdj?.on) {
    tax = before.vp.tax;
    taxSource = 'vp';
  } else {
    tax = before.co.db.tax;
    taxSource = 'db';
  }
  const r = closeYearLines(B.pre, tax);
  return { ...r, taxSource, before };
}

/** Opening journal of the next year from the closed year (balances INCLUDING the close). */
export function yeOpenPlan(inputs: YeLedgerInputs): YeLine[] {
  const B = yeBalanceSet(inputs.tb, inputs.closeLines);
  return openYearLines(B.all, inputs.partnerBalances as PartnerBalance[]);
}

/** AOP values of a previous year that has no ledger in the system (only manual / imported amounts). */
export function yeManualOnly(year: number, manual: Record<string, number> | null | undefined, rules?: readonly ZsRule[] | null): ZsResult {
  const empty = yeBalanceSet([]);
  return zsCompute({ year, ...empty, rules: zsRules(rules ?? undefined), manual: manual ?? null });
}
