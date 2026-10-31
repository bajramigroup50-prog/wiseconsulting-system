/**
 * „Усогласување банка“ (📊 Извештаи): per bank account and month the closing saldo of the last statement against the
 * ledger saldo of its konto, the difference, the last statement and the breaks between statements (`bankRecon`).
 */
import Link from 'next/link';
import { and, eq, sql } from 'drizzle-orm';
import { bankAccounts, bankStatements } from '@wise/db';
import { MON } from '@wise/core/firms/dash';
import { bankRecon } from '@wise/core/firms/reports';
import { booksPage } from '@/lib/books';
import { acctMonths } from '@/lib/dash';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';

export const metadata = { title: 'Усогласување банка' };

export default async function BankReconPage() {
  const { firm, year } = await booksPage('izvestai');
  if (!firm) return <NoFirm t="Усогласување банка" />;
  const [A, S, L] = await Promise.all([
    db().select({ id: bankAccounts.id, name: bankAccounts.name, konto: bankAccounts.konto, cur: bankAccounts.cur }).from(bankAccounts).where(and(eq(bankAccounts.firmId, firm.id), eq(bankAccounts.active, true))),
    db().select({ acct: bankStatements.bankAccountId, date: bankStatements.date, number: bankStatements.number, opening: bankStatements.opening, closing: bankStatements.closing })
      .from(bankStatements).where(and(eq(bankStatements.firmId, firm.id), sql`${bankStatements.date} between ${`${year}-01-01`} and ${`${year}-12-31`}`)),
    acctMonths(firm.id, year),
  ]);
  const num = (v: string | null) => (v == null ? null : Number(v));
  const R = bankRecon(A.filter((a) => a.cur === 'MKD'), S.map((s) => ({ ...s, opening: num(s.opening), closing: num(s.closing) })), L, year);
  return (
    <>
      <Hd t="Усогласување банка" sub={`${year} · салдо на изводот наспроти салдото на контото`} />
      <div className="card row" style={{ gap: 8 }}><Link className="btn sm ghost" href="/izvestai">← Сите извештаи</Link>
        <span className="mini mut">Разлика ≠ 0: недостасува извод, извод не е прокнижен или има рачно книжење на банкарското конто. Денарски сметки.</span></div>
      {R.length ? R.map((r) => (
        <section key={r.acct.id} className="card">
          <h2 style={{ margin: '0 0 6px' }}>{r.acct.name} · конто <Link href={`/kkart?k=${r.acct.konto}`}>{r.acct.konto}</Link>
            <span className="mini mut" style={{ marginLeft: 8 }}>последен извод: {r.last ? dmy(r.last) : 'нема'}</span></h2>
          <div className="tw"><table className="dense">
            <thead><tr><th /> {MON.map((m) => <th key={m} className="n">{m}</th>)}</tr></thead>
            <tbody>
              <tr><td className="mini">според извод</td>{r.months.map((m, i) => <td key={i} className="n" title={m.izvDate ? 'извод од ' + dmy(m.izvDate) : 'нема извод'}>{m.izv == null ? <span className="mut">—</span> : fmt(m.izv)}</td>)}</tr>
              <tr><td className="mini">според контото</td>{r.months.map((m, i) => <td key={i} className="n">{fmt(m.book)}</td>)}</tr>
              <tr><td className="mini"><b>разлика</b></td>{r.months.map((m, i) => <td key={i} className="n" style={m.diff ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{m.diff == null ? '' : m.diff ? fmt(m.diff) : '✓'}</td>)}</tr>
            </tbody>
          </table></div>
          {r.breaks.length > 0 && (
            <div className="callout warn" style={{ marginTop: 6 }}>Прекин меѓу изводите (почетното салдо не е крајното на претходниот – недостасува извод):{' '}
              {r.breaks.map((b) => `${dmy(b.date)}${b.number ? ' бр. ' + b.number : ''} (${fmt(b.diff)})`).join('; ')}</div>
          )}
        </section>
      )) : <div className="card empty">Фирмата нема денарска банкарска сметка.</div>}
    </>
  );
}
