/**
 * Trade books — legacy `trgView` 5005 (ЕТ / ЕТМ), `VIEWS.m_trg` 5039 → 13181 (official ЕТ form for retail, `etData`)
 * and `VIEWS.g_trg` 5050 (МЕТГ quantity card, `metgData`).
 *
 * FIX (LEGACY-MAP §7.4 item 10): legacy titled the ЕТ form "…на мало (МЕТГ)" and made ЕТМ reachable only through the
 * PDF button. Here: g_trgv = ЕТ (wholesale, cost), m_trg = ЕТ образец за мало with an ЕТМ tab (retail value),
 * g_trg = МЕТГ (wholesale quantity card per item).
 */
import Link from 'next/link';
import { etBook, metgCard, tradeBook, trackedItems } from '@wise/core';
import { loadStockSales, stockDocResolver } from '@wise/db';
import { db } from '@/lib/db';
import { stockPage, locOptions, rangeOf } from '@/lib/stock';
import { dmy, fmt, fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { PrintButton } from '@/components/stock-ui';

export type TrgSP = { wh?: string; from?: string; to?: string; f?: string; i?: string };

const neg = (v: number) => (v < 0 ? { color: '#c0392b' } : undefined);

/** ЕТ — wholesale trade book at cost (g_trgv), or ЕТМ — retail at retail value (m_trg?f=etm). */
export async function TrgPage({ retail, sp }: { retail: boolean; sp: TrgSP }) {
  const t = retail ? 'Евиденција во трговијата на мало (ЕТМ)' : 'Евиденција во трговијата на големо (ЕТ)';
  const { firm, year, L } = await stockPage(retail ? 'm_trg' : 'g_trgv');
  if (!firm || !L) return <NoFirm t={t} />;
  const kind = retail ? 'store' : 'warehouse';
  const opts = locOptions(L, kind);
  const wh = opts.some((l) => l.id === sp.wh) ? sp.wh! : '';
  const [from, to] = rangeOf(sp, year);
  const sales = retail ? await loadStockSales(db(), firm.id) : [];
  // TODO(phase3): sale value of invoice issues (legacy `saleVal` from the invoice line) once invoices write stock_moves.
  const T = tradeBook(L.ctx, { retail, wh, from, to, sales, locationName: L.locName });
  return (
    <>
      <Hd t={t} sub={retail ? 'по продажна вредност со ДДВ' : 'по набавна вредност'}><PrintButton /></Hd>
      {retail && <RetailTabs f="etm" sp={{ wh, from, to }} />}
      <form className="card">
        {retail && <input type="hidden" name="f" value="etm" />}
        <div className="row" style={{ gap: 12, alignItems: 'end' }}>
          <label className="f">{retail ? 'Продавница' : 'Магацин'}
            <select name="wh" defaultValue={wh}><option value="">{retail ? 'сите продавници' : 'сите магацини'}</option>{opts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          </label>
          <label className="f">Од<input type="date" name="from" defaultValue={from} /></label>
          <label className="f">До<input type="date" name="to" defaultValue={to} /></label>
          <button className="btn">Прикажи</button>
        </div>
        <p className="note">{retail
          ? 'Задолжување: приеми на стока и преносници од магацин по малопродажна цена со ДДВ, нивелации. Раздолжување: дневниот промет од касата (Z извештаи) и другите излези.'
          : 'Задолжување: влезни фактури по набавна вредност. Раздолжување: излезни фактури по набавна вредност, со продажната вредност од фактурата. Преносниците во продавница не се тука – тие се во МЕТГ (количински) и во евиденцијата на мало.'}</p>
      </form>
      <div className="tw printarea">
        <p className="mini">{firm.name} · {t} · {wh ? L.locName(wh) : retail ? 'сите продавници' : 'сите магацини'} · {dmy(from)} – {dmy(to)}</p>
        <table>
          <thead><tr><th>Р.б.</th><th>Датум</th><th>Документ</th><th className="n">Задолжување</th><th className="n">Раздолжување</th>{!retail && <th className="n">Продажна вредност без ДДВ</th>}<th className="n">Салдо</th></tr></thead>
          <tbody>
            <tr className="sub"><td /><td>{dmy(from)}</td><td>Пренос / почетна состојба</td><td /><td />{!retail && <td />}<td className="n">{fmt(T.open)}</td></tr>
            {T.rows.map((r, i) => (
              <tr key={i}><td>{i + 1}</td><td>{dmy(r.date)}</td><td>{r.doc}</td><td className="n">{r.d ? fmt(r.d) : ''}</td><td className="n">{r.p ? fmt(r.p) : ''}</td>
                {!retail && <td className="n">{r.sale !== '' && r.sale != null ? fmt(r.sale) : ''}</td>}<td className="n">{fmt(r.bal)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={3}>Вкупно</td><td className="n">{fmt(T.totals.d)}</td><td className="n">{fmt(T.totals.p)}</td>{!retail && <td className="n">{fmt(T.totals.sale)}</td>}<td className="n">{fmt(T.totals.bal)}</td></tr></tfoot>
        </table>
      </div>
    </>
  );
}

function RetailTabs({ f, sp }: { f: 'et' | 'etm'; sp: { wh: string; from: string; to: string } }) {
  const q = (x: string) => '/m_trg?' + new URLSearchParams({ ...(x === 'etm' ? { f: 'etm' } : {}), ...(sp.wh ? { wh: sp.wh } : {}), from: sp.from, to: sp.to }).toString();
  return (
    <div className="row" style={{ gap: 6, marginBottom: 8 }}>
      <Link className={`btn sm ${f === 'et' ? 'pri' : ''}`} href={q('et')}>Образец ЕТ (мало)</Link>
      <Link className={`btn sm ${f === 'etm' ? 'pri' : ''}`} href={q('etm')}>ЕТМ по продажна вредност</Link>
    </div>
  );
}

/** Official ЕТ form for retail stores (legacy view `m_trg`, `etData` / `etTable`). */
export async function EtPage({ sp }: { sp: TrgSP }) {
  if (sp.f === 'etm') return TrgPage({ retail: true, sp });
  const t = 'Евиденција во трговијата на мало – образец ЕТ';
  const { firm, year, L } = await stockPage('m_trg');
  if (!firm || !L) return <NoFirm t={t} />;
  const opts = locOptions(L, 'store');
  const wh = opts.some((l) => l.id === sp.wh) ? sp.wh! : '';
  const [from, to] = rangeOf(sp, year);
  const [sales, docOf] = await Promise.all([loadStockSales(db(), firm.id), stockDocResolver(db(), L)]);
  const T = etBook(L.ctx, { wh, from, to, sales, docOf, firmFiskScheme: L.settings.fiskOpt.sc, locationName: L.locName });
  return (
    <>
      <Hd t={t} sub="по продажен објект"><PrintButton /></Hd>
      <RetailTabs f="et" sp={{ wh, from, to }} />
      <form className="card">
        <div className="row" style={{ gap: 12, alignItems: 'end' }}>
          <label className="f">Продажен објект
            <select name="wh" defaultValue={wh}><option value="">сите продавници</option>{opts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          </label>
          <label className="f">Од<input type="date" name="from" defaultValue={from} /></label>
          <label className="f">До<input type="date" name="to" defaultValue={to} /></label>
          <button className="btn">Прикажи</button>
        </div>
        <p className="note">Кол. 5 – набавна вредност (кол. 6 + 7 од ПЛТ), кол. 6 – продажна вредност (кол. 10 од ПЛТ, преносници, нивелации; враќања и отпис како сторно со минус), кол. 7 – дневен промет од фискалната каса. Во ист ден прво се книжат влезовите, па излезите.</p>
      </form>
      <div className="tw printarea">
        <p className="mini">{firm.name} · Образец ЕТ · {wh ? L.locName(wh) : 'сите продавници'} · {dmy(from)} – {dmy(to)}</p>
        <table>
          <thead>
            <tr><th>Реден бр.</th><th>Датум на книжење</th><th>Назив и број на документот</th><th>Датум на документот</th><th className="n">Набавна вредност на стоките</th><th className="n">Продажна вредност на стоките</th><th className="n">Дневен промет</th></tr>
            <tr>{[1, 2, 3, 4, 5, 6, 7].map((n) => <th key={n} style={{ textAlign: 'center' }}>{n}</th>)}</tr>
          </thead>
          <tbody>
            <tr className="sub"><td /><td>{dmy(from)}</td><td>Пренос од претходен период (состојба по продажни цени)</td><td /><td /><td className="n">{fmt(T.open)}</td><td /></tr>
            {T.rows.map((r, i) => (
              <tr key={i}><td>{i + 1}</td><td>{dmy(r.date)}</td><td>{r.no}{r.name ? ' · ' + r.name : ''}</td><td>{dmy(r.ddate)}</td>
                <td className="n">{r.nab ? fmt(r.nab) : ''}</td><td className="n" style={neg(r.sp)}>{r.sp ? fmt(r.sp) : ''}</td><td className="n">{r.pr ? fmt(r.pr) : ''}</td></tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={4}>Вкупно за периодот</td><td className="n">{fmt(T.totals.nab)}</td><td className="n">{fmt(T.totals.sp)}</td><td className="n">{fmt(T.totals.pr)}</td></tr>
            <tr><td colSpan={5}>Состојба на залиха по продажни цени (пренос + кол. 6 − кол. 7)</td><td className="n" colSpan={2}>{fmt(T.totals.close)}</td></tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

/** МЕТГ — quantity card per item in the warehouses (legacy `VIEWS.g_trg`, `metgData` / `metgHTML`). */
export async function MetgPage({ sp }: { sp: TrgSP }) {
  const t = 'Количинска евиденција по артикл (МЕТГ)';
  const { firm, year, L } = await stockPage('g_trg');
  if (!firm || !L) return <NoFirm t={t} />;
  const its = trackedItems(L.ctx);
  const it = its.find((i) => i.id === sp.i) ?? its[0];
  if (!it) return <><Hd t={t} /><div className="card empty">Нема артикли.</div></>;
  const opts = locOptions(L, 'warehouse');
  const wh = opts.some((l) => l.id === sp.wh) ? sp.wh! : '';
  const [from, to] = rangeOf(sp, year);
  const D = metgCard(L.ctx, { item: it.id, wh, from, to, docOf: await stockDocResolver(db(), L) });
  return (
    <>
      <Hd t={t} sub="магацин · посебно за секоја стока (шифра)"><PrintButton /></Hd>
      <form className="card">
        <div className="row" style={{ gap: 12, alignItems: 'end' }}>
          <label className="f" style={{ minWidth: 260 }}>Стока
            <select name="i" defaultValue={it.id}>{its.map((i) => <option key={i.id} value={i.id}>{(i.code ? i.code + ' · ' : '') + i.name}</option>)}</select>
          </label>
          <label className="f">Магацин
            <select name="wh" defaultValue={wh}><option value="">сите магацини</option>{opts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          </label>
          <label className="f">Од<input type="date" name="from" defaultValue={from} /></label>
          <label className="f">До<input type="date" name="to" defaultValue={to} /></label>
          <button className="btn">Прикажи</button>
        </div>
        <p className="note">Количински: набавено (влезни фактури, приемници), продадено/издадено (излезни фактури, испратници, преносници во продавница). Во ист ден прво се книжат влезовите, па излезите.</p>
      </form>
      <div className="tw printarea">
        <div className="grid2">
          <div className="box"><b>Назив на стоката:</b> {it.name}<br /><b>Шифра:</b> {it.code} · <b>Ед. мера:</b> {it.unit}</div>
          <div className="box"><b>Магацин:</b> {wh ? L.locName(wh) : 'сите магацини'}<br /><b>Период:</b> {dmy(from)} – {dmy(to)}</div>
        </div>
        <table>
          <thead>
            <tr><th>Реден број</th><th>Датум на книжење</th><th>Број на документ</th><th>Датум на документ</th><th>Назив на документ / комитент</th><th className="n">Количина набавена</th><th className="n">Количина продадена</th><th className="n">Крајна состојба</th></tr>
            <tr>{[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <th key={n} style={{ textAlign: 'center' }}>{n}</th>)}</tr>
          </thead>
          <tbody>
            <tr className="sub"><td /><td>{dmy(from)}</td><td colSpan={3}>Почетна состојба / пренос</td><td /><td /><td className="n">{fq(D.open)}</td></tr>
            {D.rows.map((r, i) => (
              <tr key={i}><td>{i + 1}</td><td>{dmy(r.date)}</td><td>{r.no}</td><td>{dmy(r.ddate)}</td><td>{r.name}</td>
                <td className="n">{r.in ? fq(r.in) : ''}</td><td className="n">{r.out ? fq(r.out) : ''}</td><td className="n" style={neg(r.bal)}>{fq(r.bal)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={5}>Вкупно</td><td className="n">{fq(D.totals.in)}</td><td className="n">{fq(D.totals.out)}</td><td className="n">{fq(D.totals.bal)}</td></tr></tfoot>
        </table>
      </div>
    </>
  );
}
