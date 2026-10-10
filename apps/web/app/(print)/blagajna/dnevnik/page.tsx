/** Legacy ACT `blgPdf` (7275): благајнички дневник (cash book) of a register for a period, printed from the browser. */
import { notFound } from 'next/navigation';
import { cashBook, loadRegisters } from '@wise/db';
import { booksPage, inYearOr } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { PrintPage } from '@/components/print-page';

export default async function CashBookPrint({ searchParams }: { searchParams: Promise<{ reg?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const { firm, year } = await booksPage('blagajna');
  if (!firm) notFound();
  const R = await loadRegisters(db(), firm.id);
  const reg = R.find((r) => r.id === sp.reg) ?? R[0];
  if (!reg) notFound();
  const from = inYearOr(sp.from, year, `${year}-01-01`), to = inYearOr(sp.to, year, `${year}-12-31`);
  const X = await db().transaction((tx) => cashBook(tx, firm.id, reg, from, to));
  const fxR = reg.cur !== 'MKD';
  return (
    <PrintPage title={`Благајнички дневник ${reg.konto} ${dmy(from)}–${dmy(to)}`}>
      <div className="pdfdoc">
        <div className="fh"><b>{firm.name}</b>{firm.address ? `, ${firm.address}` : ''}{firm.city ? `, ${firm.city}` : ''}{firm.edb ? ` · ЕДБ ${firm.edb}` : ''}</div>
        <h1>БЛАГАЈНИЧКИ ДНЕВНИК</h1>
        <div>{reg.name} · конто {reg.konto} · {reg.cur} · период {dmy(from)} – {dmy(to)}</div>
        <table className="dense" style={{ width: '100%', marginTop: 8 }}>
          <thead><tr><th>Р.бр.</th><th>Датум</th><th>Налог</th><th>Број</th><th>Документ</th><th>Опис</th><th className="n">Уплата</th><th className="n">Исплата</th><th className="n">Салдо</th>{fxR && <th className="n">Салдо {reg.cur}</th>}</tr></thead>
          <tbody>
            <tr><td></td><td>{dmy(from)}</td><td></td><td></td><td></td><td><i>Почетно салдо</i></td><td className="n">{X.opening > 0 ? fmt(X.opening) : ''}</td><td className="n">{X.opening < 0 ? fmt(-X.opening) : ''}</td><td className="n">{fmt(X.opening)}</td>{fxR && <td className="n">{fmt(X.openingCur)}</td>}</tr>
            {X.rows.map((r, i) => (
              <tr key={i}><td>{i + 1}</td><td>{dmy(r.date)}</td><td>{r.nalog}</td><td>{r.voucher?.number ?? ''}</td><td>{r.doc}</td>
                <td>{r.label}{r.voucher?.country && r.voucher.country !== 'MK' ? ` (${r.voucher.country})` : ''}{r.voucher && r.voucher.cur !== 'MKD' ? ` (${fmt(Number(r.voucher.amt))} ${r.voucher.cur})` : ''}</td>
                <td className="n">{r.debit ? fmt(r.debit) : ''}</td><td className="n">{r.credit ? fmt(r.credit) : ''}</td><td className="n">{fmt(r.balance)}</td>{fxR && <td className="n">{fmt(r.balanceCur)}</td>}</tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={6}><b>Вкупно промет</b></td><td className="n"><b>{fmt(X.debit)}</b></td><td className="n"><b>{fmt(X.credit)}</b></td><td className="n"><b>{fmt(X.closing)}</b></td>{fxR && <td className="n"><b>{fmt(X.closingCur)}</b></td>}</tr></tfoot>
        </table>
        {/* legacy `sig('Благајник','Одговорно лице')` */}
        <div className="sig"><span>Благајник</span><span>Одговорно лице</span></div>
      </div>
    </PrintPage>
  );
}
