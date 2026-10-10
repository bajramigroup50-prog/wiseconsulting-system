/**
 * КДФИ-01 (дневни фискални извештаи) — legacy `VIEWS.kdfi` 5099 → 13143, `kdfiRows`/`kdfiDay` (effective 11469 /
 * 11470; the 5077 / 5080 bodies are dead, LEGACY-MAP §7.4 item 3), official layout `KH`/`kRow`/`kdfiTable` 5081–5086.
 */
import { kdfiRows, type KdfiDay } from '@wise/core';
import { loadStockSales } from '@wise/db';
import { db } from '@/lib/db';
import { locOptions, pickLoc, rangeOf, stockPage } from '@/lib/stock';
import { dmy, fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';

import { PdfButton } from '@/components/pdf-button';
import { FirmHead } from '@/app/print/firm-head';

type SP = { wh?: string; from?: string; to?: string };

const r2 = (x: number) => Math.round(x * 100) / 100;
function kSum(list: readonly KdfiDay[]): KdfiDay {
  const T: KdfiDay = { g: { 0: 0, 5: 0, 10: 0, 18: 0 }, v: { 5: 0, 10: 0, 18: 0 }, mg: 0, mv: { 5: 0, 10: 0, 18: 0 }, n: 0, tot: 0, vt: 0, mvt: 0 };
  for (const R of list) {
    for (const r of [0, 5, 10, 18] as const) T.g[r] = r2(T.g[r] + R.g[r]);
    for (const r of [5, 10, 18] as const) { T.v[r] = r2(T.v[r] + R.v[r]); T.mv[r] = r2((T.mv[r] ?? 0) + (R.mv[r] ?? 0)); }
    T.mg = r2(T.mg + R.mg); T.tot = r2(T.tot + R.tot); T.vt = r2(T.vt + R.vt); T.mvt = r2(T.mvt + R.mvt); T.n += R.n;
  }
  return T;
}
const kv = (v: number | undefined) => fmt(v ?? 0);
function KRow({ label, R }: { label: string; R: KdfiDay }) {
  return (
    <>
      <td>{label}</td><td className="n">{kv(R.mg)}</td><td className="n">{kv(R.mv[5])}</td><td className="n">{kv(R.mv[10])}</td><td className="n">{kv(R.mv[18])}</td><td className="n">{kv(R.mvt)}</td>
      <td className="n">{kv(R.g[0])}</td><td className="n">{kv(R.g[5])}</td><td className="n">{kv(R.g[10])}</td><td className="n">{kv(R.g[18])}</td><td className="n">{kv(R.tot)}</td>
      <td className="n">{kv(R.v[5])}</td><td className="n">{kv(R.v[10])}</td><td className="n">{kv(R.v[18])}</td><td className="n">{kv(R.vt)}</td>
    </>
  );
}

export default async function KdfiPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { firm, year, L } = await stockPage('kdfi');
  if (!firm || !L) return <NoFirm t="КДФИ-01" />;
  const wh = pickLoc(L, sp.wh);
  const [from, to] = rangeOf(sp, year);
  const sales = await loadStockSales(db(), firm.id);
  const rows = kdfiRows(sales, from, to, wh || undefined);
  const T = kSum(rows);
  const est = new Set(sales.flatMap((s) => (s.days ?? []).filter((d) => d.est).map((d) => d.date)));
  return (
    <>
      <Hd t="КДФИ-01" sub="книга на дневни финансиски извештаи"><PdfButton selector="#kdfiForm" title={`KDFI-01_${from}_${to}`} landscape /></Hd>
      <form className="card">
        <div className="row" style={{ gap: 12, alignItems: 'end' }}>
          <label className="f">Објект<select name="wh" defaultValue={wh}><option value="">сите објекти</option>{locOptions(L).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <label className="f">Од<input type="date" name="from" defaultValue={from} /></label>
          <label className="f">До<input type="date" name="to" defaultValue={to} /></label>
          <button className="btn">Прикажи</button>
        </div>
      </form>
      {rows.length ? (
        <>
          <div className="card" style={{ padding: '10px 14px' }}>
            <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
              <div>Денови: <b>{rows.length}</b></div><div>Вкупен промет: <b>{fmt(T.tot)}</b> ден.</div><div>ДДВ: <b>{fmt(T.vt)}</b></div>
              {est.size > 0 && <div className="mut">{[...est].filter((d) => d >= from && d <= to).length} распределени денови (проценка)</div>}
            </div>
          </div>
          {/* legacy 13143: on screen first the turnover (total, per rate, VAT), Macedonian products last; the full form for the PDF */}
          <div className="tw"><table style={{ fontSize: 12.5 }}>
            <thead><tr><th>Датум</th><th className="n">Вкупен промет во денот</th><th className="n">0% / без ДДВ</th><th className="n">5%</th><th className="n">10%</th><th className="n">18%</th><th className="n">ДДВ вкупно</th><th className="n">од македонски производи</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.date}><td>{dmy(r.date)}{est.has(r.date) && <> <span className="pill warn" title="Распределено (проценка) – нема детален извештај по Z">распр.</span></>}</td><td className="n"><b>{fmt(r.tot)}</b></td>
              <td className="n">{r.g[0] ? fmt(r.g[0]) : ''}</td><td className="n">{r.g[5] ? fmt(r.g[5]) : ''}</td><td className="n">{r.g[10] ? fmt(r.g[10]) : ''}</td><td className="n">{r.g[18] ? fmt(r.g[18]) : ''}</td><td className="n">{r.vt ? fmt(r.vt) : ''}</td><td className="n mut">{r.mg ? fmt(r.mg) : ''}</td></tr>)}</tbody>
            <tfoot><tr><td>ВКУПНО</td><td className="n"><b>{fmt(T.tot)}</b></td><td className="n">{fmt(T.g[0])}</td><td className="n">{fmt(T.g[5])}</td><td className="n">{fmt(T.g[10])}</td><td className="n">{fmt(T.g[18])}</td><td className="n">{fmt(T.vt)}</td><td className="n mut">{fmt(T.mg)}</td></tr></tfoot>
          </table></div>
          <details className="card" style={{ padding: '8px 12px' }} open={false}><summary className="mut" style={{ cursor: 'pointer' }}>Целосен образец КДФИ-01 (сите колони, како во PDF)</summary>
          <div className="tw printarea" id="kdfiForm">
            <FirmHead firm={firm} title="КДФИ-01 – КНИГА НА ДНЕВНИ ФИНАНСИСКИ ИЗВЕШТАИ" sub={`${wh ? L.locName(wh) : 'сите објекти'} · ${dmy(from)} – ${dmy(to)}`} />
            <p className="mini">{firm.name} · ЕДБ {firm.edb} · КДФИ-01 · {wh ? L.locName(wh) : 'сите објекти'} · {dmy(from)} – {dmy(to)}</p>
            <table style={{ fontSize: 12 }}>
              <thead>
                <tr><th rowSpan={2}>Датум</th><th rowSpan={2}>Вкупен промет остварен од македонски производи</th><th colSpan={3} style={{ textAlign: 'center' }}>Износ на данок од македонски производи прикажан по даночни стапки</th><th rowSpan={2}>Вкупен износ на данок од македонски производи</th><th colSpan={4} style={{ textAlign: 'center' }}>Вкупен промет во тековниот ден со вкалкулиран данок, искажан по даночни стапки</th><th rowSpan={2}>Вкупен промет во тековниот ден</th><th colSpan={3} style={{ textAlign: 'center' }}>Износ на данок во тековниот ден по даночни стапки</th><th rowSpan={2}>Вкупен износ на данок во тековниот ден</th></tr>
                <tr><th className="n">5%</th><th className="n">10%</th><th className="n">18%</th><th className="n">0%</th><th className="n">5%</th><th className="n">10%</th><th className="n">18%</th><th className="n">5%</th><th className="n">10%</th><th className="n">18%</th></tr>
              </thead>
              <tbody>{rows.map((r) => <tr key={r.date}><KRow label={dmy(r.date) + (est.has(r.date) ? ' (распр.)' : '')} R={r} /></tr>)}</tbody>
              <tfoot><tr><KRow label="ВКУПНО" R={T} /></tr></tfoot>
            </table>
          </div></details>
        </>
      ) : <div className="card empty">Нема дневни фискални извештаи за периодот.</div>}
    </>
  );
}
