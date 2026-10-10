/**
 * Лагер листа — legacy `lagerView(v)` 4964 for `g_lager`, `g_lagerk`, `m_lager`, `m_lagerp` (LAGER 4918, `lagerTable`
 * 4927, `lagerSum` 4930), header buttons „Увоз од Excel / CSV“ (`lagImpOpen`, `lagImpHTML` 4935 → receipt / count /
 * new retail prices), „Excel“ / „CSV“ (`lagerXlsx` → `lagAoa` 4959 + `lagSave` 4960), „PDF“ (`lagerPdf` 7360: firm head,
 * title, location / type line, signatures — „Пописна комисија“ for the short list), and the admin selection with
 * „🗑 Избриши ја залихата на избраните“ (16998 / `lgDel` 17006).
 * FIX (LEGACY-MAP §7.4 item 1): quantities come from the corrected `stockAt`; the shipped legacy list showed 0 for
 * every item because of the swapped `stockAt` arguments.
 */
import Link from 'next/link';
import { and, eq } from 'drizzle-orm';
import { LAGER, lagerColumnTotal, lagerRows, lagerSummary, type LagerView } from '@wise/core';
import { lagerExportRows } from '@wise/core/parity-stock';
import { itemBarcodes } from '@wise/db';
import { db } from '@/lib/db';
import { canDo } from '@/lib/books';
import { stockPage, dateInYear, locOptions, pickLoc } from '@/lib/stock';
import { dmy, fmt, fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { ExportButtons, ServerPdfButton } from '@/components/doc-tools';
import { PrintHead, PrintSig } from '@/components/print-head';
import { PrintButton } from '@/components/stock-ui';
import { Importer } from '../uvoz/importer';
import { CheckAll, LgDelBar } from './lager-tools';

const TYPES: Record<string, string> = { goods: 'Стока (трговија)', material: 'Суровина / материјал', product: 'Готов производ' };
const IMP: [string, string][] = [['in', 'Приемница / почетна залиха (количина + набавна цена)'], ['pop', 'Попис – пописани количини (кусок / вишок)'], ['nivel', 'Нови малопродажни цени → нивелација']];

export type LagerSP = { wh?: string; d?: string; t?: string; q?: string; z?: string; imp?: string };

export async function LagerPage({ view, sp }: { view: LagerView; sp: LagerSP }) {
  const def = LAGER[view];
  const { u, firm, year, L } = await stockPage(view);
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
  const bcs = await db().select({ itemId: itemBarcodes.itemId, b: itemBarcodes.barcode }).from(itemBarcodes).where(and(eq(itemBarcodes.firmId, firm.id), eq(itemBarcodes.primary, true)));
  const bc = new Map(bcs.map((x) => [x.itemId, x.b]));
  const aoa = lagerExportRows(def.cols, rows.map((r) => ({ code: r.item.code, barcode: bc.get(r.item.id), name: r.item.name, unit: r.item.unit, type: r.item.type, values: def.cols.map((c) => c.value(r.item, r.s, W)) })));
  const admin = u.role === 'admin' && canDo(u, 'del', firm.id);
  const imp = sp.imp && IMP.some(([k]) => k === sp.imp) ? sp.imp : sp.imp !== undefined ? 'in' : '';
  const isStore = !!wh && L.locations.some((l) => l.id === wh && l.kind === 'store');
  const qs = (p: Record<string, string | undefined>) => '?' + new URLSearchParams(Object.entries({ wh: wh || undefined, d: date, t: type || undefined, q: q || undefined, z: zero ? '1' : undefined, ...p }).filter(([, x]) => x != null) as [string, string][]).toString();
  const sub = 'Состојба на ' + dmy(date) + ' · ' + (wh ? L.locName(wh) : 'сите објекти') + (type ? ' · ' + TYPES[type] : '');
  const fn = `${def.title.replace(/\s+/g, '_')}_${date}`;
  return (
    <>
      <Hd exp={false} t={def.title} sub={'состојба на ' + dmy(date)}>
        {canDo(u, 'impRun', firm.id) && <Link className="btn" href={'/' + view + qs({ imp: imp ? undefined : 'in' })}>Увоз од Excel / CSV</Link>}
        <ExportButtons name={fn} rows={aoa} sheet="Лагер" widths={aoa[0]!.map((_, i) => (i === 3 ? 38 : i === 2 ? 15 : 12))} />
        <ServerPdfButton title={def.title} landscape={!!def.land} />
        <PrintButton label="Печати" className="btn" />
      </Hd>
      {imp && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <div className="hd"><h2>Увоз од Excel / CSV во лагер листа</h2><Link className="btn sm" href={'/' + view + qs({})}>Затвори</Link></div>
          {!wh && <div className="callout warn">Прво изберете <b>објект</b> (магацин или продавница) горе во филтерот – увозот оди во еден објект.</div>}
          <fieldset className="fs" style={{ margin: 0 }}><legend>Што се увезува</legend>
            {IMP.map(([k, n]) => (k === 'nivel' && !isStore
              ? <div key={k} className="chk" style={{ display: 'block', margin: '5px 0', opacity: 0.55 }}>○ {n} <small className="mut">(само за продавница)</small></div>
              : <Link key={k} href={'/' + view + qs({ imp: k })} className="chk" style={{ display: 'block', margin: '5px 0' }}>{imp === k ? '●' : '○'} {n}</Link>))}
          </fieldset>
          <p className="note">Колони (ги препознава сам): <b>Шифра</b> или <b>Баркод</b>, Назив, {imp === 'in' ? <><b>Количина</b>, Набавна цена (или Износ/Вредност), МПЦ со ДДВ</> : imp === 'pop' ? <><b>Пописано</b> (или Количина)</> : <><b>МПЦ</b> (нова продажна цена со ДДВ)</>}. Датум на увозот: {dmy(date)}. Формат на броеви (1.234,56 или 1,234.56) се препознава автоматски. Непознатите шифри при приемница се креираат како нови артикли.</p>
          {wh && <Importer key={imp + wh} t={imp as 'in' | 'pop' | 'nivel'} locs={locOptions(L).map((l) => ({ id: l.id, name: l.name, kind: l.kind }))} date0={date} wh0={wh} />}
          <p className="mini"><Link href="/artQ">🧹 Анализа на артикли</Link> · за увозна фактура со добавувач, царина и трошоци користете <Link href="/uvozMat">Увоз → Увозна фактура со ставки</Link>.</p>
        </div>
      )}
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
        <>
          {admin && <LgDelBar wh={wh} whName={wh ? L.locName(wh) : ''} />}
          <div className="tw printarea" id="rpt">
            <PrintHead firm={firm} title={def.title.toUpperCase()} sub={sub} />
            <p className="mini noprint">{firm.name} · {def.title} · {sub}</p>
            <table style={def.dense ? { fontSize: '8.5px' } : undefined}>
              <thead><tr>{admin && <th className="noprint" style={{ width: 26 }}><CheckAll /></th>}<th>Р.б.</th><th>Шифра</th><th>Назив</th><th>Ед.</th>{def.cols.map((c) => <th key={c.label} className="n">{c.label}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.item.id}>
                    {admin && <td className="noprint"><input type="checkbox" name="lgs" value={r.item.id} form="lgDelForm" /></td>}
                    <td>{i + 1}</td><td>{r.item.code}</td><td>{r.item.name}</td><td>{r.item.unit}</td>
                    {def.cols.map((c) => <td key={c.label} className="n" style={c.kind === 'b' ? { minWidth: '22mm' } : undefined}>{fv(c.kind, c.value(r.item, r.s, W))}</td>)}
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>{admin && <td className="noprint" />}<td colSpan={4}>Вкупно ({rows.length} артикли)</td>{def.cols.map((c) => <td key={c.label} className="n">{c.sum ? fv(c.kind, lagerColumnTotal(rows, c, W)) : ''}</td>)}</tr></tfoot>
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
            <PrintSig who={[view === 'g_lagerk' ? 'Пописна комисија' : 'Составил', 'Одговорно лице']} />
          </div>
        </>
      ) : <div className="card empty">Нема артикли со залиха за избраниот ден.</div>}
    </>
  );
}
