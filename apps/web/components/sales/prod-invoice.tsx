'use client';
/**
 * „🏭 Фактура од производство“ — the parts of the invoice editor for a production invoice (new; the custom
 * manufacturing workflow, e.g. „ТЕРАСА ПЕРГОЛА“ where dimensions and costs differ every time):
 * - `WorkOrderBox`: „Работен налог / период“ — an earlier work order of the firm or a new one (number, period from–to);
 * - `MainProductCard`: the main product typed on the spot (name, specification, dimensions → m² / m³ quantity, unit,
 *   quantity, sale price), created as a finished-product article („✓ Креирај го производот“, an existing product with
 *   the same name is reused, a different name makes a new variant); once it exists, the „Калкулација на производство“
 *   with the invoice header data, materials from stock, labour, other direct costs, overhead % and the margin.
 */
import Link from 'next/link';
import { qtyFromSpec, specText, specUnit, workOrderLabel, type ProdBom } from '@wise/core/sales';
import { fmt, fq } from '@/lib/fmt';
import { blankSpec, type EdLine, type EdLineProd, type EdSpec } from './model';
import { LineProdPanel } from './prod-panel';
import type { InvItemOpt } from './invoice-editor';

type Stock = Record<string, Record<string, number>>;
export interface WorkOrderOpt { number: string; from: string; to: string; invoices: number }

