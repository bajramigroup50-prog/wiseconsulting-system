import 'server-only';
/**
 * Data of „💧 Паричен тек – прогноза“ (`@wise/core/cashflow`) for one firm: bank balances from the ledger (per bank
 * account, + the cash register 1020 when asked), open sales / purchase invoices with what the statements paid, the
 * customers' average delay (dated statement payments of the last year), the last booked payroll and the usual pay day
 * (net salaries paid from the statements, konto 2401), the VAT of the last finished period and the next ones, received
 * loans with instalments, recurring payments found in the statements of the last four months, and the manual items
 * saved on the firm (`firms.settings.cf`).
 */
import { and, desc, eq, gte, isNull, lt } from 'drizzle-orm';
import {
  cashflowPlan, cfAvgDelay, cfPayday, cfRecurringFromHistory, cfVatSchedule, cfAddDays,
  type CfDoc, type CfManual, type CfRecurring, type CfResult,
} from '@wise/core/cashflow';
import {
  bankAccounts, bankLines, bankStatements, documentPayments, invoiceBankPayments, invoices, loadLedgerLines, loans, partners, payrollRuns, purchases,
  vatDueEstimate, type Firm,
} from '@wise/db';
import { db } from './db';
import { fmt } from './fmt';

/** Settings of the forecast kept on the firm (`settings.cf`): one-off items and the minimum balance. */
export interface CfSettings { manual?: CfManual[]; min?: number }
export const cfSettings = (f: Firm): CfSettings => ((f.settings as { cf?: CfSettings }).cf ?? {});

