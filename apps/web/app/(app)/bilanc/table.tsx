/**
 * Screen table of the trial balance (legacy `bbTable` 6655, compact `table.fit`): rows by class with class totals, the
 * „Вкупно“ tab = class totals only; „Без колона ‚Само од тековна година‘“ hides Должи / Побарува од тек. година. Every row
 * carries `data-href` = the „Аналитика“ flow of that konto (Enter / double click, `components/key-nav.tsx`).
 */
import Link from 'next/link';
import { Fragment } from 'react';
import { CLS, type TbRow } from '@wise/core';
import { fmt } from '@/lib/fmt';
import type { BbTab, BbView } from '@/lib/bb-filter';

type Sum = Omit<TbRow, 'k' | 'name'>;

export interface BbTableProps {
  V: BbView; tab: BbTab; from: string; to: string; noCur: boolean;
  /** analytics level: kontos that have partner lines (▸ expands them), the expanded konto and its partner rows */
  withPartners?: ReadonlySet<string>; exp?: string; expRows?: readonly TbRow[];
  pf?: string | null; expHref?: (k: string) => string; bbPartHref?: (k: string) => string;
}

export function BbTable({ V, tab, from, to, noCur, withPartners = new Set(), exp = '', expRows = [], pf, expHref, bbPartHref }: BbTableProps) {
  const F = (noCur ? ['vd', 'vp', 'od', 'op'] : ['vd', 'vp', 'od', 'op', 'td', 'tp']) as (keyof Sum)[];
  const cols = 3 + F.length;
  const cells = (r: Sum) => <><td className="n"><b>{fmt(r.s)}</b></td>{F.map((f) => <td className="n" key={f}>{fmt(r[f])}</td>)}</>;
  const per = `from=${from}&to=${to}`;
  const ak = (k: string, pid?: string) => `/akart?k=${k}${pid ? '&pid=' + pid : ''}&${per}`;
  return (
    <table id="bb" className="fit knav">
      <thead><tr><th>Конто</th><th>Назив</th><th className="n">Салдо</th><th className="n">Вк. должи</th><th className="n">Вк. побарува</th><th className="n">Поч. сост. должи</th><th className="n">Поч. сост. побарува</th>
        {!noCur && <><th className="n">Должи од тек. година</th><th className="n">Побарува од тек. година</th></>}</tr></thead>
      <tbody>
        {V.classes.map(({ c, rows, total }) => (
          <Fragment key={c}>
            {tab !== '1' && tab !== 'v' && <tr className="sub"><td colSpan={cols}>Класа {CLS[+c as 0]}</td></tr>}
            {rows.length > 0 && tab !== 'v' && rows.map((r) => {
              const hasP = tab === 'a' && withPartners.has(r.k);
              const open = hasP && exp === r.k;
              const kk = `/kkart?k=${r.k}&sub=${tab === 'a' ? '' : '1'}&${per}${pf ? '&p=' + pf : ''}`;
              return (
                <Fragment key={r.k}>
                  <tr className="bbrow" data-href={ak(r.k)} data-k={r.k}>
                    <td style={{ whiteSpace: 'nowrap' }}>{hasP && expHref && <Link href={expHref(open ? '' : r.k)} title={open ? 'Затвори ги комитентите' : 'Прикажи ги комитентите'} style={{ textDecoration: 'none' }}>{open ? '▾ ' : '▸ '}</Link>}<Link href={ak(r.k)} title="Аналитика на контото (Enter / двоен клик)"><b style={{ color: 'var(--accent)' }}>{r.k}</b></Link></td>
                    <td className="w">{r.name} <Link className="mini" href={kk} title="Аналитичка картица по конто">картица</Link>{hasP && bbPartHref && <> <span className="mini" style={{ color: 'var(--muted)' }}>· по комитенти</span> <Link className="mini" href={bbPartHref(r.k)}>табела по комитенти</Link></>}</td>
                    {cells(r)}
                  </tr>
                  {open && expRows.map((p) => (
                    <tr key={p.k || '-'} style={{ background: 'var(--accent-soft)' }} data-href={p.k ? ak(r.k, p.k) : `/kkart?k=${r.k}&${per}&p=none`} data-k={r.k}>
                      <td />
                      <td style={{ paddingLeft: 22 }}><Link href={p.k ? ak(r.k, p.k) : `/kkart?k=${r.k}&${per}&p=none`}>↳ {p.name}</Link></td>
                      {cells(p)}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            {tab !== '1' && <tr className="tot" data-href={ak(c)} data-k={c}><td colSpan={2}>{tab === 'v' ? `Класа ${CLS[+c as 0]}` : `Вкупно класа ${c}`}</td>{cells(total)}</tr>}
          </Fragment>
        ))}
      </tbody>
      <tfoot><tr><td colSpan={2}>ВКУПНО</td>{cells(V.total)}</tr></tfoot>
    </table>
  );
}
