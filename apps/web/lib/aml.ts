import 'server-only';
/** AML facts from the books (legacy `amlAuto` 15873), shared by the AML page and its save action. */
import { r2 } from '@wise/core';
import { AML_LINK_DAYS, amlDeadline, amlIsMoney, amlScan, apCashLimit, nkdRisky, type AmlAuto, type AmlMoneyLine, type AmlOfficeState, todaySkopje } from '@wise/core/office';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { amlReports, appSettings, audit, employees, getOfficeProfile, loadLedgerLines, partners, type Firm } from '@wise/db';
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
export const AML_KEY = 'aml';

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

/** Default high-risk list until the officer reviews it (FATF „call for action“ as published; за проверка — the list changes). */
export const AML_HRC_DEFAULT = ['KP', 'IR', 'MM', 'Северна Кореја', 'Иран', 'Мјанмар'];

/**
 * Money lines (100–108) of a firm between two dates, each with the counter-party of its journal: the line's own
 * partner, else the only partner on the other lines of the same journal.
 */
export async function amlMoneyLines(firmId: string, from: string, to: string): Promise<AmlMoneyLine[]> {
  const L = (await loadLedgerLines(db(), firmId, from, to)).map((l) => ({ ...l, journalId: l.journalId ?? `${l.date}:${l.number ?? ""}` }));
  const byJ = new Map<string, Set<string>>();
  /** journals with a non-money line (a cash deposit to the bank has only money lines → a transfer, not a client transaction) */
  const real = new Set<string>();
  for (const l of L) {
    if (l.partnerId) byJ.set(l.journalId, (byJ.get(l.journalId) ?? new Set()).add(l.partnerId));
    if (!amlIsMoney(l.account)) real.add(l.journalId);
  }
  const M = L.filter((l) => amlIsMoney(l.account));
  const ids = [...new Set(M.map((l) => l.partnerId ?? (byJ.get(l.journalId)?.size === 1 ? [...byJ.get(l.journalId)!][0]! : null)).filter((x): x is string => !!x))];
  const P = ids.length ? await db().select({ id: partners.id, name: partners.name, country: partners.country, foreign: partners.foreign }).from(partners).where(inArray(partners.id, ids)) : [];
  const pm = new Map(P.map((p) => [p.id, p]));
  return M.map((l) => {
    const pid = l.partnerId ?? (byJ.get(l.journalId)?.size === 1 ? [...byJ.get(l.journalId)!][0]! : null);
    const p = pid ? pm.get(pid) : undefined;
    return { key: `${l.journalId}:${l.lineNo}`, date: String(l.date).slice(0, 10), account: l.account, debit: l.debit, credit: l.credit, partnerId: pid, partnerName: p?.name ?? '', country: p?.country ?? null, doc: l.doc ?? l.number ?? null, transfer: !real.has(l.journalId) };
  });
}

/**
 * Monitoring run for one firm: scan the books from `from` to `to` and queue the new alerts (rows of `aml_reports`
 * with `data.kind = 'alert'`). Alerts already in the queue (same key) are skipped, so a re-run never duplicates. The
 * audit entry carries no firm id (ban on disclosure: the client's own audit trail never shows AML work).
 */
export async function amlScanFirm(firm: Firm, from: string, to: string, u: { id: string; name: string }): Promise<number> {
  const O = await amlOffice();
  const P = await getOfficeProfile(db());
  const eurRate = Number(P.eurRate) || 61.5;
  const lines = await amlMoneyLines(firm.id, from, to);
  const A = amlScan(lines, { eurRate, linkDays: O.linkDays || AML_LINK_DAYS, hrc: O.hrc ?? AML_HRC_DEFAULT });
  if (!A.length) return 0;
  return db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'aml-scan:' + firm.id}))`);
    const have = new Set((await tx.select({ k: sql<string>`${amlReports.data}->>'key'` }).from(amlReports)
      .where(and(eq(amlReports.firmId, firm.id), sql`${amlReports.data}->>'kind' = 'alert'`))).map((r) => r.k));
    const fresh = A.filter((a) => !have.has(a.key));
    if (!fresh.length) return 0;
    const td = todaySkopje();
    await tx.insert(amlReports).values(fresh.map((a) => ({
      firmId: firm.id, firmName: firm.name, text: a.text, createdBy: u.id, createdByName: 'Мониторинг',
      data: { kind: 'alert', key: a.key, rule: a.rule, date: a.date, amount: a.amount, dir: a.dir, partnerId: a.partnerId, partnerName: a.partnerName, refs: a.refs, eurRate, due: amlDeadline('alert', td) },
    })));
    await audit(tx, { userId: u.id, action: 'amlScan', entityType: 'aml_report', entityId: firm.id, data: { client: firm.id, from, to, alerts: fresh.length } });
    return fresh.length;
  });
}
