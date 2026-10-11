/** Legacy `VIEWS.payM4` 6280 (+ `m4Xlsx` 7142), Плата › М4 Образец. */
import Link from 'next/link';
import { fmt, fq } from '@/lib/fmt';
import { firmEmployees, payPage, yearRuns } from '@/lib/payroll/server';
import { m4Rows } from '@/lib/payroll/slip';
import { DownloadCsv } from '@/components/download-csv';
import { XlsxButton } from '@/components/vp-tools';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';

export default async function PayM4Page() {
  const { firm, year } = await payPage('payM4');
  if (!firm) return <NoFirm t="М4 образец" />;
  const E = new Map((await firmEmployees(firm.id)).map((e) => [e.id, e]));
  const R = m4Rows(await yearRuns(firm.id, year), (id) => E.get(id)?.embg ?? '');
  const per = (o: (typeof R)[number]) => `${o.months[0]!.slice(5)}–${o.months.at(-1)!.slice(5)}/${year}`;
  const csv: (string | number)[][] = [['Шифра', 'Име и презиме', 'ЕМБГ', 'Период', 'Месеци', 'Часови', 'Бруто плата', 'Основица за придонеси', 'ПИО'],
    ...R.map((o) => [o.no, o.name, o.embg, per(o), o.months.length, o.hours, o.gross, o.base, o.pio])];
  // Legacy `m4Xlsx` 7142: period split into „Од месец“ / „До месец“ (YYYY-MM).
  const xl: (string | number)[][] = [['Шифра', 'Име и презиме', 'ЕМБГ', 'Од месец', 'До месец', 'Месеци', 'Часови', 'Бруто плата', 'Основица за придонеси', 'ПИО'],
    ...R.map((o) => [o.no, o.name, o.embg, o.months[0]!, o.months.at(-1)!, o.months.length, o.hours, o.gross, o.base, o.pio])];
  return (
    <>
      <Hd t="М4 образец" sub={'годишни податоци за стаж и плата – ' + year}>
        <Link className="btn" href="/plati">← Пресметка на плата</Link>
        {R.length > 0 && <XlsxButton name={`M4_${year}.xlsx`} label="Excel" sheets={[{ name: `М4 ${year}`, rows: xl }]} />}
        {R.length > 0 && <DownloadCsv name={`M4_${year}.csv`} rows={csv} label="CSV" />}
      </Hd>
      <p className="note">Податоци по осигуреник за годината: месеци и часови на осигурување, бруто плата и основица за придонеси, ПИО придонес. Служат за пополнување/проверка на М4 кон Фондот за ПИО (пријавата се поднесува електронски според важечките упатства на ПИОМ/УЈП).</p>
      {R.length ? (
        <div className="tw"><table className="dense">
          <thead><tr><th>Шифра</th><th>Име и презиме</th><th>ЕМБГ</th><th>Период</th><th className="n">Месеци</th><th className="n">Часови</th><th className="n">Бруто плата</th><th className="n">Основица за придонеси</th><th className="n">ПИО</th></tr></thead>
          <tbody>{R.map((o) => (
            <tr key={o.no + o.name}><td>{o.no}</td><td>{o.name}</td><td>{o.embg}</td><td>{per(o)}</td><td className="n">{o.months.length}</td><td className="n">{fq(o.hours)}</td><td className="n">{fmt(o.gross)}</td><td className="n">{fmt(o.base)}</td><td className="n">{fmt(o.pio)}</td></tr>
          ))}</tbody>
        </table></div>
      ) : <div className="card empty">Нема пресметани плати за {year}.</div>}
    </>
  );
}
