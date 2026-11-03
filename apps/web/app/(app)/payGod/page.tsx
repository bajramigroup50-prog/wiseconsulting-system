/**
 * Legacy `VIEWS.payGod` 6274 (+ `pgXlsx` 7138), Плата › Годишен извештај; + задршки / неоданочиви and the Helix register
 * „Кредити и задршки“ (`?k=kr`): each loan / court withholding with what the payroll deductions have repaid and the rest.
 */
import Link from 'next/link';
import { and, eq, gte } from 'drizzle-orm';
import { empCalc, isLoanDeduction, payLoanStatus, type PayLoan } from '@wise/core';
import { loadRun, payrollRuns } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt, fq } from '@/lib/fmt';
import { firmEmployees, payPage, yearRuns } from '@/lib/payroll/server';
import { ActionForm } from '@/components/action-form';
import { RowAction } from '@/components/row-action';
import { payLoanDelAction, payLoanSaveAction } from './actions';
import { BolReport, KumReport, OeReport, StavkiReport } from './extra';
import { yearRows } from '@/lib/payroll/slip';
import { DownloadCsv } from '@/components/download-csv';
import { XlsxButton } from '@/components/vp-tools';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';

const MM = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const LAB = { n: 'Нето за исплата', g: 'Бруто', c: 'Придонеси', t: 'Данок', h: 'Часови', d: 'Задршки', x: 'Неоданочиви' } as const;
type K = keyof typeof LAB;

export default async function PayGodPage({ searchParams }: { searchParams: Promise<{ k?: string; m?: string; od?: string; do?: string }> }) {
  const sp = await searchParams;
  const { firm, year } = await payPage('payGod');
  if (!firm) return <NoFirm t="Годишен извештај за плати" />;
  if (sp.k === 'kr') return <Loans firmId={firm.id} />;
  if (sp.k === 'st') return <StavkiReport runs={await yearRuns(firm.id, year)} year={year} />;
  if (sp.k === 'oe') return <OeReport runs={await yearRuns(firm.id, year)} year={year} firmId={firm.id} />;
  if (sp.k === 'kum') return <KumReport runs={await yearRuns(firm.id, year)} year={year} firmId={firm.id} od={sp.od} to={sp.do} />;
  if (sp.k === 'bol') return <BolReport runs={await yearRuns(firm.id, year)} year={year} month={sp.m} />;
  const K: K = (sp.k && sp.k in LAB ? sp.k : 'n') as K;
  const rows = yearRows(await yearRuns(firm.id, year));
  const f = (v: number) => (K === 'h' ? fq(v) : fmt(v));
  const tot = (o: (typeof rows)[number]) => Object.values(o.m).reduce((s, v) => s + v[K], 0);
  const csv: (string | number)[][] = [['Шифра', 'Вработен', 'ЕМБГ', 'Показател', ...MM, 'Вкупно']];
  for (const o of rows) for (const k of Object.keys(LAB) as K[]) csv.push([o.no, o.name, o.embg, LAB[k], ...MM.map((x) => o.m[x]?.[k] ?? ''), Object.values(o.m).reduce((s, v) => s + v[k], 0)]);
  return (
    <>
      <Hd t="Годишен извештај за плати" sub={String(year)}>
        <Link className="btn" href="/plati">← Пресметка на плата</Link>
        {rows.length > 0 && <XlsxButton name={`Godisen_izvestaj_plati_${year}.xlsx`} label="Excel" sheets={[{ name: `Плати ${year}`, rows: csv }]} />}
        {rows.length > 0 && <DownloadCsv name={`Godisen_izvestaj_plati_${year}.csv`} rows={csv} label="CSV" />}
      </Hd>
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>{(Object.keys(LAB) as K[]).map((k) => <Link key={k} className={'btn sm' + (K === k ? ' pri' : '')} href={`/payGod?k=${k}`}>{LAB[k]}</Link>)}<Link className="btn sm" href="/payGod?k=kr">💳 Кредити и задршки</Link><Link className="btn sm" href="/payGod?k=st">Рекапитулар по ставки</Link><Link className="btn sm" href="/payGod?k=oe">По ОЕ</Link><Link className="btn sm" href="/payGod?k=kum">Кумулативна пресметка</Link><Link className="btn sm" href="/payGod?k=bol">Боледувања и ФЗО</Link></div>
      {rows.length ? (
        <div className="tw"><table className="dense">
          <thead><tr><th>Шифра</th><th>Вработен</th>{MM.map((x) => <th key={x} className="n">{x}</th>)}<th className="n">Вкупно</th></tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={o.key}><td>{o.no}</td><td>{o.name}</td>{MM.map((x) => <td key={x} className="n">{o.m[x] ? f(o.m[x][K]) : ''}</td>)}<td className="n"><b>{f(tot(o))}</b></td></tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={2}>Вкупно</td>{MM.map((x) => <td key={x} className="n">{f(rows.reduce((s, o) => s + (o.m[x]?.[K] ?? 0), 0))}</td>)}<td className="n">{f(rows.reduce((s, o) => s + tot(o), 0))}</td></tr></tfoot>
        </table></div>
      ) : <div className="card empty">Нема пресметани плати за {year}.</div>}
    </>
  );
}

