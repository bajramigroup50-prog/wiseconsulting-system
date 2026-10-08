/**
 * Лагер листа — legacy `lagerView(v)` 4964 for `g_lager`, `g_lagerk`, `m_lager`, `m_lagerp` (LAGER 4918, `lagerTable`
 * 4927, `lagerSum` 4930). FIX (LEGACY-MAP §7.4 item 1): quantities come from the corrected `stockAt`; the shipped
 * legacy list showed 0 for every item because of the swapped `stockAt` arguments.
 */
import { LAGER, lagerColumnTotal, lagerRows, lagerSummary, type LagerView } from '@wise/core';
import { stockPage, dateInYear, locOptions, pickLoc } from '@/lib/stock';
import { dmy, fmt, fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { DownloadCsv } from '@/components/download-csv';
import { PrintButton } from '@/components/stock-ui';

const TYPES: Record<string, string> = { goods: 'Стока (трговија)', material: 'Суровина / материјал', product: 'Готов производ' };

export type LagerSP = { wh?: string; d?: string; t?: string; q?: string; z?: string };

export async function LagerPage({ view, sp }: { view: LagerView; sp: LagerSP }) {
  const def = LAGER[view];
  const { firm, year, L } = await stockPage(view);
  if (!firm || !L) return <NoFirm t={def.title} />;
  const wh = pickLoc(L, sp.wh);
  const date = dateInYear(sp.d, year);
  const type = sp.t && TYPES[sp.t] ? sp.t : '';
  const q = (sp.q ?? '').trim();
  const zero = sp.z === '1';
  const rows = lagerRows(L.ctx, { date, wh: wh || undefined, type, q, zero });
  const W = wh || undefined;
  const fv = (kind: string, v: number | string) => (v === '' ? '' : kind === 'q' ? fq(v) : kind === 'm' ? fmt(v) : kind === 'b' ? '' : String(v));
  const S = def.summary ? lagerSummary(rows) : null;
  const csv: (string | number | null)[][] = [['Р.б.', 'Шифра', 'Назив', 'Ед.', ...def.cols.map((c) => c.label)],
    ...rows.map((r, i) => [i + 1, r.item.code ?? '', r.item.name ?? '', r.item.unit ?? '', ...def.cols.map((c) => { const v = c.value(r.item, r.s, W); return typeof v === 'number' ? v : v; })])];
  return (
    <>
      <Hd t={def.title} sub={'состојба на ' + dmy(date)}>
        <DownloadCsv name={`Lager_${date}.csv`} rows={csv} />
        <PrintButton />
      </Hd>
      <form className="card">
        <div className="row" style={{ gap: 12, alignItems: 'end' }}>
          <label className="f">Објект
            <select name="wh" defaultValue={wh}>
              <option value="">Сите објекти</option>
              {locOptions(L).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className="f">Состојба на ден<input type="date" name="d" defaultValue={date} /></label>
          <label className="f">Вид
            <select name="t" defaultValue={type}>
              <option value="">Сите</option>
              {Object.entries(TYPES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </label>
          <label className="f">Шифра / назив<input name="q" defaultValue={q} /></label>
          <label className="chk"><input type="checkbox" name="z" value="1" defaultChecked={zero} /> и артикли со нула залиха</label>
          <button className="btn">Прикажи</button>
        </div>
        {view === 'g_lagerk' && <p className="note">Скратената лагер листа има празни колони „Пописна количина“ и „Разлика“ за попис.</p>}
        {view[0] === 'm' && <p className="note">Малопродажните вредности се по тековната продажна цена од шифрарникот со ДДВ.</p>}
      </form>
      {rows.length ? (
        <div className="tw printarea">
          <p className="mini">{firm.name} · {def.title} · {wh ? L.locName(wh) : 'сите објекти'} · состојба на {dmy(date)}</p>
          <table style={def.dense ? { fontSize: '8.5px' } : undefined}>
            <thead><tr><th>Р.б.</th><th>Шифра</th><th>Назив</th><th>Ед.</th>{def.cols.map((c) => <th key={c.label} className="n">{c.label}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.item.id}>
                  <td>{i + 1}</td><td>{r.item.code}</td><td>{r.item.name}</td><td>{r.item.unit}</td>
                  {def.cols.map((c) => <td key={c.label} className="n" style={c.kind === 'b' ? { minWidth: '22mm' } : undefined}>{fv(c.kind, c.value(r.item, r.s, W))}</td>)}
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4}>Вкупно ({rows.length} артикли)</td>{def.cols.map((c) => <td key={c.label} className="n">{c.sum ? fv(c.kind, lagerColumnTotal(rows, c, W)) : ''}</td>)}</tr></tfoot>
          </table>
          {S && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10, marginTop: 10 }}>
              <table style={{ margin: 0 }}><thead><tr><th colSpan={2}>По набавни цени без ДДВ</th></tr></thead><tbody>
                <tr><td>Финансиски влез</td><td className="n">{fmt(S.fin.i)}</td></tr><tr><td>Финансиски излез</td><td className="n">{fmt(S.fin.o)}</td></tr>
                <tr><td>Финанс. состојба</td><td className="n">{fmt(S.fin.st)}</td></tr><tr><td>Финанс. состојба со ДДВ</td><td className="n">{fmt(S.fin.stv)}</td></tr>
              </tbody></table>
              <table style={{ margin: 0 }}><thead><tr><th colSpan={2}>Количини</th></tr></thead><tbody>
                <tr><td>Присутна кол.</td><td className="n">{fq(S.q.p)}</td></tr><tr><td>Влезена кол.</td><td className="n">{fq(S.q.i)}</td></tr>
                <tr><td>Излезена кол.</td><td className="n">{fq(S.q.o)}</td></tr><tr><td>Кол. за набавка</td><td className="n">{fq(S.q.n)}</td></tr>
              </tbody></table>
              <table style={{ margin: 0 }}><thead><tr><th colSpan={3}>По продажни цени</th></tr></thead><tbody>
                <tr><td></td><td className="n">Со ДДВ</td><td className="n">Без ДДВ</td></tr>
                <tr><td>Влез</td><td className="n">{fmt(S.pv.iw)}</td><td className="n">{fmt(S.pv.in)}</td></tr>
                <tr><td>Излез</td><td className="n">{fmt(S.pv.ow)}</td><td className="n">{fmt(S.pv.on)}</td></tr>
                <tr><td>САЛДО</td><td className="n">{fmt(S.pv.iw - S.pv.ow)}</td><td className="n">{fmt(S.pv.in - S.pv.on)}</td></tr>
              </tbody></table>
            </div>
          )}
        </div>
      ) : <div className="card empty">Нема артикли со залиха за избраниот ден.</div>}
    </>
  );
}
