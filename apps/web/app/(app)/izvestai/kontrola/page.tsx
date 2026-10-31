/**
 * „Контролен извештај за месецот“ (📊 Извештаи): what is missing or wrong in the selected firm – statements up to the end
 * of last month, unposted statements and unbooked lines, draft invoices, kontos with an impossible saldo (bank / cash in
 * minus, 2349, transit kontos, 1200 / 2200 on the wrong side), payroll months not booked (`monthlyControl`) – and the
 * open findings of the autopilot.
 */
import Link from 'next/link';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { autopilotFindings, bankAccounts, bankLines, bankStatements, invoices, journals, lineProblem, purchases } from '@wise/db';
import { monthlyControl } from '@wise/core/firms/reports';
import { booksPage } from '@/lib/books';
import { acctMonths } from '@/lib/dash';
import { db } from '@/lib/db';
import { today } from '@/lib/office';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';

export const metadata = { title: 'Контролен извештај' };

const ICON = { bad: '⛔', warn: '⚠️', ok: '✅' } as const;

export default async function ControlPage() {
  const { firm, year } = await booksPage('izvestai');
  if (!firm) return <NoFirm t="Контролен извештај" />;
  const inYear = (c: Parameters<typeof sql>[1]) => sql`${c} between ${`${year}-01-01`} and ${`${year}-12-31`}`;
  const [A, S, BL, inv, pur, pay, L, F] = await Promise.all([
    db().select({ id: bankAccounts.id, name: bankAccounts.name, konto: bankAccounts.konto, cur: bankAccounts.cur }).from(bankAccounts).where(and(eq(bankAccounts.firmId, firm.id), eq(bankAccounts.active, true))),
    db().select({ acct: bankStatements.bankAccountId, date: bankStatements.date, status: bankStatements.status }).from(bankStatements).where(and(eq(bankStatements.firmId, firm.id), inYear(bankStatements.date))),
    db().select().from(bankLines).where(and(eq(bankLines.firmId, firm.id), inYear(bankLines.date))),
    db().select({ n: sql<number>`count(*)::int` }).from(invoices).where(and(eq(invoices.firmId, firm.id), inArray(invoices.status, ['draft', 'pending']), inYear(invoices.date))),
    db().select({ n: sql<number>`count(*)::int` }).from(purchases).where(and(eq(purchases.firmId, firm.id), inArray(purchases.status, ['draft', 'pending']), inYear(purchases.date))),
    db().selectDistinct({ m: sql<number>`extract(month from ${journals.date})::int` }).from(journals).where(and(eq(journals.firmId, firm.id), inArray(journals.sourceType, ['payroll', 'mpin-ack']), inYear(journals.date))),
    acctMonths(firm.id, year),
    db().select({ lvl: autopilotFindings.lvl, cat: autopilotFindings.cat, txt: autopilotFindings.txt, go: autopilotFindings.go }).from(autopilotFindings)
      .where(and(eq(autopilotFindings.firmId, firm.id), isNull(autopilotFindings.resolvedAt))),
  ]);
  const saldo = new Map<string, number>();
  for (const l of L) saldo.set(l.account, Math.round(((saldo.get(l.account) ?? 0) + l.debit - l.credit) * 100) / 100);
  // the synthetic totals the checks read (1200 / 2200 over their analytics)
  for (const k of ['1200', '2200']) saldo.set(k, Math.round(L.filter((l) => l.account.startsWith(k)).reduce((s, l) => s + l.debit - l.credit, 0) * 100) / 100);
  const mkd = new Set(A.filter((a) => a.cur === 'MKD').map((a) => a.id));
  const lastOf = (id: string) => S.filter((s) => s.acct === id).map((s) => s.date).sort().at(-1) ?? null;
  const C = monthlyControl({
    today: today(), year,
    banks: A.filter((a) => a.cur === 'MKD').map((a) => ({ name: a.name, konto: a.konto, last: lastOf(a.id) })),
    draftStatements: S.filter((s) => s.status !== 'posted').length,
    openBankLines: BL.filter((l) => mkd.has(l.bankAccountId) && lineProblem(l, false) !== '').length,
    draftDocs: (inv[0]?.n ?? 0) + (pur[0]?.n ?? 0),
    saldo, payrollMonths: new Set(pay.map((p) => p.m)),
  });
  const bad = C.filter((c) => c.lvl === 'bad').length + F.filter((f) => f.lvl === 'bad').length;
  const warn = C.filter((c) => c.lvl === 'warn').length + F.filter((f) => f.lvl !== 'bad').length;
  const row = (k: string, lvl: string, cat: string, txt: string, go?: string | null) => (
    <tr key={k}><td style={{ width: 28 }}>{ICON[lvl as keyof typeof ICON] ?? '⚠️'}</td><td className="mini" style={{ whiteSpace: 'nowrap' }}>{cat}</td>
      <td>{txt}</td><td>{go ? <Link className="btn sm" href={'/' + go.replace(/^\//, '')}>Отвори →</Link> : null}</td></tr>
  );
  return (
    <>
      <Hd t="Контролен извештај" sub={`${firm.name} · ${year}`} />
      <div className="card row" style={{ gap: 10, alignItems: 'center' }}><Link className="btn sm ghost" href="/izvestai">← Сите извештаи</Link>
        {bad ? <span className="pill bad">⛔ {bad} за поправка</span> : null}{warn ? <span className="pill warn">⚠️ {warn} за проверка</span> : null}
        {!bad && !warn && <span className="pill good">✅ Сè е во ред</span>}</div>
      <div className="card"><h2 style={{ margin: '0 0 6px' }}>Проверки на книгите</h2>
        <div className="tw"><table className="dense"><tbody>{C.map((c, i) => row('c' + i, c.lvl, c.cat, c.txt, c.go))}</tbody></table></div></div>
      {F.length > 0 && (
        <div className="card"><h2 style={{ margin: '0 0 6px' }}>🤖 Наоди на автопилотот</h2>
          <div className="tw"><table className="dense"><tbody>{F.sort((a, b) => (a.lvl === 'bad' ? -1 : 0) - (b.lvl === 'bad' ? -1 : 0)).map((f, i) => row('f' + i, f.lvl === 'bad' ? 'bad' : 'warn', f.cat, f.txt, f.go))}</tbody></table></div></div>
      )}
    </>
  );
}
