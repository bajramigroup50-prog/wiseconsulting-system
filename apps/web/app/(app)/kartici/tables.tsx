/** Card tables shared by the screen and the print views (legacy `kcTable` 6435, `kcSynHTML` 6480). */
import Link from 'next/link';
import type { KontoCard, syntheticCard } from '@wise/core/finance';
import { dmy, fmt, todayIso } from '@/lib/fmt';
import { lineText } from '@/lib/finance';

type Card = KontoCard;

/** Legacy `kcTable` 6435. */
export function KcTable({ c, links, bankHref }: { c: Card; links?: boolean; bankHref?: (l: Card['rows'][number]['line']) => string | undefined }) {
  const td = todayIso();
  // on screen (`links`) the table fits the card next to the partner list: compact, wrapping text, „Валута“ only when some line has one
  const due = !links || c.rows.some((r) => r.line.due);
  return (
    <table className={links ? 'fit' : undefined}>
      <thead><tr><th>Датум</th><th>Налог</th><th>Документ / опис</th>{due && <th>Валута</th>}<th className="n">Должи</th><th className="n">Побарува</th><th className="n">Салдо</th></tr></thead>
      <tbody>
        {c.o ? <tr><td /><td /><td><i>Почетно салдо</i></td>{due && <td />}<td className="n">{c.o > 0 ? fmt(c.o) : ''}</td><td className="n">{c.o < 0 ? fmt(-c.o) : ''}</td><td className="n">{fmt(c.o)}</td></tr> : null}
        {c.rows.map((r, i) => (
          <tr key={i}>
            <td style={{ whiteSpace: 'nowrap' }}>{dmy(r.line.date)}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{links ? (() => {
              // a statement line opens the statement itself (🏦), everything else its nalog
              const b = bankHref?.(r.line);
              return b ? <Link className="btn sm ghost" href={b} title="Отвори го изводот">🏦 {r.line.number}</Link> : <Link className="btn sm ghost" href={`/nalozi?n=${encodeURIComponent(r.line.number ?? '')}`} title="Отвори го налогот">{r.line.number}</Link>;
            })() : r.line.number}</td>
            <td className="w">{lineText(r.line)}</td>
            {due && <td style={{ whiteSpace: 'nowrap' }}>{r.line.due ? dmy(r.line.due) : ''}{links && r.line.due && r.line.due < td && r.line.debit ? <span className="pill bad" style={{ display: 'table', marginTop: 2 }}>доспеано</span> : null}</td>}
            <td className="n">{r.line.debit ? fmt(r.line.debit) : ''}</td><td className="n">{r.line.credit ? fmt(r.line.credit) : ''}</td><td className="n">{fmt(r.s)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot><tr><td colSpan={due ? 4 : 3}>Вкупно {c.k}</td><td className="n">{fmt(c.td + (c.o > 0 ? c.o : 0))}</td><td className="n">{fmt(c.tp + (c.o < 0 ? -c.o : 0))}</td><td className="n">{fmt(c.end)}</td></tr></tfoot>
    </table>
  );
}

/** Legacy `kcSynHTML` 6480. */
export function SynTable({ C, pname, links }: { C: ReturnType<typeof syntheticCard>; pname: (id: string | null | undefined) => string; links?: boolean }) {
  return (
    <table className={links ? 'fit' : undefined}>
      <thead><tr><th>Датум</th><th>Налог</th><th>Конто</th><th>Документ / опис</th><th>Комитент</th><th className="n">Должи</th><th className="n">Побарува</th><th className="n">Салдо</th></tr></thead>
      <tbody>
        {C.o ? <tr><td /><td /><td /><td><i>Почетно салдо</i></td><td /><td className="n">{C.o > 0 ? fmt(C.o) : ''}</td><td className="n">{C.o < 0 ? fmt(-C.o) : ''}</td><td className="n">{fmt(C.o)}</td></tr> : null}
        {C.rows.map((r, i) => (
          <tr key={i}><td style={{ whiteSpace: 'nowrap' }}>{dmy(r.line.date)}</td>
            <td>{links ? <Link className="btn sm ghost" href={`/nalozi?n=${encodeURIComponent(r.line.number ?? '')}`}>{r.line.number}</Link> : r.line.number}</td>
            <td>{r.line.account}</td><td className="w">{lineText(r.line)}</td><td className="w" style={links ? { maxWidth: 240 } : undefined}>{pname(r.line.partnerId)}</td>
            <td className="n">{r.line.debit ? fmt(r.line.debit) : ''}</td><td className="n">{r.line.credit ? fmt(r.line.credit) : ''}</td><td className="n">{fmt(r.s)}</td></tr>
        ))}
      </tbody>
      <tfoot><tr><td colSpan={5}>Вкупно</td><td className="n">{fmt(C.td + (C.o > 0 ? C.o : 0))}</td><td className="n">{fmt(C.tp + (C.o < 0 ? -C.o : 0))}</td><td className="n">{fmt(C.end)}</td></tr></tfoot>
    </table>
  );
}

