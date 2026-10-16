import 'server-only';
/** AML facts from the books (legacy `amlAuto` 15873), shared by the AML page and its save action. */
import { r2 } from '@wise/core';
import { apCashLimit, nkdRisky, type AmlAuto, type AmlMoneyLine, type AmlOfficeState } from '@wise/core/office';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { AML_HRC_DEFAULT, AML_KEY, amlMoneyLinesOf, amlScanFirmTx, appSettings, employees, getOfficeProfile, loadLedgerLines, type Firm } from '@wise/db';
import { Forbidden, requireCan } from './auth';
import { db } from './db';
import type { FirmOfficeSettings } from './office';

/**
 * Office AML settings (legacy `kdOff.aml`): officer, deputy, user with access, trainings, annual control — plus the
 * appointment / notification to УФР, the internal program, the office's own risk assessment, the internal-control
 * log and the monitoring settings (high-risk countries, linked-transaction window).
 */
export interface AmlOffice extends AmlOfficeState {
  /** Officer / deputy contact (for the notification to УФР and the reports). */
  offPos?: string; offPhone?: string; offEmail?: string; depPos?: string;
  appointNo?: string;
  /** High-risk third countries (ISO codes or names), maintained by the officer from the УФР / FATF / EU lists. */
  hrc?: string[]; hrcDate?: string | null;
  linkDays?: number;
  /** Program: date adopted, number, next review. */
  progNo?: string;
  /** Employees' confidentiality statements (чл. 72 ст.3). */
  conf?: { name: string; date: string }[];
  /** Office contact for the reports to УФР. */
  ufrUser?: string;
}

/** Guard for every AML action: office permission and (owner or the appointed officer). */
export async function amlGuard() {
  const u = await requireCan('office', null);
  if (!(await amlAllowed(u))) { const e = new Forbidden('aml'); e.message = '🔒 Само сопственикот и овластеното лице.'; throw e; }
  return u;
}
/** `file_links.entity_type` of the CDD documents (office files — `files.firm_id` null — never served to a client). */
export const AML_CDD_ENTITY = 'aml_cdd';
export { AML_KEY };

export async function amlOffice(): Promise<AmlOffice> {
  const [r] = await db().select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, AML_KEY)).limit(1);
  return (r?.v ?? {}) as AmlOffice;
}

/** Legacy `amlOn`: the owner (administrator) or the user named as AML officer. */
export async function amlAllowed(u: { id: string; role: string }): Promise<boolean> {
  if (u.role === 'admin') return true;
  return (await amlOffice()).offUid === u.id;
}

export async function amlAutoFor(firm: Firm, year: number): Promise<AmlAuto & { eurRate: number; nkd: string }> {
  const O = await getOfficeProfile(db());
  const eurRate = Number(O.eurRate) || 61.5;
  const L = await loadLedgerLines(db(), firm.id, `${year}-01-01`, `${year}-12-31`);
  const lim = apCashLimit(eurRate);
  const cash = L.filter((l) => l.account.startsWith('102') && Math.max(l.debit, l.credit) >= lim);
  const rev = r2(L.filter((l) => /^7[4-6]/.test(l.account)).reduce((a, l) => a + l.credit - l.debit, 0));
  const s = firm.settings as FirmOfficeSettings;
  const nkd = s.nkd ?? firm.activity ?? '';
  const reg = s.regDate ? new Date(s.regDate) : null;
  return {
    cash: cash.length, cashMax: cash.reduce((a, l) => Math.max(a, l.debit, l.credit), 0), rev,
    // Phase 6: active employees of the firm (legacy `amlAuto`: active and without an end date).
    emps: ((await db().select({ n: sql<number>`count(*)::int` }).from(employees).where(and(eq(employees.firmId, firm.id), eq(employees.active, true), isNull(employees.end))))[0]?.n ?? 0),
    nkdRisk: nkdRisky(nkd), age: reg && !Number.isNaN(+reg) ? (Date.now() - +reg) / 31557600000 : null,
    eurRate, nkd,
  };
}

/** Default high-risk list until the officer reviews it (shared with the weekly monitoring, `@wise/db` automation/aml.ts). */
export { AML_HRC_DEFAULT };

/** Money lines (100–108) of a firm between two dates with their counter-party (`@wise/db` `amlMoneyLinesOf`). */
export const amlMoneyLines = (firmId: string, from: string, to: string): Promise<AmlMoneyLine[]> => amlMoneyLinesOf(db(), firmId, from, to);

/**
 * Monitoring run for one firm (`@wise/db` `amlScanFirmTx`, also the weekly P43 job): new alerts into the queue, a re-run
 * never duplicates; the audit entry carries no firm id.
 */
export const amlScanFirm = (firm: Firm, from: string, to: string, u: { id: string; name: string }): Promise<number> => amlScanFirmTx(db(), firm, from, to, u);
