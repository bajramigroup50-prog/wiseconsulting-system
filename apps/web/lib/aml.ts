import 'server-only';
/** AML facts from the books (legacy `amlAuto` 15873), shared by the AML page and its save action. */
import { r2 } from '@wise/core';
import { apCashLimit, nkdRisky, type AmlAuto } from '@wise/core/office';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { employees, getOfficeProfile, loadLedgerLines, type Firm } from '@wise/db';
import { db } from './db';
import type { FirmOfficeSettings } from './office';

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
