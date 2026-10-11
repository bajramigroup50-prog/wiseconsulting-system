/**
 * Заклучен лист (legacy `zlHTML` 8238, `ACT.zlPdf`): analytic trial balance of the whole year before the closing
 * entries, 14 columns — Почетна состојба, Промет, Вкупен промет, Салдо (Д/П), Биланс на состојба (Актива / Пасива for
 * classes other than 4/5/7/8), Биланс на успех (Расходи / Приходи for 4/5/7/8), class totals, ВКУПНО and the result.
 */
import { Fragment } from 'react';
import { CLS, trialBalance, type TbRow } from '@wise/core';
import { effectiveChart } from '@wise/db';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { aggregatedLines } from '@/lib/ledger-agg';
import { FirmHead, Sig } from '../../firm-head';
import { printGuard } from '../../guard';

export const metadata = { title: 'Заклучен лист' };

const CSS = '@page{size:A4 landscape}.pdfdoc table.zl{table-layout:fixed;width:100%}.pdfdoc table.zl td,.pdfdoc table.zl th{font-size:6.3pt!important;padding:1.5px 2px!important;font-family:Arial,Helvetica,sans-serif!important;word-break:break-word}.pdfdoc table.zl td.n{white-space:nowrap}';
const F = ['od', 'op', 'td', 'tp', 'vd', 'vp'] as const;
const bu = (k: string) => /^[4578]/.test(k);
const sd = (r: Pick<TbRow, 's'>) => (r.s > 0 ? r.s : 0), sp = (r: Pick<TbRow, 's'>) => (r.s < 0 ? -r.s : 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

export default async function PrintZl() {
  const { firm, year } = await printGuard('bilanc');
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const [lines, chart] = await Promise.all([aggregatedLines(firm.id, from, to), effectiveChart(db(), firm.id)]);
  const names = new Map(chart.map((a) => [a.code, a.name]));
  const R = trialBalance(lines, { level: 'a', from, to, withClose: false, accountName: (k) => names.get(k) }).rows;
  const c = (v: number) => <td className="n">{v ? fmt(v) : ''}</td>;
  const tot = (rows: TbRow[], label: string, cls: string) => {
    const t = (f: (r: TbRow) => number) => r2(rows.reduce((a, r) => a + f(r), 0));
    return (
      <tr className={cls}><td colSpan={2}>{label}</td>{F.map((f) => <td className="n" key={f}>{fmt(t((r) => r[f]))}</td>)}
        <td className="n">{fmt(t(sd))}</td><td className="n">{fmt(t(sp))}</td>
        <td className="n">{fmt(t((r) => (bu(r.k) ? 0 : sd(r))))}</td><td className="n">{fmt(t((r) => (bu(r.k) ? 0 : sp(r))))}</td>
        <td className="n">{fmt(t((r) => (bu(r.k) ? sd(r) : 0)))}</td><td className="n">{fmt(t((r) => (bu(r.k) ? sp(r) : 0)))}</td></tr>
    );
  };
  const rd = r2(R.reduce((a, r) => a + (bu(r.k) ? sd(r) : 0), 0)), rp = r2(R.reduce((a, r) => a + (bu(r.k) ? sp(r) : 0), 0)), res = r2(rp - rd);
  return (
    <div className="pdfdoc land">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <FirmHead firm={firm} title="ЗАКЛУЧЕН ЛИСТ" sub={`Година ${year} · состојба пред заклучни книжења`} />
      <table className="dense zl">
        <colgroup><col style={{ width: '5%' }} /><col style={{ width: '17%' }} />{Array.from({ length: 12 }, (_, i) => <col key={i} style={{ width: '6.5%' }} />)}</colgroup>
        <thead>
          <tr><th rowSpan={2}>Конто</th><th rowSpan={2}>Назив</th>{['Почетна состојба', 'Промет', 'Вкупен промет', 'Салдо', 'Биланс на состојба', 'Биланс на успех'].map((t) => <th key={t} colSpan={2} style={{ textAlign: 'center' }}>{t}</th>)}</tr>
          <tr>{['Должи', 'Побарува', 'Должи', 'Побарува', 'Должи', 'Побарува', 'Должи', 'Побарува', 'Актива', 'Пасива', 'Расходи', 'Приходи'].map((t, i) => <th key={i} className="n">{t}</th>)}</tr>
        </thead>
        <tbody>
          {[...new Set(R.map((r) => r.k[0]!))].map((k) => {
            const rows = R.filter((r) => r.k[0] === k);
            return (
              <Fragment key={k}>
                <tr className="sub"><td colSpan={14}>Класа {CLS[+k as 0] ?? k}</td></tr>
                {rows.map((r) => (
                  <tr key={r.k}><td>{r.k}</td><td>{r.name}</td>{F.map((f) => <Fragment key={f}>{c(r[f])}</Fragment>)}{c(sd(r))}{c(sp(r))}
                    {bu(r.k) ? <>{c(0)}{c(0)}{c(sd(r))}{c(sp(r))}</> : <>{c(sd(r))}{c(sp(r))}{c(0)}{c(0)}</>}</tr>
                ))}
                {tot(rows, 'Вкупно класа ' + k, 'tot')}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>{tot(R, 'ВКУПНО', '')}</tfoot>
      </table>
      <p style={{ marginTop: 8 }}><b>Финансиски резултат {year}:</b> {res >= 0 ? 'добивка' : 'загуба'} {fmt(Math.abs(res))} ден. (приходи {fmt(rp)} − расходи {fmt(rd)})</p>
      <Sig />
    </div>
  );
}
