/** Legacy `zsView('zs_aop')` 7692 (+ `aopCsv` / `aopXml` 7724–7725) — АОП позиции (тековна и претходна година). */
import { fmt } from '@/lib/fmt';
import { phaseDone, yePage } from '@/lib/yearend';
import { NoFirm } from '@/components/no-firm';
import { DownloadCsv } from '@/components/download-csv';
import { XlsxButton } from '@/components/vp-tools';
import { ZsHead } from '@/components/yearend/ph-bar';

export default async function ZsAopPage() {
  const c = await yePage('zs_aop');
  if (!c) return <NoFirm t="АОП позиции" />;
  const { L, year } = c;
  const C = L.Y.co.zs.V, P = L.prev.V;
  const rows: (string | number)[][] = [['Образец', 'АОП', 'Позиција', year, year - 1],
    ...L.rules.map((x) => [x.r === 'bu' ? 'БУ' : 'БС', x.aop, x.n, +(C[x.r + x.aop] || 0).toFixed(2), +(P[x.r + x.aop] || 0).toFixed(2)])];
  return (
    <>
      <ZsHead id="zs_aop" t="АОП позиции" year={year} ent={L.ent} done={phaseDone(L)}>
        <DownloadCsv name={`AOP_${year}.csv`} rows={rows} label="Excel (CSV)" />
        <XlsxButton name={`AOP_${year}.xlsx`} label="Excel" sheets={[{ name: `АОП ${year}`, rows }]} />
        <a className="btn pri" href="/zs_aop/xml">XML</a>
      </ZsHead>
      <div className="tw"><table>
        <thead><tr><th>Образец</th><th>АОП</th><th>Позиција</th><th className="n">{year}</th><th className="n">{year - 1}</th></tr></thead>
        <tbody>{L.rules.map((x) => (
          <tr key={x.r + x.aop}><td>{x.r === 'bu' ? 'Биланс на успех' : 'Биланс на состојба'}</td><td className="num" style={{ textAlign: 'left' }}>{x.aop}</td><td>{x.n}</td>
            <td className="n">{fmt(C[x.r + x.aop] || 0)}</td><td className="n">{fmt(P[x.r + x.aop] || 0)}</td></tr>
        ))}</tbody>
      </table></div>
    </>
  );
}
