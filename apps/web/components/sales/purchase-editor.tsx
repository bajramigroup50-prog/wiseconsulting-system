'use client';
/**
 * Purchase editor — legacy `purEditor` 4505, `purHeader` 4446, `readPurForm` 4557, `purCheckHTML` 4442,
 * landed costs (`COSTS`, `allocCosts` 4347), margin buttons (`applyMargin`), barcode scanning into the receipt.
 */
import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';
import { allocCosts, stockLineValue } from '@wise/core/stock';
import { addDays, CURRENCIES } from '@wise/core/sales';
import type { ActionState } from '@/lib/books';
import { fmt } from '@/lib/fmt';
import { savePurchaseAction } from '@/app/(app)/vlez/actions';
import { blankCost, COSTS, type EdPurchase, type EdStock } from './model';

export interface PurItemOpt { id: string; code: string | null; name: string; unit: string | null; rate: number; type: string; barcodes: string[]; sp: Record<string, number>; price: number; lastCost?: number }
export interface PurchaseEditorProps {
  initial: EdPurchase;
  title: string;
  partners: { id: string; code: string | null; name: string; edb: string | null }[];
  items: PurItemOpt[];
  locations: { id: string; code: string | null; name: string; kind: string }[];
  accounts: [string, string][];
  nonVat: boolean;
  defMargin: number;
  mgRound: number;
  back: string;
  scanInfo?: string;
  files: { id: string; name: string }[];
  nalogNo?: string | null;
}

const RATES = ['18', '10', '5', '0'];
const n = (v: unknown) => Number(String(v ?? '').replace(',', '.')) || 0;
const r2 = (x: number) => Math.round(x * 100) / 100;
const blankStock = (): EdStock => ({ itemId: '', name: '', code: '', barcode: '', unit: 'ком', qty: '1', price: '', rab: '', amount: '', cn: '', dep: '', sp: '', type: 'goods', rate: '18' });