export interface CfOpts { horizon: number; min?: number; lateIn: number | null; useDelay: boolean; cash: boolean }
export interface CfBank { konto: string; name: string; bal: number; last: string | null }
export interface CfData {
  plan: CfResult;
  banks: CfBank[];
  cash: number;
  payroll: { net: number; contrib: number; day: number; month: string } | null;
  vatKind: 'month' | 'quarter' | null;
  recurring: CfRecurring[];
  delays: { partner: string; name: string; days: number }[];
  manual: CfManual[];
  min: number;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export async function loadCashflow(firm: Firm, today: string, o: CfOpts): Promise<CfData> {
  const year = +today.slice(0, 4);
  const end = cfAddDays(today, o.horizon);
  const hist = cfAddDays(today, -365);
  const m4 = `${year}-${today.slice(5, 7)}-01`;
  const recFrom = cfAddDays(m4, -125);
  const [lines, BA, IV, PU, PA, runs, vat, LO] = await Promise.all([
    loadLedgerLines(db(), firm.id, `${year}-01-01`, `${year}-12-31`),
    db().select().from(bankAccounts).where(eq(bankAccounts.firmId, firm.id)),
    db().select({ id: invoices.id, partnerId: invoices.partnerId, number: invoices.number, date: invoices.date, due: invoices.due, total: invoices.total })
      .from(invoices).where(and(eq(invoices.firmId, firm.id), eq(invoices.status, 'posted'), eq(invoices.kind, 'invoice'))),
    db().select({ id: purchases.id, partnerId: purchases.partnerId, number: purchases.number, date: purchases.date, due: purchases.due, total: purchases.total })
      .from(purchases).where(and(eq(purchases.firmId, firm.id), eq(purchases.status, 'posted'))),
    db().select({ id: partners.id, name: partners.name }).from(partners).where(eq(partners.firmId, firm.id)),
    db().select({ month: payrollRuns.month, totals: payrollRuns.totals }).from(payrollRuns)
      .where(and(eq(payrollRuns.firmId, firm.id), eq(payrollRuns.status, 'posted'))).orderBy(desc(payrollRuns.month)).limit(1),
    vatDueEstimate(db(), firm.id, today).catch(() => null),
    db().select().from(loans).where(and(eq(loans.firmId, firm.id), eq(loans.dir, 'received'))),
  ]);
  const names = new Map(PA.map((p) => [p.id, p.name]));
  const pn = (id: string) => names.get(id) ?? (id || '—');

  // bank balances (ledger, without the closing journal), last statement per account
  const bal: Record<string, number> = {};
  for (const l of lines) if (l.kind !== 'close') bal[l.account] = (bal[l.account] ?? 0) + l.debit - l.credit;
  const last = BA.length ? await db().select({ acc: bankStatements.bankAccountId, date: bankStatements.date }).from(bankStatements)
    .where(eq(bankStatements.firmId, firm.id)).orderBy(desc(bankStatements.date)) : [];
  const seen = new Set<string>();
  const banks: CfBank[] = [];
  for (const b of BA.filter((x) => x.active || Math.abs(bal[x.konto] ?? 0) > 0.009)) {
    if (seen.has(b.konto)) continue;
    seen.add(b.konto);
    banks.push({ konto: b.konto, name: b.name + (b.cur && b.cur !== 'MKD' ? ` (${b.cur})` : ''), bal: r2(bal[b.konto] ?? 0), last: last.find((s) => s.acc === b.id)?.date ?? null });
  }
  const cash = r2(bal['1020'] ?? 0);
  const start = r2(banks.reduce((s, b) => s + b.bal, 0) + (o.cash ? cash : 0));

  // open documents (paid = statement payments, as in Анализи)
  const pay = await documentPayments(db(), firm.id, { invoiceIds: IV.map((i) => i.id), purchaseIds: PU.map((p) => p.id) });
  const doc = (p: { id: string; partnerId: string | null; number: string | null; date: string; due: string | null; total: string }): CfDoc => {
    const P = pay.get(p.id);
    return { id: p.id, partner: p.partnerId ?? '', number: p.number, date: p.date, due: p.due, total: P?.total ?? Number(p.total), paid: P?.paid ?? 0 };
  };
  const inv = IV.map(doc), pur = PU.map(doc);

  // average delay per customer from the dated payments of the last year
  const recent = IV.filter((i) => i.date >= hist);
  const IP = recent.length ? await invoiceBankPayments(db(), firm.id, recent.map((i) => i.id)) : new Map<string, { date: string; amt: number }[]>();
  const delayMap = cfAvgDelay(recent.map((i) => ({ partner: i.partnerId ?? '', date: i.date, due: i.due, pays: IP.get(i.id) ?? [] })));

  // statement lines of the last months: pay day of net salaries (2401) and recurring payments without a document
  const BL = BA.length ? await db().select({ date: bankLines.date, amount: bankLines.amount, konto: bankLines.konto, partnerId: bankLines.partnerId, name: bankLines.name, description: bankLines.description, own: bankLines.own })
    .from(bankLines).where(and(eq(bankLines.firmId, firm.id), gte(bankLines.date, cfAddDays(today, -190)), lt(bankLines.amount, '0'), isNull(bankLines.refId), isNull(bankLines.refs))) : [];
  const payDates = BL.filter((l) => l.konto === '2401').map((l) => l.date);
  const run = runs[0];
  const T = (run?.totals ?? {}) as Record<string, number>;
  const net = r2(Number(T.net) || 0), gross = r2(Number(T.gross) || 0);
  const contrib = r2(net ? (gross - net) + (Number(T.dopl) || 0) : (Number(T.contr) || 0) + (Number(T.tax) || 0) + (Number(T.dopl) || 0));
  const payroll = run && (net || contrib) ? { net: net || 0, contrib, day: cfPayday(payDates), month: run.month } : null;

  const loanK = new Set(LO.map((l) => l.konto).filter(Boolean) as string[]);
  // salaries, taxes / VAT, suppliers / customers (their invoices are counted already), own transfers and cash
  const NOT_REC = /^(10|12|22|23|2401|2205)/;
  const recurring = cfRecurringFromHistory(BL.filter((l) => !l.own && l.date >= recFrom && l.konto && !NOT_REC.test(l.konto) && !loanK.has(l.konto)).map((l) => {
    const who = l.partnerId ? pn(l.partnerId) : (l.name || l.description || '').trim().slice(0, 40);
    return { date: l.date, amount: -Number(l.amount), key: (l.partnerId || who.toLowerCase()) + '|' + l.konto, label: `${who} (${l.konto})` };
  }), today);
  // received loans with instalments still running
  for (const l of LO) {
    if (!l.termDate || l.termDate <= today || !(l.installments > 1)) continue;
    const amt = r2(Number(l.amount) / l.installments);
    if (amt > 0) recurring.push({ label: `Рата: ${l.partnerId ? pn(l.partnerId) : l.partnerName ?? 'заем'}${l.number ? ' (' + l.number + ')' : ''}`, amount: amt, day: +l.date.slice(8, 10), kind: 'loan', until: l.termDate });
  }

  const vatKind = vat ? (firm.vatPeriod === 'month' ? 'month' : 'quarter') : null;
  const vatList = vat && vatKind ? cfVatSchedule({ today, end, kind: vatKind, last: { period: vat.period, due: vat.due, amount: vat.amount } }) : [];
  const S = cfSettings(firm);
  const min = o.min ?? S.min ?? 0;
  const manual = S.manual ?? [];

  const plan = cashflowPlan({
    today, horizon: o.horizon, start, invoices: inv, purchases: pur, delays: delayMap, useDelay: o.useDelay, lateIn: o.lateIn,
    payroll, vat: vatList, recurring, manual, min, partnerName: pn, fmt,
  });
  const delays = [...delayMap.entries()].filter(([p, d]) => d > 0 && inv.some((i) => i.partner === p && i.total - i.paid > 0.009))
    .map(([partner, days]) => ({ partner, name: pn(partner), days })).sort((a, b) => b.days - a.days);
  // stale statements: a warning when the newest statement of an active account is older than a week
  const stale = banks.filter((b) => b.last && b.last < cfAddDays(today, -7));
  if (stale.length) plan.warnings.push(`Последниот извод за ${stale.map((b) => `${b.name} е од ${b.last!.split('-').reverse().join('.')}`).join(', ')} – почетната состојба можеби не е ажурна.`);
  if (!banks.length) plan.warnings.push('Фирмата нема банкарски сметки во WISE – почетната состојба е 0 (додадете ги во „Банки и формати на изводи“).');
  return { plan, banks, cash, payroll, vatKind, recurring, delays, manual, min };
}

/** Parse the URL options of the page / the Excel route. */
export function cfOptsFrom(sp: { h?: string; min?: string; late?: string; delay?: string; cash?: string }, saved: CfSettings): CfOpts {
  const h = [30, 60, 90].includes(Number(sp.h)) ? Number(sp.h) : 30;
  const mn = sp.min != null && sp.min !== '' ? Math.max(0, Number(String(sp.min).replace(/[\s.]/g, '').replace(',', '.')) || 0) : saved.min;
  const late = sp.late === 'no' ? null : [0, 7, 14, 30].includes(Number(sp.late)) ? Number(sp.late) : 7;
  return { horizon: h, min: mn, lateIn: late, useDelay: sp.delay !== '0', cash: sp.cash !== '0' };
}

