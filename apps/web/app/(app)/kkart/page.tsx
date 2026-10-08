/** Legacy `VIEWS.kkart` 6686 — Финансово › Аналитичка картица по конто (data `kkData` 6679, table `kkTable` 12823). */
import Link from 'next/link';
import { and, asc, eq, like, sql } from 'drizzle-orm';
import { accountCard, type LedgerLine } from '@wise/core';
import { effectiveChart, journalLines, journals, partners } from '@wise/db';
import { booksPage, inYearOr, partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { DownloadCsv } from '@/components/download-csv';

type SP = { k?: string; sub?: string; p?: string; from?: string; to?: string };

export default async function KkartPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { firm, year } = await booksPage('kkart');
  if (!firm) return <NoFirm t="Аналитичка картица по конто" />;
  const k = /^\d{1,10}$/.test(sp.k ?? '') ? sp.k! : '1020';
  const sub = sp.sub === '1';
  const from = inYearOr(sp.from, year, `${year}-01-01`), to = inYearOr(sp.to, year, `${year}-12-31`);
  const [chart, P] = await Promise.all([effectiveChart(db(), firm.id), partnerOptions(firm.id)]);
  const noPartner = sp.p === 'none';
  const pf = !noPartner && sp.p && P.some((p) => p.id === sp.p) ? sp.p : null;

  const rows = await db().select({
    account: journalLines.account, debit: journalLines.debit, credit: journalLines.credit, partnerId: journalLines.partnerId,
    note: journalLines.note, doc: journalLines.doc, lineNo: journalLines.lineNo,
    date: journals.date, kind: journals.kind, journalId: journals.id, number: journals.number, description: journals.description,
    pcode: partners.code, pname: partners.name,
  }).from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId)).leftJoin(partners, eq(partners.id, journalLines.partnerId))
    .where(and(eq(journalLines.firmId, firm.id), sql`${journals.date} between ${year + '-01-01'} and ${to}`,
      sub ? like(journalLines.account, `${k}%`) : eq(journalLines.account, k)))
    .orderBy(asc(journals.date), asc(journals.createdAt), asc(journals.id), asc(journalLines.lineNo));
  const pinfo = new Map(rows.map((r) => [r.partnerId, r.pname ? (r.pcode ? r.pcode + ' ' : '') + r.pname : '']));
  const L: LedgerLine[] = rows.map((r) => ({ ...r, debit: Number(r.debit), credit: Number(r.credit) }));
  const X = accountCard(L, { account: k, sub, partnerId: pf, noPartner, from, to });
  const sd = (s: number) => (s >= 0 ? [fmt(s), '0.00'] : ['0.00', fmt(-s)]);
  const name = chart.find((a) => a.code === k)?.name ?? '';
  const subT = pf ? ' · ' + (P.find((p) => p.id === pf)?.name ?? '') : noPartner ? ' · без комитент' : '';

  return (
    <>
      <Hd t="Аналитичка картица по конто" sub={`${k} ${name}${subT}`}>
        <Link className="btn" href={`/bilanc?from=${from}&to=${to}`}>← Бруто биланс</Link>
        <DownloadCsv name={`Kartica_${k}_${year}.csv`} label="Excel" rows={[
          ['Р.бр. во налог', 'Налог', 'Датум', 'Содржина', 'Документ', 'Конто', 'Должи', 'Побарува', 'Салдо', 'Забелешка', 'Комитент'],
          ['', '', dmy(from), 'ПОЧЕТНО САЛДО / ПРЕНОС', '', '', X.opening > 0 ? X.opening : 0, X.opening < 0 ? -X.opening : 0, X.opening, '', ''],
          ...X.rows.map((r) => [r.line.lineNo ?? '', r.line.number ?? '', dmy(r.line.date), r.line.description ?? '', r.line.doc ?? '', r.line.account,
            r.line.debit, r.line.credit, r.balance, r.line.note ?? '', pinfo.get(r.line.partnerId ?? null) ?? '']),
        ]} />
      </Hd>
      <form className="card"><div className="row" style={{ gap: 12, alignItems: 'end' }}>
        <label className="f" style={{ width: 260 }}>Конто<input name="k" list="kkL" defaultValue={k} /></label>
        <datalist id="kkL">{chart.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</datalist>
        <label className="chk"><input type="checkbox" name="sub" value="1" defaultChecked={sub} /> со подконта (сите што почнуваат со {k})</label>
        <label className="f">Комитент
          <select name="p" defaultValue={pf ?? (noPartner ? 'none' : '')} style={{ width: 230 }}>
            <option value="">сите</option><option value="none">без комитент</option>
            {P.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="f">Од<input type="date" name="from" defaultValue={from} /></label>
        <label className="f">До<input type="date" name="to" defaultValue={to} /></label>
        <button className="btn pri">Прикажи</button>
      </div></form>
      <div className="tiles">
        <div className="tile"><span className="k">Почетно салдо</span><b className="v num">{fmt(X.opening)}</b></div>
        <div className="tile"><span className="k">Должи</span><b className="v num">{fmt(X.debit)}</b></div>
        <div className="tile"><span className="k">Побарува</span><b className="v num">{fmt(X.credit)}</b></div>
        <div className="tile"><span className="k">Салдо</span><b className="v num">{fmt(X.closing)}</b><i>{X.closing >= 0 ? 'должно салдо' : 'побарувачко салдо'}</i></div>
      </div>
      <div className="tw"><table className="dense kkt">
        <thead><tr><th className="n">Р.бр. во налог</th><th style={{ whiteSpace: 'nowrap' }}>Налог</th><th>Датум книж.</th><th>Содржина / фак. бр.</th><th>Докум.</th>{sub && <th>Конто</th>}<th className="n">Должи</th><th className="n">Побарува</th><th className="n">Салдо должи</th><th className="n">Салдо побар.</th><th>Забелешка</th><th>Комитент</th></tr></thead>
        <tbody>
          <tr><td /><td /><td>{dmy(from)}</td><td><i>ПОЧЕТНО САЛДО / ПРЕНОС</i></td><td />{sub && <td />}
            <td className="n">{X.opening > 0 ? fmt(X.opening) : ''}</td><td className="n">{X.opening < 0 ? fmt(-X.opening) : ''}</td>
            <td className="n">{sd(X.opening)[0]}</td><td className="n">{sd(X.opening)[1]}</td><td /><td /></tr>
          {X.rows.map((r, i) => {
            const s = sd(r.balance);
            return (
              <tr key={i}>
                <td className="n">{r.line.lineNo}</td>
                <td style={{ whiteSpace: 'nowrap' }}><Link className="btn sm ghost" href={`/nalozi?n=${encodeURIComponent(r.line.number ?? '')}`}>{r.line.number}</Link></td>
                <td>{dmy(r.line.date)}</td><td><b>{(r.line.description ?? '').toUpperCase()}</b></td><td>{r.line.doc}</td>{sub && <td>{r.line.account}</td>}
                <td className="n">{fmt(r.line.debit)}</td><td className="n">{fmt(r.line.credit)}</td><td className="n">{s[0]}</td><td className="n">{s[1]}</td>
                <td style={{ maxWidth: 260, whiteSpace: 'normal' }}><small>{(r.line.note ?? '').slice(0, 120)}</small></td>
                <td>{pinfo.get(r.line.partnerId ?? null)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr><td colSpan={sub ? 6 : 5}>Промет во периодот</td><td className="n">{fmt(X.debit)}</td><td className="n">{fmt(X.credit)}</td><td colSpan={4} /></tr>
          <tr><td colSpan={sub ? 6 : 5}>Вкупно со почетно салдо · <b>салдо {X.closing >= 0 ? '(должи)' : '(побарува)'}</b></td>
            <td className="n">{fmt(X.debit + (X.opening > 0 ? X.opening : 0))}</td><td className="n">{fmt(X.credit + (X.opening < 0 ? -X.opening : 0))}</td>
            <td className="n"><b>{X.closing >= 0 ? fmt(X.closing) : ''}</b></td><td className="n"><b>{X.closing < 0 ? fmt(-X.closing) : ''}</b></td><td colSpan={2} /></tr>
        </tfoot>
      </table></div>
    </>
  );
}
