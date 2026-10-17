/**
 * P43 — 🛡 УФР weekly: the monitoring of the books (`amlScanFirm`, the same scan as „📡 Провери ги книжењата“) for
 * every client, and the list of records whose 10-year retention ended (чл. 62) PREPARED for the owner — never deleted
 * automatically (deleting stays the owner's „Избриши“ on the AML screen). Audit entries carry no firm id (ban on
 * disclosure, чл. 72).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AML_LINK_DAYS, amlCanPurge, amlDeadline, amlIsMoney, amlRetentionBase, amlScan, todaySkopje, type AmlCdd, type AmlMoneyLine } from '@wise/core/office';
import { audit, type Tx } from '../audit';
import { loadLedgerLines } from '../ledger-queries';
import { getOfficeProfile } from '../office';
import { amlRecords, amlReports, appSettings, partners, type Firm } from '../schema/index';
import { autoFirms, autoOn, noteAutoRun } from './common';

/** `app_settings` key of the office AML settings (`apps/web/lib/aml.ts` `AmlOffice`). */
export const AML_KEY = 'aml';
/** Default high-risk list until the officer reviews it (FATF „call for action“ as published; за проверка — the list changes). */
export const AML_HRC_DEFAULT = ['KP', 'IR', 'MM', 'Северна Кореја', 'Иран', 'Мјанмар'];

export async function amlOfficeSettings(tx: Pick<Tx, 'select'>): Promise<Record<string, unknown> & { linkDays?: number; hrc?: string[] }> {
  const [r] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, AML_KEY)).limit(1);
  return (r?.v ?? {}) as Record<string, unknown>;
}

/**
 * Money lines (100–108) of a firm between two dates, each with the counter-party of its journal: the line's own
 * partner, else the only partner on the other lines of the same journal.
 */
export async function amlMoneyLinesOf(tx: Tx, firmId: string, from: string, to: string): Promise<AmlMoneyLine[]> {
  const L = (await loadLedgerLines(tx, firmId, from, to)).map((l) => ({ ...l, journalId: l.journalId ?? `${l.date}:${l.number ?? ''}` }));
  const byJ = new Map<string, Set<string>>();
  /** journals with a non-money line (a cash deposit to the bank has only money lines → a transfer, not a client transaction) */
  const real = new Set<string>();
  for (const l of L) {
    if (l.partnerId) byJ.set(l.journalId, (byJ.get(l.journalId) ?? new Set()).add(l.partnerId));
    if (!amlIsMoney(l.account)) real.add(l.journalId);
  }
  const M = L.filter((l) => amlIsMoney(l.account));
  const ids = [...new Set(M.map((l) => l.partnerId ?? (byJ.get(l.journalId)?.size === 1 ? [...byJ.get(l.journalId)!][0]! : null)).filter((x): x is string => !!x))];
  const P = ids.length ? await tx.select({ id: partners.id, name: partners.name, country: partners.country, foreign: partners.foreign }).from(partners).where(inArray(partners.id, ids)) : [];
  const pm = new Map(P.map((p) => [p.id, p]));
  return M.map((l) => {
    const pid = l.partnerId ?? (byJ.get(l.journalId)?.size === 1 ? [...byJ.get(l.journalId)!][0]! : null);
    const p = pid ? pm.get(pid) : undefined;
    return { key: `${l.journalId}:${l.lineNo}`, date: String(l.date).slice(0, 10), account: l.account, debit: l.debit, credit: l.credit, partnerId: pid, partnerName: p?.name ?? '', country: p?.country ?? null, doc: l.doc ?? l.number ?? null, transfer: !real.has(l.journalId) };
  });
}

/**
 * Monitoring run for one firm: scan the books from `from` to `to` and queue the new alerts (rows of `aml_reports`
 * with `data.kind = 'alert'`). Alerts already in the queue (same key) are skipped, so a re-run never duplicates.
 */
export async function amlScanFirmTx(db: Tx, firm: Pick<Firm, 'id' | 'name'>, from: string, to: string, u: { id: string | null; name: string }): Promise<number> {
  const O = await amlOfficeSettings(db);
  const eurRate = Number((await getOfficeProfile(db)).eurRate) || 61.5;
  const lines = await amlMoneyLinesOf(db, firm.id, from, to);
  const A = amlScan(lines, { eurRate, linkDays: O.linkDays || AML_LINK_DAYS, hrc: O.hrc ?? AML_HRC_DEFAULT });
  if (!A.length) return 0;
  return db.transaction(async (tx) => {
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
    await audit(tx, { userId: u.id, action: 'amlScan', entityType: 'aml_report', entityId: firm.id, data: { client: firm.id, from, to, alerts: fresh.length, ...(u.id ? {} : { auto: true }) } });
    return fresh.length;
  });
}

/** Records whose retention period ended (the owner may delete them; nothing is deleted here). */
export async function amlPurgeList(tx: Pick<Tx, 'select'>, today: string): Promise<{ clients: { firmId: string; relEnd: string | null }[]; reports: { id: string; firmName: string; base: string | null }[] }> {
  const [R, P] = await Promise.all([
    tx.select({ firmId: amlRecords.firmId, data: amlRecords.data }).from(amlRecords),
    tx.select({ id: amlReports.id, firmName: amlReports.firmName, data: amlReports.data }).from(amlReports),
  ]);
  return {
    clients: R.map((r) => ({ firmId: r.firmId, relEnd: (r.data as AmlCdd).relEnd ?? null })).filter((r) => amlCanPurge(r.relEnd, today)),
    reports: P.map((r) => ({ id: r.id, firmName: r.firmName, base: amlRetentionBase(r.data) })).filter((r) => amlCanPurge(r.base, today)),
  };
}

export interface AutoAmlResult { clients: number; alerts: number; purge: number; errors: string[]; skipped: boolean }

/** Weekly (Sunday 04:00): monitoring from 1 January (of last month's year) to today, then the purge list. */
export async function runAutoAml(db: Tx, o: { today?: string; force?: boolean } = {}): Promise<AutoAmlResult> {
  const out: AutoAmlResult = { clients: 0, alerts: 0, purge: 0, errors: [], skipped: false };
  if (!o.force && !(await autoOn(db, 'aml'))) return { ...out, skipped: true };
  const today = o.today ?? todaySkopje();
  const y = today.slice(5, 7) === '01' ? Number(today.slice(0, 4)) - 1 : Number(today.slice(0, 4));
  for (const f of await autoFirms(db, { office: false })) {
    try { out.alerts += await amlScanFirmTx(db, f, `${y}-01-01`, today, { id: null, name: 'Автоматски' }); out.clients++; }
    catch (e) { out.errors.push(`${f.name}: ${(e as Error).message}`); }
  }
  const P = await amlPurgeList(db, today);
  out.purge = P.clients.length + P.reports.length;
  await noteAutoRun(db, 'aml', `${out.clients} клиенти · нови сигнали ${out.alerts} · за бришење (истечен рок) ${out.purge}`, { alerts: out.alerts, purge: out.purge });
  return out;
}
