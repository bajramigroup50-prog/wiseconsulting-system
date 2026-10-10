/** Legacy `VIEWS.bilanc` 6665 (+ 12036, 13681) — Финансово › Бруто биланс; table = `bbTable` 6655. */
import Link from 'next/link';
import { Fragment } from 'react';
import { BB_LEVELS, CLS, tbTotal, trialBalance, type BbLevel, type TbRow } from '@wise/core';
import { effectiveChart } from '@wise/db';
import { booksPage, canDo, inYearOr, partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { aggregatedLines } from '@/lib/ledger-agg';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { DownloadCsv } from '@/components/download-csv';
import { ActionForm } from '@/components/action-form';
import { bbAnKOf } from '@/lib/parity-fin';
import { locationNames } from '../poobjekti/data';
import { saveBbAnKAction } from './actions';

type SP = { lvl?: string; from?: string; to?: string; q?: string; p?: string; close?: string; exp?: string; wh?: string };
const F = ['vd', 'vp', 'od', 'op', 'td', 'tp'] as const;

export default async function BilancPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('bilanc');
  if (!firm) return <NoFirm t="Бруто биланс" />;
  const lvl = (BB_LEVELS.some(([v]) => v === sp.lvl) ? sp.lvl : 'a') as BbLevel;
  const from = inYearOr(sp.from, year, `${year}-01-01`), to = inYearOr(sp.to, year, `${year}-12-31`);
  const withClose = sp.close === '1';
  const locs = await locationNames(firm.id);
  // legacy `bb_w` 6665: Објект filter when the firm has more than the main location
  const wh = sp.wh === 'none' || (sp.wh && locs.has(sp.wh)) ? sp.wh : '';
  const [lines, chart, P] = await Promise.all([aggregatedLines(firm.id, from, to, wh), effectiveChart(db(), firm.id), partnerOptions(firm.id)]);
  const names = new Map(chart.map((a) => [a.code, a.name]));
  const pname = new Map(P.map((p) => [p.id, p.name]));
  const pf = sp.p && pname.has(sp.p) ? sp.p : null;
  const tb = trialBalance(lines, { level: lvl, from, to, withClose, partnerId: pf, accountName: (k) => names.get(k) });
  const q = (sp.q ?? '').trim();
  const R = q ? tb.rows.filter((r) => r.k.startsWith(q) || r.name.toLowerCase().includes(q.toLowerCase())) : tb.rows;
  const T = tbTotal(R);
  const withPartners = new Set(lines.filter((l) => l.partnerId).map((l) => l.account));
  const qs = (o: Partial<SP>) => '/bilanc?' + new URLSearchParams(Object.entries({ lvl, from, to, q, p: pf ?? '', close: withClose ? '1' : '', exp: sp.exp ?? '', wh, ...o })
    .filter(([, v]) => v) as [string, string][]).toString();
  const cells = (r: Omit<TbRow, 'k' | 'name'>) => <><td className="n"><b>{fmt(r.s)}</b></td>{F.map((f) => <td className="n" key={f}>{fmt(r[f])}</td>)}</>;
  const expRows = sp.exp && lvl === 'a'
    ? trialBalance(lines, { level: 'a', from, to, withClose, partnerId: pf, byPartnerOf: sp.exp, partnerName: (id) => pname.get(id) }).rows : [];
  const classes = [...new Set(R.map((r) => r.k[0]!))];

  return (
    <>
      <Hd t="Бруто биланс">
        <a className="btn" href={'/print/bilanc?' + new URLSearchParams(Object.entries({ lvl, from, to, q, p: pf ?? '', close: withClose ? '1' : '', wh }).filter(([, v]) => v) as [string, string][]).toString()} target="_blank" rel="noopener">🖨 Печати / PDF</a>
        <a className="btn" href="/print/bilanc/zl" target="_blank" rel="noopener" title="Аналитички бруто биланс за целата година пред заклучните книжења, со биланс на состојба и успех">Заклучен лист (PDF)</a>
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
          {locs.size > 0 && (
            <label className="f">Објект
              <select name="wh" defaultValue={wh}><option value="">Сите</option>{[...locs].map(([id, n]) => <option key={id} value={id}>{n}</option>)}<option value="none">Без објект</option></select>
            </label>
          )}
          <label className="chk"><input type="checkbox" name="close" value="1" defaultChecked={withClose} /> со налогот за затворање</label>
          <button className="btn">Прикажи</button>
          {Math.abs(T.vd - T.vp) < 0.01 ? <span className="pill good">Должи = Побарува</span> : <span className="pill bad">Разлика {fmt(T.vd - T.vp)}</span>}
        </form>
      </div>
      {lvl === 'a' && canDo(u, 'settings', firm.id) && (
        <ActionForm action={saveBbAnKAction} reset={false} className="row" style={{ gap: 8, alignItems: 'center', margin: '6px 0', flexWrap: 'wrap' }}>
          <span className="mini">Во PDF „Аналитики“ по комитенти се печатат контата што почнуваат со:</span>
          <input name="bbAnK" defaultValue={bbAnKOf(firm.settings).join(' ')} style={{ maxWidth: 260 }} />
          <button className="btn sm">Зачувај</button><span className="mini">(на пр. 0 1620 2620 1200 2200 7414)</span>
        </ActionForm>
      )}
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
                          <td>{r.name}{hasP && <> <span className="mini" style={{ color: 'var(--muted)' }}>· по комитенти</span> <Link className="mini" href={`/kkart?k=${r.k}&from=${from}&to=${to}`}>картица</Link> <Link className="mini" href={`/bbPart?k=${r.k}&from=${from}&to=${to}${withClose ? '&close=1' : ''}${pf ? '&p=' + pf : ''}${wh ? '&wh=' + wh : ''}`}>табела по комитенти</Link></>}</td>
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
