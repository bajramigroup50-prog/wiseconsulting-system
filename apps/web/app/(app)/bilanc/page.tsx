/** Legacy `VIEWS.bilanc` 6665 (+ 12036, 13681) — Финансово › Бруто биланс; table = `bbTable` 6655. */
import Link from 'next/link';
import { Fragment } from 'react';
import { BB_LEVELS, CLS, tbTotal, trialBalance, type BbLevel, type TbRow } from '@wise/core';
import { effectiveChart } from '@wise/db';
import { booksPage, inYearOr, partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { aggregatedLines } from '@/lib/ledger-agg';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { DownloadCsv } from '@/components/download-csv';

type SP = { lvl?: string; from?: string; to?: string; q?: string; p?: string; close?: string; exp?: string };
const F = ['vd', 'vp', 'od', 'op', 'td', 'tp'] as const;

export default async function BilancPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { firm, year } = await booksPage('bilanc');
  if (!firm) return <NoFirm t="Бруто биланс" />;
  const lvl = (BB_LEVELS.some(([v]) => v === sp.lvl) ? sp.lvl : 'a') as BbLevel;
  const from = inYearOr(sp.from, year, `${year}-01-01`), to = inYearOr(sp.to, year, `${year}-12-31`);
  const withClose = sp.close === '1';
  const [lines, chart, P] = await Promise.all([aggregatedLines(firm.id, from, to), effectiveChart(db(), firm.id), partnerOptions(firm.id)]);
  const names = new Map(chart.map((a) => [a.code, a.name]));
  const pname = new Map(P.map((p) => [p.id, p.name]));
  const pf = sp.p && pname.has(sp.p) ? sp.p : null;
  const tb = trialBalance(lines, { level: lvl, from, to, withClose, partnerId: pf, accountName: (k) => names.get(k) });
  const q = (sp.q ?? '').trim();
  const R = q ? tb.rows.filter((r) => r.k.startsWith(q) || r.name.toLowerCase().includes(q.toLowerCase())) : tb.rows;
  const T = tbTotal(R);
  const withPartners = new Set(lines.filter((l) => l.partnerId).map((l) => l.account));
  const qs = (o: Partial<SP>) => '/bilanc?' + new URLSearchParams(Object.entries({ lvl, from, to, q, p: pf ?? '', close: withClose ? '1' : '', exp: sp.exp ?? '', ...o })
    .filter(([, v]) => v) as [string, string][]).toString();
  const cells = (r: Omit<TbRow, 'k' | 'name'>) => <><td className="n"><b>{fmt(r.s)}</b></td>{F.map((f) => <td className="n" key={f}>{fmt(r[f])}</td>)}</>;
  const expRows = sp.exp && lvl === 'a'
    ? trialBalance(lines, { level: 'a', from, to, withClose, partnerId: pf, byPartnerOf: sp.exp, partnerName: (id) => pname.get(id) }).rows : [];
  const classes = [...new Set(R.map((r) => r.k[0]!))];

  return (
    <>
      <Hd t="Бруто биланс">
        <a className="btn" href={'/print/bilanc?' + new URLSearchParams(Object.entries({ lvl, from, to, q, p: pf ?? '', close: withClose ? '1' : '' }).filter(([, v]) => v) as [string, string][]).toString()} target="_blank" rel="noopener">🖨 Печати / PDF</a>
        <DownloadCsv name={`Bruto_bilans_${year}.csv`} rows={[['Конто', 'Назив', 'Салдо', 'Вк. должи', 'Вк. побарува', 'Поч. сост. должи', 'Поч. сост. побарува', 'Должи од тек. година', 'Побарува од тек. година'],
          ...R.map((r) => [r.k, r.name, r.s, r.vd, r.vp, r.od, r.op, r.td, r.tp])]} />
      </Hd>
      <div className="card">
        <div className="row" style={{ gap: 6 }}>
          {BB_LEVELS.map(([v, t]) => <Link key={v} className={`btn sm ${v === lvl ? 'pri' : ''}`} href={qs({ lvl: v, exp: '' })}>{t}</Link>)}
        </div>
        <form className="row" style={{ gap: 12, alignItems: 'end' }}>
          <input type="hidden" name="lvl" value={lvl} />
          <label className="f">Од<input type="date" name="from" defaultValue={from} /></label>
          <label className="f">До<input type="date" name="to" defaultValue={to} /></label>
          <label className="f">Конто / назив<input name="q" defaultValue={q} placeholder="на пр. 22 или добавувачи" /></label>
          <label className="f">Комитент
            <select name="p" defaultValue={pf ?? ''} style={{ width: 220 }}>
              <option value="">сите комитенти</option>
              {P.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="chk"><input type="checkbox" name="close" value="1" defaultChecked={withClose} /> со налогот за затворање</label>
          <button className="btn">Прикажи</button>
          {Math.abs(T.vd - T.vp) < 0.01 ? <span className="pill good">Должи = Побарува</span> : <span className="pill bad">Разлика {fmt(T.vd - T.vp)}</span>}
        </form>
      </div>
      {tb.bbimpMixed && <div className="callout warn">Во периодот има и увезен бруто биланс и книжени документи – прометите може да се дуплираат. Проверете ја „Почетна состојба“.</div>}
      {R.length ? (
        <div className="tw"><table>
          <thead><tr><th>Конто</th><th>Назив</th><th className="n">Салдо</th><th className="n">Вк. должи</th><th className="n">Вк. побарува</th><th className="n">Поч. сост. должи</th><th className="n">Поч. сост. побарува</th><th className="n">Должи од тек. година</th><th className="n">Побарува од тек. година</th></tr></thead>
          <tbody>
            {classes.map((c) => {
              const rows = R.filter((r) => r.k[0] === c);
              return (
                <Fragment key={c}>
                  {lvl !== '1' && <tr className="sub"><td colSpan={9}>Класа {CLS[+c as 0]}</td></tr>}
                  {rows.map((r) => {
                    const hasP = lvl === 'a' && withPartners.has(r.k);
                    const open = hasP && sp.exp === r.k;
                    const href = hasP ? qs({ exp: open ? '' : r.k }) : `/kkart?k=${r.k}&sub=${lvl === 'a' ? '' : '1'}&from=${from}&to=${to}${pf ? '&p=' + pf : ''}`;
                    return (
                      <Fragment key={r.k}>
                        <tr className="bbrow">
                          <td><Link href={href}><b style={{ color: 'var(--accent)' }}>{hasP ? (open ? '▾ ' : '▸ ') : ''}{r.k}</b></Link></td>
                          <td>{r.name}{hasP && <> <span className="mini" style={{ color: 'var(--muted)' }}>· по комитенти</span> <Link className="mini" href={`/kkart?k=${r.k}&from=${from}&to=${to}`}>картица</Link> <Link className="mini" href={`/bbPart?k=${r.k}&from=${from}&to=${to}${withClose ? '&close=1' : ''}`}>табела по комитенти</Link></>}</td>
                          {cells(r)}
                        </tr>
                        {open && expRows.map((p) => (
                          <tr key={p.k || '-'} style={{ background: 'var(--accent-soft)' }}>
                            <td />
                            <td style={{ paddingLeft: 22 }}><Link href={`/kkart?k=${r.k}&from=${from}&to=${to}&p=${p.k || 'none'}`}>↳ {p.name}</Link></td>
                            {cells(p)}
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                  {lvl !== '1' && <tr className="tot"><td colSpan={2}>Вкупно класа {c}</td>{cells(tbTotal(rows))}</tr>}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot><tr><td colSpan={2}>ВКУПНО</td>{cells(T)}</tr></tfoot>
        </table></div>
      ) : <div className="card empty">Нема книжења за избраниот период.</div>}
    </>
  );
}