const KINDS = ['Кредит', 'Судска забрана / извршител', 'Задршка по решение', 'Друго'];

async function Loans({ firmId }: { firmId: string }) {
  const E = await firmEmployees(firmId);
  const withL = E.map((e) => ({ e, L: (((e.data ?? {}) as { loans?: PayLoan[] }).loans ?? []) })).filter((x) => x.L.length);
  const from = withL.flatMap((x) => x.L.map((l) => l.from.slice(0, 7))).sort()[0];
  /* the loan deductions per employee and month, from every run since the oldest loan */
  const ded = new Map<string, Map<string, number>>();
  if (from) {
    const R = await db().select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.firmId, firmId), gte(payrollRuns.month, from)));
    for (const r of R) {
      const run = await loadRun(db(), firmId, { id: r.id });
      if (!run) continue;
      for (const e of run.emps) {
        const v = empCalc(e, run.params).rows.filter((x) => x.ded && isLoanDeduction(x.type)).reduce((a, x) => a + x.ded, 0);
        if (!v || !e.empId) continue;
        const m = ded.get(e.empId) ?? ded.set(e.empId, new Map()).get(e.empId)!;
        m.set(run.month, (m.get(run.month) ?? 0) + v);
      }
    }
  }
  const rows = withL.flatMap(({ e, L }) => payLoanStatus(L, ded.get(e.id) ?? new Map()).map((s) => ({ e, s })));
  return (
    <>
      <Hd t="Кредити и задршки од плата" sub="регистар">
        <Link className="btn" href="/payGod">← Годишен извештај</Link>
      </Hd>
      <ActionForm action={payLoanSaveAction} className="card">
        <div className="form">
          <label className="f">Вработен<select name="emp" defaultValue=""><option value="">—</option>{E.map((e) => <option key={e.id} value={e.id}>{e.no} {e.name}</option>)}</select></label>
          <label className="f">Вид<select name="kind">{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
          <label className="f">Доверител (банка / извршител)<input name="creditor" /></label>
          <label className="f">Вкупен износ<input name="total" type="number" step="any" /></label>
          <label className="f">Месечна рата<input name="monthly" type="number" step="any" /></label>
          <label className="f">Се одбива од<input name="from" type="date" /></label>
          <label className="f wide">Забелешка (број на решение, сметка…)<input name="note" /></label>
        </div>
        <button className="btn pri">+ Додај</button>
        <p className="note">Отплатата се пресметува од ставките „Кредит / судска забрана (задршка)“ во платите (месец по месец, најстариот кредит прв). Секоја нова плата ја добива ратата сама (последната само остатокот); по отплатата ставката повеќе не се додава.</p>
      </ActionForm>
      {rows.length ? (
        <div className="tw"><table>
          <thead><tr><th>Вработен</th><th>Вид</th><th>Доверител</th><th>Од</th><th className="n">Вкупно</th><th className="n">Рата</th><th className="n">Отплатено</th><th className="n">Останува</th><th className="n">Рати</th><th /></tr></thead>
          <tbody>{rows.map(({ e, s }) => (
            <tr key={s.id}><td>{e.no} {e.name}</td><td>{s.kind}</td><td>{s.creditor}{s.note ? <small className="mut"> · {s.note}</small> : null}</td><td>{dmy(s.from)}</td>
              <td className="n">{fmt(s.total)}</td><td className="n">{s.monthly ? fmt(s.monthly) : ''}</td><td className="n">{fmt(s.paid)}</td>
              <td className="n">{s.rest > 0.009 ? <b>{fmt(s.rest)}</b> : <span className="pill ok">отплатен</span>}</td><td className="n">{s.months.length}</td>
              <td><RowAction label="🗑" title="Избриши" confirm="Да се избрише од регистарот?" action={payLoanDelAction.bind(null, e.id, s.id)} /></td></tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={4}>Вкупно</td><td className="n">{fmt(rows.reduce((a, r) => a + r.s.total, 0))}</td><td /><td className="n">{fmt(rows.reduce((a, r) => a + r.s.paid, 0))}</td><td className="n">{fmt(rows.reduce((a, r) => a + r.s.rest, 0))}</td><td colSpan={2} /></tr></tfoot>
        </table></div>
      ) : <div className="card empty">Нема внесени кредити или задршки.</div>}
    </>
  );
}

