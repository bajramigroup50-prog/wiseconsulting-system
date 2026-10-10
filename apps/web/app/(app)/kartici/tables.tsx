/** Card tables shared by the screen and the print views (legacy `kcTable` 6435, `kcSynHTML` 6480). */
import Link from 'next/link';
import type { KontoCard, syntheticCard } from '@wise/core/finance';
import { dmy, fmt } from '@/lib/fmt';
import { lineText } from '@/lib/finance';

type Card = KontoCard;

/** Legacy `kcTable` 6435. */
export function KcTable({ c, links }: { c: Card; links?: boolean }) {
  const td = new Date().toISOString().slice(0, 10);
  return (
    <table>
      <thead><tr><th>Датум</th><th>Налог</th><th>Документ / опис</th><th>Валута</th><th className="n">Должи</th><th className="n">Побарува</th><th className="n">Салдо</th></tr></thead>
      <tbody>
        {c.o ? <tr><td /><td /><td><i>Почетно салдо</i></td><td /><td className="n">{c.o > 0 ? fmt(c.o) : ''}</td><td className="n">{c.o < 0 ? fmt(-c.o) : ''}</td><td className="n">{fmt(c.o)}</td></tr> : null}
        {c.rows.map((r, i) => (
          <tr key={i}>
            <td>{dmy(r.line.date)}</td>
            <td>{links ? <Link className="btn sm ghost" href={`/nalozi?n=${encodeURIComponent(r.line.number ?? '')}`}>{r.line.number}</Link> : r.line.number}</td>
            <td>{lineText(r.line)}</td>
            <td>{r.line.due ? dmy(r.line.due) : ''}{links && r.line.due && r.line.due < td && r.line.debit ? <> <span className="pill bad">доспеано</span></> : null}</td>
            <td className="n">{r.line.debit ? fmt(r.line.debit) : ''}</td><td className="n">{r.line.credit ? fmt(r.line.credit) : ''}</td><td className="n">{fmt(r.s)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot><tr><td colSpan={4}>Вкупно {c.k}</td><td className="n">{fmt(c.td + (c.o > 0 ? c.o : 0))}</td><td className="n">{fmt(c.tp + (c.o < 0 ? -c.o : 0))}</td><td className="n">{fmt(c.end)}</td></tr></tfoot>
    </table>
  );
}

/** Legacy `kcSynHTML` 6480. */
export function SynTable({ C, pname, links }: { C: ReturnType<typeof syntheticCard>; pname: (id: string | null | undefined) => string; links?: boolean }) {
  return (
    <table>
      <thead><tr><th>Датум</th><th>Налог</th><th>Конто</th><th>Документ / опис</th><th>Комитент</th><th className="n">Должи</th><th className="n">Побарува</th><th className="n">Салдо</th></tr></thead>
      <tbody>
        {C.o ? <tr><td /><td /><td /><td><i>Почетно салдо</i></td><td /><td className="n">{C.o > 0 ? fmt(C.o) : ''}</td><td className="n">{C.o < 0 ? fmt(-C.o) : ''}</td><td className="n">{fmt(C.o)}</td></tr> : null}
        {C.rows.map((r, i) => (
          <tr key={i}><td>{dmy(r.line.date)}</td>
            <td>{links ? <Link className="btn sm ghost" href={`/nalozi?n=${encodeURIComponent(r.line.number ?? '')}`}>{r.line.number}</Link> : r.line.number}</td>
            <td>{r.line.account}</td><td>{lineText(r.line)}</td><td>{pname(r.line.partnerId)}</td>
            <td className="n">{r.line.debit ? fmt(r.line.debit) : ''}</td><td className="n">{r.line.credit ? fmt(r.line.credit) : ''}</td><td className="n">{fmt(r.s)}</td></tr>
        ))}
      </tbody>
      <tfoot><tr><td colSpan={5}>Вкупно</td><td className="n">{fmt(C.td + (C.o > 0 ? C.o : 0))}</td><td className="n">{fmt(C.tp + (C.o < 0 ? -C.o : 0))}</td><td className="n">{fmt(C.end)}</td></tr></tfoot>
    </table>
  );
}

