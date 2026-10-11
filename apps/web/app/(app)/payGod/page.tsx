/** Legacy `VIEWS.payGod` 6274 (+ `pgXlsx` 7138), Плата › Годишен извештај. */
import Link from 'next/link';
import { fmt, fq } from '@/lib/fmt';
import { payPage, yearRuns } from '@/lib/payroll/server';
import { yearRows } from '@/lib/payroll/slip';
import { DownloadCsv } from '@/components/download-csv';
import { XlsxButton } from '@/components/vp-tools';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';

const MM = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const LAB = { n: 'Нето за исплата', g: 'Бруто', c: 'Придонеси', t: 'Данок', h: 'Часови' } as const;
type K = keyof typeof LAB;

export default async function PayGodPage({ searchParams }: { searchParams: Promise<{ k?: string }> }) {
  const sp = await searchParams;
  const { firm, year } = await payPage('payGod');
  if (!firm) return <NoFirm t="Годишен извештај за плати" />;
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
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>{(Object.keys(LAB) as K[]).map((k) => <Link key={k} className={'btn sm' + (K === k ? ' pri' : '')} href={`/payGod?k=${k}`}>{LAB[k]}</Link>)}</div>
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