const monthOf = (date: string) => {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${date.slice(0, 7)}-01`, to: `${date.slice(0, 7)}-${String(last).padStart(2, '0')}` };
};

/** „Работен налог / период“: pick an earlier work order of the firm or open a new one. Values live in `data.woNo/woFrom/woTo`. */
export function WorkOrderBox({ data, date, list, next, onChange }: {
  data: Record<string, string>; date: string; list: readonly WorkOrderOpt[]; next: string;
  onChange: (x: { woNo: string; woFrom: string; woTo: string }) => void;
}) {
  const no = data.woNo ?? '';
  const sel = !no ? '' : list.some((w) => w.number === no) ? no : '__new';
  return (
    <fieldset className="fs" data-testid="work-order"><legend>Работен налог / период</legend>
      <label className="fl b"><span>Налог</span><select value={sel} aria-label="Работен налог" onChange={(e) => {
        const v = e.target.value;
        if (!v) onChange({ woNo: '', woFrom: '', woTo: '' });
        else if (v === '__new') { const M = monthOf(date); onChange({ woNo: next, woFrom: M.from, woTo: M.to }); }
        else { const w = list.find((x) => x.number === v)!; onChange({ woNo: w.number, woFrom: w.from, woTo: w.to }); }
      }}>
        <option value="">— без работен налог (се нумерира автоматски) —</option>
        <option value="__new">➕ Нов работен налог</option>
        {list.map((w) => <option key={w.number} value={w.number}>{workOrderLabel(w)}{w.invoices ? ` · ${w.invoices} ф-ри` : ''}</option>)}
      </select></label>
      {sel && <>
        <label className="fl"><span>Број на налог</span><input value={no} aria-label="Број на работен налог" onChange={(e) => onChange({ woNo: e.target.value, woFrom: data.woFrom ?? '', woTo: data.woTo ?? '' })} /></label>
        <label className="fl"><span>Период од – до</span><div className="row" style={{ flexWrap: 'nowrap' }}>
          <input type="date" value={data.woFrom ?? ''} aria-label="Период од" onChange={(e) => onChange({ woNo: no, woFrom: e.target.value, woTo: data.woTo ?? '' })} />
          <input type="date" value={data.woTo ?? ''} aria-label="Период до" onChange={(e) => onChange({ woNo: no, woFrom: data.woFrom ?? '', woTo: e.target.value })} />
        </div></label>
        {(data.woFrom && date < data.woFrom) || (data.woTo && date > data.woTo) ? <small className="note" style={{ color: 'var(--bad)' }}>⚠ Датумот на фактурата е надвор од периодот на налогот.</small> : null}
      </>}
    </fieldset>
  );
}

export interface MainHead { number: string; date: string; partner: string; currency: string; fx: string; workOrder: string }

export function MainProductCard({ k, line, items, stock, avg, boms, locations, fx, cur, head, rates, vatLocked, onLine, onProd, onCreate, creating, onRemove, orderNo, printHref }: {
  k: number; line: EdLine; items: readonly InvItemOpt[]; stock: Stock; avg: Stock; boms: Readonly<Record<string, ProdBom>>;
  locations: { id: string; code: string | null; name: string }[]; fx: number; cur: string; head: MainHead; rates: readonly string[]; vatLocked: boolean;
  /** The line's name / unit / quantity / price / VAT changed. */
  onLine: (x: Partial<EdLine>) => void; onProd: (p: EdLineProd) => void;
  onCreate: () => void; creating: boolean; onRemove: (() => void) | null; orderNo: string | null; printHref: string | null;
}) {
  const P = line.prod!;
  const S: EdSpec = P.spec ?? blankSpec();
  const it = line.itemId ? items.find((i) => i.id === line.itemId) : undefined;
  const isProduct = !!it && it.type !== 'service';
  const setSpec = (x: Partial<EdSpec>) => {
    const s = { ...S, ...x };
    const q = qtyFromSpec(s);
    onProd({ ...P, spec: s });
    // the dimensions give the quantity (and its unit) of the invoice line
    if (q != null) onLine({ qty: String(q), unit: specUnit(s.mode) ?? line.unit });
    else if (x.mode !== undefined && specUnit(x.mode) == null && ['m²', 'm³', 'm'].includes(line.unit)) onLine({ unit: 'ком' });
  };
  const q = qtyFromSpec(S);
  const amt = (Number(line.qty) || 0) * (Number(line.price) || 0) * (1 - (Number(line.disc) || 0) / 100);
  const dim = (key: 'l' | 'w' | 'h', label: string, on: boolean) => (
    <label className="f" style={{ maxWidth: 90, opacity: on ? 1 : 0.5 }}>{label}<input type="number" step="any" min={0} value={S[key]} aria-label={label} disabled={!on} style={{ textAlign: 'right' }} onChange={(e) => setSpec({ [key]: e.target.value })} /></label>
  );
  return (
    <div className="card mainprod" data-testid="main-product" style={{ padding: 12, marginTop: 8, borderLeft: '4px solid var(--accent)' }}>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>🏭 Главен производ{k ? ' ' + (k + 1) : ''}</h3>
        {isProduct ? <span className="pill good">производ{it.code ? ' · шифра ' + it.code : ''}</span> : <span className="pill warn">нов – уште не е креиран</span>}
        {orderNo && <Link className="pill info" href="/prod">Налог за производство бр. {orderNo}</Link>}
        <span style={{ flex: 1 }} />
        {printHref && <Link className="btn sm" href={printHref} target="_blank">🖨 Калкулација</Link>}
        {onRemove && <button type="button" className="btn sm ghost danger" aria-label="Отстрани главен производ" onClick={onRemove}>✕</button>}
      </div>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end', marginTop: 6 }}>
        <label className="f" style={{ flex: '2 1 260px' }}>Назив на производот<input value={line.name} list="prodNameList" aria-label="Назив на главниот производ" placeholder="пр. ТЕРАСА ПЕРГОЛА" onChange={(e) => onLine({ name: e.target.value })} /></label>
        <label className="f" style={{ flex: '3 1 300px' }}>Спецификација / опис<input value={S.text} aria-label="Спецификација" placeholder="материјал, боја, изведба…" onChange={(e) => setSpec({ text: e.target.value })} /></label>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end', marginTop: 6 }}>
        <label className="f" style={{ maxWidth: 170 }}>Количина по<select value={S.mode} aria-label="Количина по димензии" onChange={(e) => setSpec({ mode: e.target.value as EdSpec['mode'] })}>
          <option value="">рачно (парчиња…)</option><option value="m2">m² = Д × Ш</option><option value="m3">m³ = Д × Ш × В</option><option value="m">m = должина</option></select></label>
        {dim('l', 'Должина (m)', true)}{dim('w', 'Ширина (m)', S.mode !== 'm')}{dim('h', 'Висина (m)', S.mode === '' || S.mode === 'm3')}
        <label className="f" style={{ maxWidth: 80 }}>Парчиња<input type="number" step="any" min={0} value={S.pcs} aria-label="Парчиња" placeholder="1" style={{ textAlign: 'right' }} onChange={(e) => setSpec({ pcs: e.target.value })} /></label>
        {q != null && <span className="pill info" style={{ marginBottom: 6 }}>= {fq(q)} {specUnit(S.mode)}</span>}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end', marginTop: 6 }}>
        <label className="f" style={{ maxWidth: 80 }}>Ед. мерка<input value={line.unit} aria-label="Единица мерка" onChange={(e) => onLine({ unit: e.target.value })} /></label>
        <label className="f" style={{ maxWidth: 110 }}>Количина<input type="number" step="any" value={line.qty} aria-label="Количина главен производ" style={{ textAlign: 'right' }} onChange={(e) => onLine({ qty: e.target.value })} /></label>
        <label className="f" style={{ maxWidth: 140 }}>Продажна цена без ДДВ{cur !== 'ден.' ? ` (${cur})` : ''}<input type="number" step="any" value={line.price} aria-label="Продажна цена главен производ" style={{ textAlign: 'right' }} onChange={(e) => onLine({ price: e.target.value })} /></label>
        <label className="f" style={{ maxWidth: 80 }}>Рабат %<input type="number" step="any" value={line.disc} aria-label="Рабат главен производ" style={{ textAlign: 'right' }} onChange={(e) => onLine({ disc: e.target.value })} /></label>
        <label className="f" style={{ maxWidth: 90 }}>ДДВ<select value={line.rate} disabled={vatLocked} aria-label="ДДВ главен производ" onChange={(e) => onLine({ rate: e.target.value })}>{rates.map((r) => <option key={r} value={r}>{r}%</option>)}</select></label>
        <span className="pill" style={{ marginBottom: 6 }}>Износ <b className="num">{fmt(amt)}</b> {cur}</span>
      </div>
      {specText(S) && <small className="note">На фактурата: „{line.name.trim() || '…'} – {specText(S)}“</small>}
      {!isProduct
        ? <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 8 }}>
          <button type="button" className="btn pri" disabled={creating || !line.name.trim()} onClick={onCreate}>{creating ? 'Се креира…' : `✓ Креирај го производот${line.name.trim() ? ` „${line.name.trim()}“` : ''}`}</button>
          <small className="note">Се креира готов производ (тип <b>производ</b>) без претходен внес во шифрарник. Постоечки производ со ист назив се поврзува; за нова варијанта сменете го називот (пр. „ТЕРАСА ПЕРГОЛА 4×3“). Потоа се отвора калкулацијата.</small>
        </div>
        : <>
          <h4 style={{ margin: '12px 0 4px' }}>Калкулација на производство</h4>
          <div className="mini" data-testid="calc-head" style={{ padding: '4px 8px', borderRadius: 6, background: 'var(--accent-soft)' }}>
            Фактура бр. <b>{head.number || '—'}</b> · датум <b>{head.date ? head.date.split('-').reverse().join('.') : '—'}</b> · комитент <b>{head.partner || '—'}</b>
            {head.currency !== 'MKD' ? <> · валута {head.currency}, курс <b>{head.fx}</b></> : <> · денари</>}
            {head.workOrder ? <> · <b>{head.workOrder}</b></> : null}
          </div>
          <LineProdPanel line={line} items={items} stock={stock} avg={avg} boms={boms} locations={locations} fx={fx} cur={cur}
            onChange={onProd} onCreate={onCreate} creating={creating} orderNo={orderNo} />
          <small className="note">Производот сега се произведува – залихата на готовиот производ (0) не е пречка: при зачувување прво се заприма по цената на чинење, а фактурата потоа го продава.</small>
        </>}
    </div>
  );
}
