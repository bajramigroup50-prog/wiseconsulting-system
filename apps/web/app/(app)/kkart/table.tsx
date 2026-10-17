/** Legacy `kkTable` 12823 (screen and PDF) — the account card table with the old program's columns. */
import Link from 'next/link';
import { dmy, fmt } from '@/lib/fmt';
import type { kkData } from './data';

type D = Awaited<ReturnType<typeof kkData>>;
const sd = (s: number) => (s >= 0 ? [fmt(s), fmt(0)] : [fmt(0), fmt(-s)]);

/** Saldo in one column: the amount with Д (должи) / П (побарува), as the old program's two saldo columns read. */
const SaldoDP = ({ s }: { s: number }) => (Math.abs(s) < 0.005 ? <>{fmt(0)}</> : <>{fmt(Math.abs(s))}<span className="dp">{s > 0 ? 'Д' : 'П'}</span></>);

/**
 * Screen table that fits a laptop screen (≥1280px) without horizontal scrolling: налог + р.бр. in one cell, датум книж. with the
 * nalog date under it only when it differs, калк. under the content, one saldo column with Д / П, partner and note wrap, and the
 * note / partner / валута columns only when some row has them. The PDF (`pdf`) and Excel (`kkRows`) keep all 14 legacy columns.
 */
function KkFit({ d }: { d: D }) {
  const { X, sub, from } = d;
  const E = X.rows.map((r) => d.ext(r.line));
  const note = (r: (typeof X.rows)[number]) => (r.line.note && r.line.note !== r.line.description ? r.line.note : '').slice(0, 120);
  const hasNote = X.rows.some((r) => note(r));
  const hasPartner = E.some((e) => e.partner);
  const hasDue = E.some((e) => e.due);
  const lead = 3 + (sub ? 1 : 0); // налог · датум · содржина (· конто)
  const tail = (hasNote ? 1 : 0) + (hasPartner ? 1 : 0) + (hasDue ? 1 : 0);
  const end = X.closing;
  return (
    <table className="dense kkt fit">
      <thead><tr>
        <th title="Налог / реден број на ставката во налогот">Налог / р.бр.</th><th>Датум книж. <span style={{ fontWeight: 400 }}>(налог)</span></th>
        <th>Содржина / фак. бр. · докум. / калк.</th>{sub && <th>Конто</th>}
        <th className="n">Должи</th><th className="n">Побарува</th><th className="n" title="Салдо: Д = должи, П = побарува">Салдо Д / П</th>
        {hasNote && <th>Забелешка</th>}{hasPartner && <th>Комитент</th>}{hasDue && <th>Датум на валута</th>}
      </tr></thead>
      <tbody>
        <tr><td /><td style={{ whiteSpace: 'nowrap' }}>{dmy(from)}</td><td><i>ПОЧЕТНО САЛДО / ПРЕНОС</i></td>{sub && <td />}
          <td className="n">{X.opening > 0 ? fmt(X.opening) : ''}</td><td className="n">{X.opening < 0 ? fmt(-X.opening) : ''}</td>
          <td className="n"><SaldoDP s={X.opening} /></td>{tail > 0 && <td colSpan={tail} />}</tr>
        {X.rows.map((r, i) => {
          const e = E[i]!;
          const ld = dmy(r.line.date), nd = e.nd ? dmy(e.nd) : '';
          return (
            <tr key={i}>
              <td style={{ whiteSpace: 'nowrap' }}><Link href={`/nalozi?n=${encodeURIComponent(r.line.number ?? '')}`} title="Отвори го налогот"><b>{r.line.number}</b></Link>{e.rb !== '' && <span className="mini"> / {e.rb}</span>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{ld}{nd && nd !== ld && <span className="sub2" title="Датум на налогот">нал. {nd}</span>}</td>
              <td className="w"><b>{e.sod}</b>{e.calc && <span className="sub2">калк. {e.calc}</span>}</td>{sub && <td>{r.line.account}</td>}
              <td className="n">{fmt(r.line.debit)}</td><td className="n">{fmt(r.line.credit)}</td><td className="n"><SaldoDP s={r.balance} /></td>
              {hasNote && <td className="w" style={{ maxWidth: 220 }}><small>{note(r)}</small></td>}
              {hasPartner && <td className="w" style={{ maxWidth: 230 }}>{e.partner}</td>}
              {hasDue && <td style={{ whiteSpace: 'nowrap' }}>{e.due ? dmy(e.due) : ''}</td>}
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr><td colSpan={lead}>Промет во периодот</td><td className="n">{fmt(X.debit)}</td><td className="n">{fmt(X.credit)}</td><td colSpan={1 + tail} /></tr>
        <tr><td colSpan={lead}>Вкупно со почетно салдо · <b>салдо {end >= 0 ? '(должи)' : '(побарува)'}</b></td>
          <td className="n">{fmt(X.debit + (X.opening > 0 ? X.opening : 0))}</td><td className="n">{fmt(X.credit + (X.opening < 0 ? -X.opening : 0))}</td>
          <td className="n"><b><SaldoDP s={end} /></b></td>{tail > 0 && <td colSpan={tail} />}</tr>
      </tfoot>
    </table>
  );
}

export function KkTable({ d, pdf }: { d: D; pdf?: boolean }) {
  if (!pdf) return <KkFit d={d} />;
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