export function PurchaseEditor(p: PurchaseEditorProps) {
  const [st, action, pending] = useActionState<ActionState, FormData>(savePurchaseAction, {});
  const [d, setD] = useState<EdPurchase>(p.initial);
  const [tab, setTab] = useState<'osn' | 'costs'>('osn');
  const [allowDup, setAllowDup] = useState(false);
  const [bc, setBc] = useState('');
  const set = (x: Partial<EdPurchase>) => setD((o) => ({ ...o, ...x }));
  const setG = (i: number, x: Partial<EdPurchase['groups'][number]>) => setD((o) => ({ ...o, groups: o.groups.map((g, k) => (k === i ? { ...g, ...x } : g)) }));
  const setS = (i: number, x: Partial<EdStock>) => setD((o) => ({ ...o, stock: o.stock.map((s, k) => (k === i ? { ...s, ...x } : s)) }));
  const setC = (k: string, x: Partial<EdPurchase['costs'][string]>) => setD((o) => ({ ...o, costs: { ...o.costs, [k]: { ...(o.costs[k] ?? blankCost()), ...x } } }));
  const itemById = useMemo(() => new Map(p.items.map((i) => [i.id, i])), [p.items]);
  const W = d.warehouseId || 'main';
  const store = p.locations.find((l) => l.id === d.warehouseId)?.kind === 'store';
  const stockItems = p.items.filter((i) => i.type !== 'service');

  const P = {
    imp: d.imp, fx: n(d.fx), distMode: d.distMode, cnames: d.cnames,
    costs: Object.fromEntries(Object.entries(d.costs).map(([k, c]) => [k, { amt: n(c.amount), fx: n(c.fx), byQty: c.byQty, lines: c.lines.map((l) => ({ base: n(l.base), rate: n(l.rate), vat: n(l.vat) })) }])),
    stock: d.stock.map((s) => ({ item: s.itemId, qty: n(s.qty), price: n(s.price), rab: n(s.rab), cn: s.cn === '' ? '' : n(s.cn), dep: s.dep === '' ? '' : n(s.dep) })),
  };
  const AL = allocCosts(P);
  const aSum = r2(AL.by.reduce((a, b) => a + b, 0));
  const gBase = r2(d.groups.reduce((a, g) => a + n(g.base), 0)), gVat = d.art32 ? 0 : r2(d.groups.reduce((a, g) => a + n(g.vat), 0));

  // legacy purCheckHTML: stock lines per rate vs booked groups
  const check = (() => {
    if (d.imp || d.ptype !== 'stock' || !d.stock.length) return null;
    const by: Record<number, number> = {}, G: Record<number, number> = {};
    for (const s of d.stock) { if (!n(s.qty)) continue; const rt = s.itemId ? itemById.get(s.itemId)?.rate ?? 18 : n(s.rate) || 18; by[rt] = (by[rt] ?? 0) + (n(s.amount) || n(s.qty) * n(s.price) * (1 - n(s.rab) / 100)); }
    for (const g of d.groups) G[n(g.rate)] = (G[n(g.rate)] ?? 0) + n(g.base);
    const rates = [...new Set([...Object.keys(by), ...Object.keys(G)].map(Number))].sort((a, b) => b - a);
    const bad = rates.filter((r) => Math.abs((by[r] ?? 0) - (G[r] ?? 0)) > 1);
    return { ok: !bad.length, rates, by, G };
  })();
  const groupsFromStock = () => {
    if (!check) return;
    const acc = d.groups[0]?.account || '6600';
    set({ groups: check.rates.filter((r) => check.by[r]).map((r) => ({ account: acc, rate: String(r), base: String(r2(check.by[r]!)), vat: d.art32 ? '0' : String(r2((check.by[r]! * r) / 100)) })) });
  };
  const applyMargin = (pct: number) => set({
    stock: d.stock.map((s, i) => {
      const qty = n(s.qty);
      if (!qty) return s;
      const nab = (stockLineValue(P, P.stock[i]!) + (AL.by[i] ?? 0)) / qty;
      const rate = s.itemId ? itemById.get(s.itemId)?.rate ?? 18 : n(s.rate) || 18;
      return { ...s, sp: String(r2(Math.round((nab * (1 + pct / 100) * (1 + rate / 100)) / p.mgRound) * p.mgRound)) };
    }),
  });
  const scan = () => {
    const v = bc.trim();
    if (!v) return;
    const it = p.items.find((i) => i.barcodes.includes(v) || (i.code ?? '').toLowerCase() === v.toLowerCase());
    setD((o) => {
      const S = [...o.stock];
      if (it) {
        const ex = S.findIndex((x) => x.itemId === it.id);
        if (ex >= 0) S[ex] = { ...S[ex]!, qty: String(n(S[ex]!.qty) + 1) };
        else S.push({ ...blankStock(), itemId: it.id, name: it.name, price: it.lastCost ? String(it.lastCost) : '', barcode: /^\d{8,}$/.test(v) ? v : '', type: it.type });
      } else S.push({ ...blankStock(), barcode: v });
      return { ...o, stock: S };
    });
    setBc('');
  };

  const pf = (k: string, l: string, o: { type?: string; w?: number } = {}) => (
    <label className="fl"><span>{l}</span><input type={o.type} value={d.data[k] ?? ''} style={o.w ? { maxWidth: o.w } : undefined} onChange={(e) => set({ data: { ...d.data, [k]: e.target.value } })} /></label>
  );
  const pOpts = <><option value="">— избери —</option>{p.partners.map((x) => <option key={x.id} value={x.id}>{x.code ? x.code + ' · ' : ''}{x.name}</option>)}</>;
  const kontoOpts = (cur: string) => <>{!p.accounts.some(([k]) => k === cur) && cur && <option value={cur}>{cur}</option>}{p.accounts.map(([k, nm]) => <option key={k} value={k}>{k} · {nm}</option>)}</>;
  const dupErr = st.error && /веќе е внесена|веќе е прикачен/.test(st.error);

  return (
    <form action={action}>
      <input type="hidden" name="payload" value={JSON.stringify({ ...d, allowDuplicate: allowDup, back: p.back })} />
      <div className="hd"><h1>{p.title}</h1><div className="row">
        <Link className="btn" href={p.back}>Откажи</Link>
        {d.id && d.ptype === 'stock' && <Link className="btn" href={`/print/kalk/${d.id}`} target="_blank">Калкулација (F2)</Link>}
        <button className="btn pri" disabled={pending}>Зачувај и прокнижи</button></div></div>
      {st.error && <div className="callout bad" role="alert">{st.error}{dupErr && <label className="chk" style={{ marginTop: 6 }}><input type="checkbox" checked={allowDup} onChange={(e) => setAllowDup(e.target.checked)} /> Сепак зачувај (не е дупликат)</label>}</div>}
      {p.scanInfo && <div className="callout good">{p.scanInfo}</div>}
      {d.shifted && <div className="callout info">Фактурата е од <b>{d.docDate.split('-').reverse().join('.')}</b>, но тој ДДВ период е веќе затворен. Затоа се книжи во тековниот период – датум на прием <b>{d.date.split('-').reverse().join('.')}</b>. <button type="button" className="btn sm" onClick={() => set({ date: d.docDate, shifted: false })}>Врати го датумот на документот</button></div>}
      {d.credit && <div className="callout warn">Документот е одобрение (CreditNote) – износите се со минус. За поврат на стока користете „Повратници / одобренија од добавувачи“.</div>}
      {d.status === 'pending' && <div className="callout warn">Внесено од клиентот – чека одобрување (не е прокнижено).</div>}
      <div className="card invhead">
        <div className="ftabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'osn'} onClick={() => setTab('osn')}>Основно</button>
          <button type="button" role="tab" aria-selected={tab === 'costs'} onClick={() => setTab('costs')}>Зависни трошоци{Object.values(d.costs).some((c) => n(c.amount)) ? ' •' : ''}</button>
          {d.imp && <span className="pill info" style={{ marginLeft: 'auto', alignSelf: 'center' }}>увозна</span>}
          {d.art32 && <span className="pill info" style={{ alignSelf: 'center' }}>чл. 32-а</span>}
        </div>
        <div className="fpane" hidden={tab !== 'osn'}><div className="igrid">
          <div className="fcol">
            <label className="fl b"><span>Број на фактура</span><input value={d.number} onChange={(e) => set({ number: e.target.value })} /></label>
            {d.ptype === 'stock' && <label className="fl"><span>Калкулација бр.</span><input value={d.calcNo} placeholder="автоматски" onChange={(e) => set({ calcNo: e.target.value })} /></label>}
            <label className="fl"><span>Налог</span><input value={p.nalogNo ? 'бр. ' + p.nalogNo : 'се доделува при зачувување'} disabled /></label>
            <label className="fl b"><span>Добавувач</span><select value={d.partnerId} onChange={(e) => set({ partnerId: e.target.value })}>{pOpts}</select></label>
            {!d.partnerId && <><label className="fl"><span>или нов добавувач</span><input value={d.supplierName} placeholder="назив (се додава во комитенти)" onChange={(e) => set({ supplierName: e.target.value })} /></label>
              <label className="fl"><span>ЕДБ на добавувач</span><input value={d.supplierEdb} onChange={(e) => set({ supplierEdb: e.target.value })} /></label></>}
            <label className="fl b"><span>Датум на прием (книжење)</span><input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} /></label>
            <label className="fl"><span>Датум на документот</span><input type="date" value={d.docDate} onChange={(e) => set({ docDate: e.target.value })} /></label>
            <label className="fl"><span>Валута (рок)</span><input type="date" value={d.due} onChange={(e) => set({ due: e.target.value })} /></label>
            <label className="fl"><span>Рок (дена)</span><input type="number" min={0} value={d.data.days ?? ''} style={{ maxWidth: 90 }} onChange={(e) => set({ data: { ...d.data, days: e.target.value }, ...(e.target.value !== '' ? { due: addDays(d.docDate || d.date, e.target.value) } : {}) })} /></label>
            {pf('oe', 'Орг. ед.', { w: 120 })}{pf('memo', 'Белешка')}
          </div>
          <div className="fcol">
            <fieldset className="fs"><legend>Вид</legend><div className="row">
              <label className="rb"><input type="radio" checked={!d.imp} onChange={() => set({ imp: false, currency: 'MKD', fx: '1' })} /> Домашна</label>
              <label className="rb"><input type="radio" checked={d.imp} onChange={() => set({ imp: true, cash: false, currency: d.currency === 'MKD' ? 'EUR' : d.currency })} /> Увозна (девизна)</label>
            </div></fieldset>
            {!d.imp && <fieldset className="fs"><legend>Плаќање</legend><div className="row">
              <label className="rb"><input type="radio" checked={!d.cash} onChange={() => set({ cash: false })} /> Вирман (добавувач)</label>
              <label className="rb"><input type="radio" checked={d.cash} onChange={() => set({ cash: true })} /> Готовина (фискална сметка)</label>
            </div></fieldset>}
            {d.imp && <>
              <label className="fl"><span>Конто добавувач</span><input value={d.supplierAccount} onChange={(e) => set({ supplierAccount: e.target.value })} style={{ maxWidth: 120 }} /></label>
              <div className="fl"><span>Валута / курс</span><div className="row" style={{ flexWrap: 'nowrap' }}>
                <select value={d.currency} style={{ maxWidth: 90 }} onChange={(e) => set({ currency: e.target.value })}>{CURRENCIES.filter((c) => c !== 'MKD').map((c) => <option key={c}>{c}</option>)}</select>
                <input type="number" step="any" value={d.fx} style={{ maxWidth: 110 }} aria-label="Курс" onChange={(e) => set({ fx: e.target.value })} /></div></div>
              {pf('ecd', 'ЕЦД (царинска декларација)')}
            </>}
            <label className="chk"><input type="checkbox" checked={d.art32} onChange={(e) => set({ art32: e.target.checked })} /> Член 32-а (пренесување на даночна обврска)</label>
            <label className="chk"><input type="checkbox" checked={d.noDed} onChange={(e) => set({ noDed: e.target.checked })} /> Без одбивање на претходен ДДВ (туристичка агенција, чл. 38)</label>
            {p.files.length > 0 && <div className="fl"><span>Документи</span><div className="row">{p.files.map((f) => <a key={f.id} className="pill info" href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">📎 {f.name}</a>)}</div></div>}
          </div>
        </div></div>
        <div className="fpane" hidden={tab !== 'costs'}>
          <p className="note">Зависни трошоци на набавката (царина, шпедиција, транспорт…): износ без ДДВ, документ, комитент и до три ДДВ реда. Се распоредуваат на артиклите по вредност (транспортот по количина ако е означено).</p>
          {COSTS.map(([k, nm]) => {
            const c = d.costs[k] ?? blankCost();
            return (
              <div key={k} className="costb">
                <div className="cb1"><b>{nm}</b>
                  <input type="number" step="any" value={c.amount} aria-label={nm + ' износ'} style={{ textAlign: 'right' }} onChange={(e) => setC(k, { amount: e.target.value })} />
                  <input value={c.doc} placeholder="документ" aria-label="Документ" onChange={(e) => setC(k, { doc: e.target.value })} />
                  {k === 'dev' && <label className="mini">Курс <input type="number" step="any" value={c.fx} style={{ width: 90, textAlign: 'right' }} onChange={(e) => setC(k, { fx: e.target.value })} /></label>}
                  <label className="mini">Датум <input type="date" value={c.date} onChange={(e) => setC(k, { date: e.target.value })} /></label>
                  <label className="mini">Валута <input type="date" value={c.due} onChange={(e) => setC(k, { due: e.target.value })} /></label>
                </div>
                <div className="cb2">
                  <label className="mini" style={{ flex: 1 }}>Комитент <select value={c.partnerId} onChange={(e) => setC(k, { partnerId: e.target.value })}>{pOpts}</select></label>
                  <label className="mini"><input type="checkbox" checked={c.foreign} onChange={(e) => setC(k, { foreign: e.target.checked })} /> странски</label>
                  {k === 'trans' && <label className="mini"><input type="checkbox" checked={c.byQty} onChange={(e) => setC(k, { byQty: e.target.checked })} /> по количина</label>}
                  {c.lines.map((l, i) => (
                    <span key={i} className="mini row" style={{ gap: 4 }}>ДДВ {i + 1}:
                      <input type="number" step="any" value={l.base} placeholder="основа" style={{ width: 100 }} onChange={(e) => setC(k, { lines: c.lines.map((x, j) => (j === i ? { ...x, base: e.target.value, vat: String(r2((n(e.target.value) * n(x.rate)) / 100)) } : x)) })} />
                      <select value={l.rate} style={{ width: 'auto' }} onChange={(e) => setC(k, { lines: c.lines.map((x, j) => (j === i ? { ...x, rate: e.target.value, vat: String(r2((n(x.base) * n(e.target.value)) / 100)) } : x)) })}>{RATES.map((r) => <option key={r}>{r}</option>)}</select>
                      <input type="number" step="any" value={l.vat} placeholder="ДДВ" style={{ width: 90 }} onChange={(e) => setC(k, { lines: c.lines.map((x, j) => (j === i ? { ...x, vat: e.target.value } : x)) })} />
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          {d.imp && <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <label className="mini">Распоред на царина <select value={d.distMode} style={{ width: 'auto' }} onChange={(e) => set({ distMode: e.target.value as EdPurchase['distMode'] })}>
              <option value="val">по вредност</option><option value="cn">по царински наименувања</option><option value="multi">по наименувања (царина и ДДВ)</option></select></label>
            {d.distMode !== 'val' && <span className="mini">Царина по наименување: {[0, 1, 2, 3, 4, 5].map((i) => <input key={i} type="number" step="any" value={d.cnames[i] ?? ''} style={{ width: 90 }} aria-label={`Наименување ${i + 1}`}
              onChange={(e) => { const c = [...d.cnames]; c[i] = e.target.value; set({ cnames: c }); }} />)}</span>}
          </div>}
        </div>
      </div>

      <div className="card" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}><b>Вид на фактура:</b>
        <button type="button" className={'btn sm' + (d.ptype === 'stock' ? ' pri' : '')} onClick={() => set({ ptype: 'stock' })}>Со приемница / калкулација (стока на залиха)</button>
        <button type="button" className={'btn sm' + (d.ptype === 'cost' ? ' pri' : '')} onClick={() => set({ ptype: 'cost' })}>Директен трошок (без артикли)</button>
        <span className="note">{d.ptype === 'cost' ? 'Услуги, струја, телефон, закупнина, гориво, канцелариски… – се книжи само на конто трошок + ДДВ, без приемница и калкулација.' : 'Стоката влегува на залиха во објектот и се прави калкулација (ПЛТ).'}</span></div>

      <h2>Книжење</h2>
      {check && (check.ok
        ? <div className="callout good" style={{ margin: '4px 0' }}>Контрола: ставките по стапки се совпаѓаат со книжењето ({check.rates.map((r) => r + '%: ' + fmt(check.G[r] ?? 0)).join(' · ')}).</div>
        : <div className="callout warn" style={{ margin: '4px 0' }}>Контрола: ставките не се совпаѓаат со книжењето – {check.rates.map((r) => `${r}%: ставки ${fmt(check.by[r] ?? 0)} / книжење ${fmt(check.G[r] ?? 0)}`).join(' · ')}. <button type="button" className="btn sm" onClick={groupsFromStock}>пресметај го книжењето од ставките</button></div>)}
      <div className="tw"><table><thead><tr><th>Конто</th><th>Стапка</th><th className="n">Основица</th><th className="n">ДДВ</th><th></th></tr></thead><tbody>
        {d.groups.map((g, i) => (
          <tr key={i}>
            <td><select value={g.account} onChange={(e) => setG(i, { account: e.target.value })}>{kontoOpts(g.account)}</select></td>
            <td><select value={g.rate} onChange={(e) => setG(i, { rate: e.target.value, ...(d.art32 ? {} : { vat: String(r2((n(g.base) * n(e.target.value)) / 100)) }) })}>{RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</select></td>
            <td><input type="number" step="any" value={g.base} style={{ textAlign: 'right' }} onChange={(e) => setG(i, { base: e.target.value, ...(d.art32 ? {} : { vat: String(r2((n(e.target.value) * n(g.rate)) / 100)) }) })} /></td>
            <td>{d.art32 ? <span className="num">{fmt((n(g.base) * (n(g.rate) || 18)) / 100)}</span> : <input type="number" step="any" value={g.vat} style={{ textAlign: 'right' }} onChange={(e) => setG(i, { vat: e.target.value })} />}</td>
            <td><button type="button" className="btn sm ghost danger" aria-label="Отстрани" onClick={() => set({ groups: d.groups.filter((_, k) => k !== i) })}>✕</button></td>
          </tr>))}
      </tbody><tfoot><tr><td colSpan={2}>Вкупно {fmt(gBase + gVat)}</td><td className="n">{fmt(gBase)}</td><td className="n">{fmt(gVat)}</td><td /></tr></tfoot></table></div>
      <div className="row"><button type="button" className="btn" onClick={() => set({ groups: [...d.groups, { account: d.groups.at(-1)?.account ?? '4000', rate: '18', base: '', vat: '' }] })}>+ Ред</button></div>

      {d.ptype === 'stock' && <>
        <h2>Приемница</h2>
        <label className="f" style={{ maxWidth: 360 }}>Прием во објект<select value={d.warehouseId} onChange={(e) => set({ warehouseId: e.target.value })}><option value="">01 Главен магацин</option>{p.locations.map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}</select></label>
        {d.stock.some((s) => !s.itemId && s.name) && <div className="callout warn">{d.stock.filter((s) => !s.itemId && s.name).length} артикли од фактурата ги нема во шифрарникот – ќе се додадат автоматски при зачувување.</div>}
        {d.stock.length > 0 && <div className="card calcbar"><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn sm" onClick={() => set({ stock: d.stock.map((s, i) => ({ ...s, dep: String(AL.by[i] ?? 0) })) })}>Распоред на трошоци (F5)</button>
          {d.stock.some((s) => s.dep !== '') && <button type="button" className="btn sm" onClick={() => set({ stock: d.stock.map((s) => ({ ...s, dep: '' })) })}>Автоматски распоред</button>}
          <span className="mini" style={{ marginLeft: 8 }}>Разлика во цена за сите:</span>
          {[10, 15, 20, 25, 30, 40, 50].map((v) => <button key={v} type="button" className={'btn sm' + (p.defMargin === v ? ' pri' : '')} onClick={() => applyMargin(v)}>{v}%</button>)}
        </div>{AL.manual && Math.abs(aSum - AL.tot) > 0.5 && <div className="callout warn" style={{ marginTop: 8 }}>Распоредените трошоци ({fmt(aSum)}) не се еднакви на вкупните трошоци ({fmt(AL.tot)}).</div>}</div>}
        <div className="tw"><table><thead><tr><th>Артикл</th><th>Ед. мерка</th><th className="n">Количина</th><th className="n">{d.imp ? 'Цена во ' + d.currency : 'Набавна цена / ед.'}</th><th className="n">Рабат %</th><th className="n">Вредност ден.</th><th className="n">Зависни трошоци</th><th className="n">Набавна цена / ед.</th>{d.imp && <th className="n">ДДВ царина</th>}<th className="n">{store ? 'Малопр. цена со ДДВ' : 'Продажна цена со ДДВ'}</th><th className="n">Разлика %</th><th></th></tr></thead><tbody>
          {d.stock.map((s, i) => {
            const it = s.itemId ? itemById.get(s.itemId) : undefined;
            const v = stockLineValue(P, P.stock[i]!), a = AL.by[i] ?? 0, nab = n(s.qty) ? (v + a) / n(s.qty) : 0;
            const rate = it?.rate ?? (n(s.rate) || 18);
            const spv = s.sp !== '' ? n(s.sp) : it ? (it.sp[W] ?? r2(it.price * (1 + rate / 100))) : 0;
            const net = spv / (1 + rate / 100);
            const mg = nab && net ? ((net - nab) / nab) * 100 : null;
            return (
              <tr key={i}>
                <td><select value={s.itemId} style={{ minWidth: 230 }} onChange={(e) => { const x = itemById.get(e.target.value); setS(i, { itemId: e.target.value, ...(x ? { type: x.type } : {}) }); }}>
                  <option value="">— {s.name || 'избери'} —{!s.itemId && s.name ? ' (нов)' : ''}</option>
                  {stockItems.map((x) => <option key={x.id} value={x.id}>{x.code ? x.code + ' · ' : ''}{x.name}</option>)}</select>
                  {!s.itemId && <input value={s.name} placeholder="или назив на нов артикл" onChange={(e) => setS(i, { name: e.target.value })} style={{ marginTop: 3 }} />}
                  <br /><select value={s.type || it?.type || 'goods'} className="stype" title="Вид – на кое конто оди" style={{ width: 'auto', marginTop: 3, fontSize: 12, padding: '2px 4px' }} onChange={(e) => setS(i, { type: e.target.value })}>
                    <option value="goods">Стока за продажба</option><option value="material">Суровина / материјал</option><option value="product">Готов производ</option></select>
                  {(s.code || s.barcode) && <><br /><small className="note">шифра доб.: {s.code || '—'}{s.barcode && ' · баркод ' + s.barcode}{it && ' · наша: ' + (it.code ?? '')}</small></>}</td>
                <td>{it ? it.unit : <input value={s.unit} style={{ width: 64 }} onChange={(e) => setS(i, { unit: e.target.value })} />}</td>
                <td><input type="number" step="any" value={s.qty} style={{ textAlign: 'right', width: 90 }} onChange={(e) => setS(i, { qty: e.target.value, ...(n(s.amount) && n(e.target.value) ? { price: String(Math.round((n(s.amount) / n(e.target.value)) * 1e4) / 1e4) } : {}) })} /></td>
                <td><input type="number" step="any" value={s.price} style={{ textAlign: 'right', width: 110 }} onChange={(e) => setS(i, { price: e.target.value })} /></td>
                <td><input type="number" step="any" value={s.rab} style={{ textAlign: 'right', width: 70 }} onChange={(e) => setS(i, { rab: e.target.value })} /></td>
                <td className="n">{fmt(v)}</td>
                <td className="n">{AL.manual ? <input type="number" step="any" value={s.dep} style={{ textAlign: 'right', width: 110 }} onChange={(e) => setS(i, { dep: e.target.value })} /> : fmt(a)}</td>
                <td className="n">{n(s.qty) ? nab.toFixed(4) : '—'}</td>
                {d.imp && <td className="n">{fmt(AL.cvat[i] ?? 0)}</td>}
                <td><input type="number" step="any" value={s.sp !== '' ? s.sp : spv ? String(spv) : ''} style={{ textAlign: 'right', width: 110 }} title="Се зачувува како нова продажна цена" onChange={(e) => setS(i, { sp: e.target.value })} /></td>
                <td className="n">{mg == null ? '—' : mg.toFixed(2)}</td>
                <td><button type="button" className="btn sm ghost danger" aria-label="Отстрани" onClick={() => set({ stock: d.stock.filter((_, k) => k !== i) })}>✕</button></td>
              </tr>);
          })}
        </tbody><tfoot><tr><td colSpan={5}>Вкупно</td><td className="n">{fmt(P.stock.reduce((t, s) => t + stockLineValue(P, s), 0))}</td><td className="n">{fmt(aSum)}</td><td />{d.imp && <td className="n">{fmt(AL.cvat.reduce((a, b) => a + b, 0))}</td>}<td colSpan={3} /></tr></tfoot></table></div>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={() => set({ stock: [...d.stock, blankStock()] })}>+ Артикл на залиха</button>
          <input value={bc} placeholder="📷 Скенирај баркод / шифра + Enter (секое скенирање = +1)" style={{ width: 340 }} autoComplete="off" onChange={(e) => setBc(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); scan(); } }} />
        </div>
      </>}
      {p.nonVat && <div className="note">Фирмата не е ДДВ обврзник: ДДВ влегува во трошокот и не се одбива.</div>}
    </form>
  );
}
