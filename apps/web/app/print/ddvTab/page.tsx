/** Legacy `dtPdf` / `dtPdfInner` 16823–16827 (`DDV_tabela_<firm>_<years>.pdf`): one landscape page per year. */
import { perRange } from '@wise/core';
import { inspCols, inspTables, inspYears } from '@/lib/vat-insp';
import { DT_SH } from '@/lib/vat-view';
import { Sig } from '../firm-head';
import { printGuard } from '../guard';

export const metadata = { title: 'Табела ДДВ' };
const fi = (v: number) => Math.round(v || 0).toLocaleString('de-DE');

export default async function PrintDdvTab({ searchParams }: { searchParams: Promise<{ y?: string | string[]; mode?: string; c?: string | string[]; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const { firm, year } = await printGuard('ddv');
  const iso = (v?: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? '') ? v! : '');
  const from = iso(sp.from), to = iso(sp.to);
  const rng = from && to && from <= to;
  const YS = rng ? Array.from({ length: Number(to.slice(0, 4)) - Number(from.slice(0, 4)) + 1 }, (_, i) => Number(from.slice(0, 4)) + i) : inspYears(sp.y, year);
  const mode = sp.mode === 'per' ? 'per' : 'month';
  /* a document package's from–to: only the months / tax periods inside it */
  const T = (await inspTables(firm, YS, mode)).map((t) => (rng ? { ...t, rows: t.rows.filter((r) => { const [a, b] = perRange(r.p); return a >= from && b <= to; }) } : t));
  // only the fields with an amount in the printed years (the empty ones took the width and the numbers overlapped)
  const cols = inspCols(firm, sp.c).filter((k) => T.some((t) => t.rows.some((r) => Math.round(r.F[k] ?? 0) !== 0)));
  const sum = (R: { F: Record<string, number> }[], k: string) => R.reduce((s, r) => s + (r.F[k] ?? 0), 0);
  return (
    <div className="pdfdoc land">
      <title>{`DDV_tabela_${firm.name.replace(/[^\p{L}\p{N}]+/gu, '_')}_${YS.join('-')}`}</title>
      <style dangerouslySetInnerHTML={{ __html: '@page{size:A4 landscape;margin:10mm}.pdfdoc.land{max-width:none;width:auto}.dtt{width:100%;table-layout:auto;border-collapse:collapse;font-size:8pt}.dtt th,.dtt td{border:1px solid #444;padding:2px 4px}.dtt th{font-size:7pt;font-weight:600;white-space:normal;vertical-align:bottom;line-height:1.15;text-align:center}.dtt td.n{white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}.dtt td:first-child{white-space:nowrap}' }} />
      {T.map((t, i) => (
        <div key={t.y} style={i ? { pageBreakBefore: 'always' } : undefined}>
          <div className="ph"><div><div className="pt">ПРЕГЛЕД НА ПРИЈАВЕН ДДВ ЗА {t.y} ГОДИНА{rng ? ` (${from.split('-').reverse().join('.')} – ${to.split('-').reverse().join('.')})` : ''}</div><div className="ps">{firm.name} · ЕДБ {firm.edb} · {mode === 'per' ? 'по даночни периоди' : 'по месеци'}</div></div></div>
          <table className="dtt">
            <thead><tr><th>Период</th>{cols.map((k) => <th key={k}>{DT_SH[k] ?? k}<br /><span style={{ fontWeight: 400 }}>поле {k}</span></th>)}</tr></thead>
            <tbody>{t.rows.map((r) => <tr key={r.l}><td>{r.l}</td>{cols.map((k) => <td key={k} className="n">{r.F[k] ? fi(r.F[k]) : ''}</td>)}</tr>)}</tbody>
            <tfoot><tr><td><b>Вкупно</b></td>{cols.map((k) => <td key={k} className="n"><b>{fi(sum(t.rows, k))}</b></td>)}</tr></tfoot>
          </table>
          <Sig />
        </div>
      ))}
    </div>
  );
}
