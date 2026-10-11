/**
 * Legacy `VIEWS.vjetore` 6772 (+ phase bar 11176, `gsCsv` / `gsPdf` / `gsXml` 6791) — Годишна сметка (финансиски
 * извештаи, стар облик): the simple balance sheet / income statement (POS_BS / POS_IS) and the old `<GodisnaSmetka>` XML.
 * ЦРМ accepts the ЦРМ XML (`/zsXml`); this stays as a tool (⚙ Алатки) like in legacy.
 */
import Link from 'next/link';
import { simpleStatements } from '@wise/core/yearend';
import { fmt } from '@/lib/fmt';
import { phaseDone, yePage } from '@/lib/yearend';
import { DownloadCsv } from '@/components/download-csv';
import { NoFirm } from '@/components/no-firm';
import { ZsHead } from '@/components/yearend/ph-bar';

export default async function VjetorePage() {
  const c = await yePage('vjetore');
  if (!c) return <NoFirm t="Годишна сметка" />;
  const { L, year } = c;
  const B = L.Y.co.balances;
  const st = simpleStatements(B.pre, B.all, L.Y.closed ? Number(L.closing?.tax ?? 0) : null);
  const csv: (string | number)[][] = [['Извештај', 'Код', 'Позиција', 'Износ'],
    ...st.BS.filter((x) => !('head' in x && x.head)).map((x) => ['БС', x.c, x.n, Math.round(((x as { v?: number }).v ?? 0) * 100) / 100]),
    ...st.IS.map((x) => ['БУ', x.c, x.n, x.v])];
  const tr = (x: { c: string; n: string; v?: number }) => <tr key={x.c}><td className="num" style={{ textAlign: 'left' }}>{x.c}</td><td>{x.n}</td><td className="n">{fmt(x.v ?? 0)}</td></tr>;
  return (
    <>
      <ZsHead id="vjetore" t={`Годишна сметка ${year}`} year={year} ent={L.ent} done={phaseDone(L)}>
        <DownloadCsv name={`Godisna_smetka_${year}.csv`} rows={csv} label="Excel (CSV)" />
        <a className="btn pri" href="/vjetore/xml">Преземи XML</a>
      </ZsHead>
      {!st.closed && <div className="callout warn">Годината сè уште не е затворена. Бројките се прелиминарни; резултатот за годината е вклучен во капиталот. <Link className="btn sm" href="/mbyllja">Затвори ја годината</Link></div>}
      <div className="cols">
        <div className="card"><h2>Биланс на состојба</h2><div className="tw"><table><tbody>
          {st.BS.map((x) => ('head' in x && x.head ? <tr className="sub" key={x.c}><td colSpan={3}>{x.n}</td></tr> : tr(x as { c: string; n: string; v?: number })))}
          <tr className="tot"><td /><td>Вкупна актива</td><td className="n">{fmt(st.assets)}</td></tr>
          <tr className="tot"><td /><td>Вкупна пасива</td><td className="n">{fmt(st.liab)}</td></tr>
        </tbody></table></div>{Math.abs(st.assets - st.liab) < 0.01 ? <span className="pill good">Актива = Пасива</span> : <span className="pill bad">Разлика {fmt(st.assets - st.liab)}</span>}</div>
        <div className="card"><h2>Биланс на успех</h2><div className="tw"><table><tbody>
          <tr className="sub"><td colSpan={3}>ПРИХОДИ</td></tr>{st.IS.filter((x) => x.c[0] === 'U').map(tr)}
          <tr className="sub"><td colSpan={3}>РАСХОДИ</td></tr>{st.IS.filter((x) => x.c[0] === 'R').map(tr)}
          <tr className="tot"><td /><td>Добивка / загуба пред оданочување</td><td className="n">{fmt(st.profit)}</td></tr>
          <tr><td /><td>Данок на добивка</td><td className="n">{fmt(st.tax)}</td></tr>
          <tr className="tot"><td /><td>Нето добивка / загуба</td><td className="n">{fmt(st.net)}</td></tr>
        </tbody></table></div></div>
      </div>
      <div className="callout"><b>Поднесување во Централниот регистар:</b> годишната сметка се поднесува електронски (рок 15 март за електронско поднесување) – со <Link href="/zsXml">XML за ЦРМ</Link> (АОП обрасци 35–38). Овој XML ги содржи фирмата, позициите и бруто билансот.</div>
    </>
  );
}
