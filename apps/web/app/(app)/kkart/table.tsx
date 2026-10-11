/** Legacy `kkTable` 12823 (screen and PDF) — the account card table with the old program's columns. */
import Link from 'next/link';
import { dmy, fmt } from '@/lib/fmt';
import type { kkData } from './data';

type D = Awaited<ReturnType<typeof kkData>>;
const sd = (s: number) => (s >= 0 ? [fmt(s), fmt(0)] : [fmt(0), fmt(-s)]);

export function KkTable({ d, pdf }: { d: D; pdf?: boolean }) {
  const { X, sub, from } = d;
  const o = sd(X.opening);
  const end = X.closing;
  return (
    <table className="dense kkt">
      <thead><tr><th className="n">Р.бр. во налог</th><th style={{ whiteSpace: 'nowrap' }}>Налог</th><th>Налог датум</th><th>Датум книж.</th><th>Содржина / фак. бр.</th><th>Докум. / калк.</th>{sub && <th>Конто</th>}<th className="n">Должи</th><th className="n">Побарува</th><th className="n">Салдо должи</th><th className="n">Салдо побар.</th><th>Забелешка</th><th>Комитент</th><th>Датум на валута</th></tr></thead>
      <tbody>
        <tr><td /><td /><td /><td>{dmy(from)}</td><td><i>ПОЧЕТНО САЛДО / ПРЕНОС</i></td><td />{sub && <td />}
          <td className="n">{X.opening > 0 ? fmt(X.opening) : ''}</td><td className="n">{X.opening < 0 ? fmt(-X.opening) : ''}</td>
          <td className="n">{o[0]}</td><td className="n">{o[1]}</td><td /><td /><td /></tr>
        {X.rows.map((r, i) => {
          const s = sd(r.balance);
          const e = d.ext(r.line);
          return (
            <tr key={i}>
              <td className="n">{e.rb}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{pdf ? r.line.number : <Link className="btn sm ghost" href={`/nalozi?n=${encodeURIComponent(r.line.number ?? '')}`}>{r.line.number}</Link>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{e.nd ? dmy(e.nd) : ''}</td>
              <td>{dmy(r.line.date)}</td><td><b>{e.sod}</b></td><td>{e.calc}</td>{sub && <td>{r.line.account}</td>}
              <td className="n">{fmt(r.line.debit)}</td><td className="n">{fmt(r.line.credit)}</td><td className="n">{s[0]}</td><td className="n">{s[1]}</td>
              <td style={{ maxWidth: 260, whiteSpace: 'normal' }}><small>{(r.line.note && r.line.note !== r.line.description ? r.line.note : '').slice(0, 120)}</small></td>
              <td>{e.partner}</td><td>{e.due ? dmy(e.due) : ''}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr><td colSpan={sub ? 7 : 6}>Промет во периодот</td><td className="n">{fmt(X.debit)}</td><td className="n">{fmt(X.credit)}</td><td colSpan={5} /></tr>
        <tr><td colSpan={sub ? 7 : 6}>Вкупно со почетно салдо · <b>салдо {end >= 0 ? '(должи)' : '(побарува)'}</b></td>
          <td className="n">{fmt(X.debit + (X.opening > 0 ? X.opening : 0))}</td><td className="n">{fmt(X.credit + (X.opening < 0 ? -X.opening : 0))}</td>
          <td className="n"><b>{end >= 0 ? fmt(end) : ''}</b></td><td className="n"><b>{end < 0 ? fmt(-end) : ''}</b></td><td colSpan={3} /></tr>
      </tfoot>
    </table>
  );
}

/** Legacy `kkXlsx` 12828: the same 14 columns. */
export function kkRows(d: D): (string | number)[][] {
  const { X } = d;
  return [
    ['Р.бр. во налог', 'Налог', 'Налог датум', 'Датум книж.', 'Содржина/фак.бр.', 'Докум./калк.', 'Конто', 'Должи', 'Побарува', 'Салдо должи', 'Салдо побар.', 'Забелешка', 'Комитент', 'Датум на валута'],
    ['', '', '', dmy(d.from), 'ПОЧЕТНО САЛДО', '', '', X.opening > 0 ? X.opening : 0, X.opening < 0 ? -X.opening : 0, X.opening > 0 ? X.opening : 0, X.opening < 0 ? -X.opening : 0, '', '', ''],
    ...X.rows.map((r) => {
      const e = d.ext(r.line);
      return [e.rb, r.line.number ?? '', e.nd ? dmy(e.nd) : '', dmy(r.line.date), e.sod, e.calc, r.line.account, r.line.debit, r.line.credit,
        r.balance >= 0 ? r.balance : 0, r.balance < 0 ? -r.balance : 0, r.line.note ?? '', e.partner, e.due ? dmy(e.due) : ''];
    }),
  ];
}
