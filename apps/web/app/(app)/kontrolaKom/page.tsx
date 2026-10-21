/**
 * 🔎 Контрола на комитенти: everything about the partners the office checks itself, for the working firm and year –
 * every line on a partner konto (12…, 22… incl. 2205x honoraria / bonuses) WITHOUT a partner, with the place it was
 * booked (statement line, calculation, invoice, nalog) to fix it in one click; partners named in Latin; likely
 * duplicates; natural persons without ЕМБГ. Lines without a partner are not in the cards, the ИОС or the autopilot's
 * „paid without an invoice“ – so this list should be empty.
 */
import Link from 'next/link';
import { and, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { isLatinName } from '@wise/core/text/cyr';
import { bankLines, invoices, journalLines, journals, partnerDupGroups, partners } from '@wise/db';
import { booksPage } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';

const T = '🔎 Контрола на комитенти';
const SRC: Record<string, string> = { bank_statement: '🏦 Извод', purchase: '📥 Влезна фактура', invoice: '🧾 Излезна фактура', pdd: '👤 Пресметка (бонус / закуп)', cash_voucher: '💶 Благајна', opening: 'Почетна состојба', import: 'Увезен налог', payroll: 'Плата' };

export default async function KontrolaKomPage() {
  const { firm, year } = await booksPage('kontrolaKom');
  if (!firm) return <NoFirm t={T} />;
  const yr = sql`${journals.date} between ${`${year}-01-01`} and ${`${year}-12-31`}`;
  const [L, P, dup] = await Promise.all([
    db().select({ id: journalLines.id, account: journalLines.account, debit: journalLines.debit, credit: journalLines.credit, note: journalLines.note,
      date: journals.date, number: journals.number, kind: journals.kind, src: journals.sourceType, sid: journals.sourceId, desc: journals.description })
      .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
      .where(and(eq(journalLines.firmId, firm.id), isNull(journalLines.partnerId), yr, or(like(journalLines.account, '12%'), like(journalLines.account, '22%'))))
      .orderBy(journalLines.account, journals.date),
    db().select({ id: partners.id, code: partners.code, name: partners.name, edb: partners.edb, data: partners.data }).from(partners).where(eq(partners.firmId, firm.id)),
    partnerDupGroups(db(), firm.id).catch(() => ({ groups: [] as unknown[] })),
  ]);
  // only the partner kontos (120–128, 220–228: 129 / 229 are not per partner)
  const N = L.filter((l) => /^(12[0-8]|22[0-8])/.test(l.account));
  // a statement line: the bank line of that statement with that amount and no partner
  const stIds = [...new Set(N.filter((l) => l.src === 'bank_statement' && l.sid).map((l) => l.sid!))];
  const BL = stIds.length ? await db().select({ id: bankLines.id, st: bankLines.statementId, amount: bankLines.amount, name: bankLines.name }).from(bankLines)
    .where(and(eq(bankLines.firmId, firm.id), inArray(bankLines.statementId, stIds), isNull(bankLines.partnerId))) : [];
  const invIds = N.filter((l) => l.src === 'invoice' && l.sid).map((l) => l.sid!);
  const IK = invIds.length ? await db().select({ id: invoices.id, kind: invoices.kind }).from(invoices).where(inArray(invoices.id, invIds)) : [];
  const INV: Record<string, string> = { invoice: '/izlez', credit: '/odobrenija', proforma: '/profakturi', dispatch: '/ispratnici' };
  const fix = (l: (typeof N)[number]): [string, string] => {
    const amt = Math.abs(Number(l.debit) - Number(l.credit)).toFixed(2);
    if (l.src === 'bank_statement') {
      const b = BL.find((x) => x.st === l.sid && Math.abs(Number(x.amount)).toFixed(2) === amt);
      if (b) return [`/banka?line=${b.id}#bk-line`, `🏦 изберете комитент во изводот${b.name ? ` („${b.name}“)` : ''}`];
    }
    if (l.src === 'pdd' && l.sid) return [`/pdd?ed=${l.sid}`, '👤 изберете го примачот (или „🔗 Поврзи ги примачите“)'];
    if (l.src === 'purchase' && l.sid) return [`/vlez?edit=${l.sid}`, '📥 изберете добавувач во фактурата'];
    if (l.src === 'invoice' && l.sid) return [`${INV[IK.find((x) => x.id === l.sid)?.kind ?? 'invoice'] ?? '/izlez'}?edit=${l.sid}`, '🧾 изберете купувач во фактурата'];
    return [`/nalozi?n=${encodeURIComponent(l.number ?? '')}`, '📒 изберете комитент во налогот (колона „Комитент“)'];
  };
  const byK = new Map<string, typeof N>();
  for (const l of N) byK.set(l.account, [...(byK.get(l.account) ?? []), l]);
  const latin = P.filter((p) => isLatinName(p.name));
  const persons = P.filter((p) => { const d = (p.data ?? {}) as { person?: boolean; embg?: string }; return d.person && !d.embg; });
  const nDup = (dup as { groups: unknown[] }).groups.length;
  const ok = !N.length && !latin.length && !nDup;
  return (
    <>
      <Hd t={T} sub={`${firm.name} · ${year}`} exp={false} />
      <div className={`callout ${ok ? 'good' : 'warn'}`}>{ok ? '✓ Комитентите се во ред: нема ставки без комитент, сите се на кирилица, нема дупликати.' : 'Проверете ги точките подолу – секоја има копче што води до местото каде се поправа.'}</div>

      <div className="tiles">
        <div className="tile"><span>Ставки без комитент (12…, 22…)</span><b style={{ color: N.length ? 'var(--bad)' : undefined }}>{N.length}</b><i>{N.length ? 'не се во картиците и ИОС' : 'нема'}</i></div>
        <div className="tile"><span>Комитенти на латиница</span><b>{latin.length}</b><i>{latin.length ? <Link href="/partneri?cyr=1">🔤 Латиница → кирилица</Link> : 'сите се на кирилица'}</i></div>
        <div className="tile"><span>Можни дупликати</span><b>{nDup}</b><i>{nDup ? <Link href="/partneri?dup=1">👥 Дупликати / ✋ Спои рачно</Link> : 'нема'}</i></div>
        <div className="tile"><span>Физички лица без ЕМБГ</span><b>{persons.length}</b><i>{persons.length ? 'дополнете го ЕМБГ во комитентот' : 'во ред'}</i></div>
      </div>

      {[...byK.entries()].map(([k, R]) => (
        <div className="card" key={k}>
          <h3 style={{ marginTop: 0 }}>Конто {k} · {R.length} {R.length === 1 ? 'ставка' : 'ставки'} без комитент · салдо {fmt(R.reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0))}</h3>
          <div className="tw"><table className="dense">
            <thead><tr><th>Датум</th><th>Налог</th><th>Извор</th><th>Опис</th><th className="n">Должи</th><th className="n">Побарува</th><th>Поправи</th></tr></thead>
            <tbody>{R.map((l) => { const [href, what] = fix(l); return (
              <tr key={l.id}><td>{dmy(l.date)}</td><td>{l.number}</td><td><span className="pill">{SRC[l.src ?? ''] ?? (l.kind === 'manual' ? 'Налог' : l.kind)}</span></td>
                <td className="w">{l.note || l.desc}</td><td className="n">{Number(l.debit) ? fmt(Number(l.debit)) : ''}</td><td className="n">{Number(l.credit) ? fmt(Number(l.credit)) : ''}</td>
                <td><Link className="btn sm" href={href}>{what}</Link></td></tr>
            ); })}</tbody>
          </table></div>
        </div>
      ))}
      {persons.length > 0 && (
        <div className="card"><h3 style={{ marginTop: 0 }}>Физички лица без ЕМБГ</h3>
          {persons.map((p) => <span key={p.id} style={{ marginRight: 12 }}><Link href={`/partneri?edit=${p.id}`}>{p.code ?? ''} {p.name}</Link></span>)}</div>
      )}
      <p className="note">Почетната состојба и налозите увезени од стара програма можат да имаат ставки без комитент – изберете го во налогот. Новите изводи, фактури и пресметки секогаш бараат комитент.</p>
    </>
  );
}
