/** Legacy `zsView('zs_skr')` 7666 (+ `zsSkrPdf` 7715) — Скратен биланс на успех (тековна и претходна година, индекс). */
import { skrRows } from '@wise/core/yearend/tools';
import { fmt } from '@/lib/fmt';
import { phaseDone, yePage } from '@/lib/yearend';
import { NoFirm } from '@/components/no-firm';
import { XlsxButton } from '@/components/vp-tools';
import { NotClosedNote, ZsHead } from '@/components/yearend/ph-bar';

export default async function ZsSkrPage() {
  const c = await yePage('zs_skr');
  if (!c) return <NoFirm t="Скратен биланс на успех" />;
  const { L, year } = c;
  const A = skrRows(L.Y.co.zs.V), P = skrRows(L.prev.V);
  const idx = (a: number, p: number) => (p ? (a / p * 100).toLocaleString('de-DE', { maximumFractionDigits: 2 }) : '—');
  return (
    <>
      <ZsHead id="zs_skr" t="Скратен биланс на успех" year={year} ent={L.ent} done={phaseDone(L)}>
        <XlsxButton name={`Skraten_bilans_${year}.xlsx`} label="Excel" sheets={[{ name: 'Скратен биланс', rows: [['Позиција', year, year - 1, 'Индекс'], ...A.map(([n, a], i) => [n, Math.round(a), Math.round(P[i]![1]), idx(a, P[i]![1])])] }]} />
      </ZsHead>
      <NotClosedNote closed={L.Y.closed} year={year} />
      <div className="tw"><table>
        <thead><tr><th>Позиција</th><th className="n">{year}</th><th className="n">{year - 1}</th><th className="n">Индекс</th></tr></thead>
        <tbody>{A.map(([n, a, tot], i) => (
          <tr key={n} className={tot ? 'tot' : ''}><td>{n}</td><td className="n">{fmt(a)}</td><td className="n">{fmt(P[i]![1])}</td><td className="n">{idx(a, P[i]![1])}</td></tr>
        ))}</tbody>
      </table></div>
    </>
  );
}
