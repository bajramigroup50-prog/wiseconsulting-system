/**
 * 💱 Курсни разлики – усогласување на девизните сметки со средниот курс на НБРМ на крајот на месецот (МСС 21).
 * For the chosen date: balance in currency (statements) × middle rate vs. the konto balance in denars → one journal
 * Д девизна сметка / П 7810 or Д 4810 / П девизна сметка (`@wise/db` `fxRevalPreview` / `postFxReval`).
 */
import Link from 'next/link';
import { monthEnd } from '@wise/core/fx-reval';
import { fxRevalList, fxRevalPreview } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { isDate, today } from '@/lib/finance';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { fxRevalAction, fxRevalUndoAction } from './actions';

/** Default date: the end of the previous month (the current month once it is over). */
const defDate = (td: string) => {
  const end = monthEnd(td.slice(0, 7));
  if (td === end) return end;
  const [y, m] = td.split('-').map(Number) as [number, number];
  return monthEnd(m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`);
};

export default async function KursRazPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('kursRaz');
  if (!firm) return <NoFirm t="Курсни разлики" />;
  const td = today();
  const date = isDate(sp.d) ? sp.d : defDate(td);
  const [p, done] = await db().transaction(async (tx) => [await fxRevalPreview(tx, firm.id, date), await fxRevalList(tx, firm.id, year)] as const);
  const write = canDo(u, 'fxReval', firm.id);
  const del = canDo(u, 'nalDel', firm.id);
  const ends = Array.from({ length: 14 }, (_, i) => {
    const [y, m] = td.split('-').map(Number) as [number, number];
    const t = y * 12 + (m - 1) - i;
    return monthEnd(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`);
  }).filter((d) => d <= td || d === monthEnd(td.slice(0, 7)));
  const toBook = p.rows.filter((r) => r.diff).length;
  return (
    <>
      <Hd t="💱 Курсни разлики" sub="девизни сметки по среден курс на НБРМ" excel={false} />
      <form className="card row" style={{ gap: '6px 12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <label>На ден <input type="date" name="d" defaultValue={date} required /></label>
        <button className="btn">↻ Пресметај</button>
        <span className="mini">{ends.slice(0, 6).map((d) => <Link key={d} className="btn sm ghost" href={`/kursRaz?d=${d}`}>{dmy(d)}</Link>)}</span>
      </form>
      <p className="note">Девизните сметки се водат во денари по курсот на денот на секоја уплата/исплата. На крајот на месецот (најмалку на 31.12) салдото во валута се усогласува со <b>средниот курс на НБРМ</b> (МСС 21): разликата се книжи на <b>{p.konta.gain}</b> (позитивни) или <b>{p.konta.loss}</b> (негативни курсни разлики). Салдото во валута е од изводите (почетно салдо + промени), курсот од <Link href="/kursna">Курсна листа</Link>. Може да се пресметува повторно колку што треба – налогот за истиот датум се заменува, не се дуплира.</p>
      {p.noOpening && <div className="callout warn">⚠ За {date.slice(0, 4)} нема почетна состојба, а {Number(date.slice(0, 4)) - 1} има книжења: денарското салдо на сметките може да е нецелосно. Прво пренесете ги салдата (<Link href="/prenos">Пренос на салда</Link>).</div>}
      {p.closed && <div className="callout bad">Годината {date.slice(0, 4)} е затворена – курсните разлики не може да се книжат додека не се поништи затворањето.</div>}
      {p.rows.length ? (
        <div className="tw" id="finArea"><table>
          <thead><tr><th>Конто</th><th>Сметка</th><th>Валута</th><th className="n">Салдо во валута</th><th className="n">Среден курс</th><th className="n">Треба (ден.)</th><th className="n">Во книгите пред усогласување</th><th className="n">Курсна разлика</th></tr></thead>
          <tbody>{p.rows.map((r) => (
            <tr key={r.konto}>
              <td><b>{r.konto}</b></td><td>{r.name}{r.skip && <div className="mini" style={{ color: 'var(--bad)' }}>{r.skip}</div>}</td><td>{r.cur}</td>
              <td className="n">{r.balCur == null ? '—' : fmt(r.balCur)}</td><td className="n">{r.rate ? r.rate.toFixed(4) : '—'}</td>
              <td className="n">{r.skip || r.balCur == null ? '—' : fmt(r.target)}</td><td className="n">{fmt(r.balMkd)}</td>
              <td className="n">{r.diff ? <b style={{ color: r.diff > 0 ? 'var(--good)' : 'var(--bad)' }}>{r.diff > 0 ? '+' : ''}{fmt(r.diff)}</b> : <span className="mut">—</span>}</td>
            </tr>
          ))}</tbody>
          <tfoot>
            <tr><td colSpan={7}>Позитивни курсни разлики ({p.konta.gain})</td><td className="n">{fmt(p.gain)}</td></tr>
            <tr><td colSpan={7}>Негативни курсни разлики ({p.konta.loss})</td><td className="n">{fmt(p.loss)}</td></tr>
          </tfoot>
        </table></div>
      ) : <div className="card empty">Фирмата нема девизни сметки. Девизна сметка се отвора во <Link href="/banke">Банки</Link> (валута EUR, USD…).</div>}
      <div className="row" style={{ gap: 8, margin: '10px 0' }}>
        {p.upToDate && <span className="pill good">✓ Книжено (налог {p.posted!.number}) – салдата се по средниот курс</span>}
        {p.posted && !p.upToDate && <span className="pill warn">⚠ Налогот {p.posted.number} е книжен со други износи (позитивни {fmt(p.posted.gain)} · негативни {fmt(p.posted.loss)}) {toBook ? '– пресметајте повторно' : '– сега нема разлика, поништете го'}</span>}
        {write && toBook > 0 && !p.upToDate && !p.closed && (
          <RowAction className="btn pri" action={fxRevalAction.bind(null, date)} inline
            label={p.posted ? `Пресметај и книжи повторно (налог ${p.posted.number})` : `Книжи курсни разлики на ${dmy(date)}`}
            confirm={`Да се книжи налог за курсни разлики на ${dmy(date)}?\n\nПозитивни (${p.konta.gain}): ${fmt(p.gain)} ден.\nНегативни (${p.konta.loss}): ${fmt(p.loss)} ден.${p.posted ? `\n\nПостојниот налог ${p.posted.number} ќе биде заменет.` : ''}`} />
        )}
        {p.posted && del && !p.closed && <RowAction className="btn danger" action={fxRevalUndoAction.bind(null, date)} label="Поништи" confirm={`Да се избрише налогот ${p.posted.number} за курсни разлики на ${dmy(date)}?`} inline />}
      </div>
      <p className="note">Побарувањата и обврските во валута (1210, 2210, кредити) засега се усогласуваат рачно – во налозите плаќањата кон партнерите не го носат износот во валута, па салдото во валута не може сигурно да се пресмета.</p>
      {done.length > 0 && (
        <div className="card"><h2>Книжени курсни разлики {year}</h2>
          <div className="tw"><table className="dense">
            <thead><tr><th>Датум</th><th>Налог</th><th className="n">Позитивни</th><th className="n">Негативни</th><th /></tr></thead>
            <tbody>{done.map((j) => (
              <tr key={j.id}><td>{dmy(j.date)}</td><td>{j.number}</td><td className="n">{fmt(j.gain)}</td><td className="n">{fmt(j.loss)}</td>
                <td><Link className="btn sm ghost" href={`/kursRaz?d=${j.date}`}>Отвори</Link></td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
    </>
  );
}
