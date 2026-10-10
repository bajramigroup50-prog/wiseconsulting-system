/** Print view of the trial balance, landscape (legacy `ACT.bilPdf` 7267 → `ph()` + `bbTable(R,lvl,true)` + `sig()`); also a PKG_REP report (`bba`/`bb3`). */
import { Fragment } from 'react';
import { BB_LEVELS, CLS, tbTotal, trialBalance, type BbLevel, type TbRow } from '@wise/core';
import { effectiveChart } from '@wise/db';
import { inYearOr } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { aggregatedLines } from '@/lib/ledger-agg';
import { FirmHead, Sig } from '../firm-head';
import { printGuard } from '../guard';

export const metadata = { title: 'Бруто биланс' };

type SP = { lvl?: string; from?: string; to?: string; q?: string; p?: string; close?: string };
const F = ['vd', 'vp', 'od', 'op', 'td', 'tp'] as const;

export default async function PrintBilanc({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { firm, year } = await printGuard('bilanc');
  const lvl = (BB_LEVELS.some(([v]) => v === sp.lvl) ? sp.lvl : 'a') as BbLevel;
  const lvlName = BB_LEVELS.find(([v]) => v === lvl)![1];
  const from = inYearOr(sp.from, year, `${year}-01-01`), to = inYearOr(sp.to, year, `${year}-12-31`);
  const [lines, chart] = await Promise.all([aggregatedLines(firm.id, from, to), effectiveChart(db(), firm.id)]);
  const names = new Map(chart.map((a) => [a.code, a.name]));
  const pf = sp.p && /^[0-9a-f-]{36}$/i.test(sp.p) ? sp.p : null;
  const tb = trialBalance(lines, { level: lvl, from, to, withClose: sp.close === '1', partnerId: pf, accountName: (k) => names.get(k) });
  const q = (sp.q ?? '').trim();
  const R = q ? tb.rows.filter((r) => r.k.startsWith(q) || r.name.toLowerCase().includes(q.toLowerCase())) : tb.rows;
  const cells = (r: Omit<TbRow, 'k' | 'name'>) => <><td className="n"><b>{fmt(r.s)}</b></td>{F.map((f) => <td className="n" key={f}>{fmt(r[f])}</td>)}</>;
  const classes = [...new Set(R.map((r) => r.k[0]!))];
  return (
    <div className="pdfdoc land">
      <style dangerouslySetInnerHTML={{ __html: '@page{size:A4 landscape}' }} />
      <FirmHead firm={firm} title={`БРУТО БИЛАНС – ${lvlName.toUpperCase()}`} sub={`Период ${dmy(from)} – ${dmy(to)}${q ? ' · филтер: ' + q : ''}`} />
      <table>
        <thead><tr><th>Конто</th><th>Назив</th><th className="n">Салдо</th><th className="n">Вк. должи</th><th className="n">Вк. побарува</th><th className="n">Поч. сост. должи</th><th className="n">Поч. сост. побарува</th><th className="n">Должи од тек. година</th><th className="n">Побарува од тек. година</th></tr></thead>
        <tbody>
          {classes.map((c) => {
            const rows = R.filter((r) => r.k[0] === c);
            return (
              <Fragment key={c}>
                {lvl !== '1' && <tr className="sub"><td colSpan={9}>Класа {CLS[+c as 0]}</td></tr>}
                {rows.map((r) => <tr key={r.k}><td>{r.k}</td><td>{r.name}</td>{cells(r)}</tr>)}
                {lvl !== '1' && <tr className="tot"><td colSpan={2}>Вкупно класа {c}</td>{cells(tbTotal(rows))}</tr>}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot><tr><td colSpan={2}>ВКУПНО</td>{cells(tbTotal(R))}</tr></tfoot>
      </table>
      <Sig />
    </div>
  );
}
