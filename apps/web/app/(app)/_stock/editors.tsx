'use client';
/**
 * Client editors of the stock documents: transfer (legacy `VIEWS.prenosi` draft + `prRead`), levelling (`nivelHTML`),
 * stock count / write-off (`moEditor`), POS cart (`VIEWS.kasa`), fiscal report (`fiskPer` manual entry) and BOM
 * (`VIEWS.normativ`). One React state per editor; the server action receives a JSON payload.
 *
 * FIX (LEGACY-MAP §7.4 item 2): legacy had two global `function prRead` declarations — the AOP rules editor (7703)
 * replaced the transfer form reader (5553), so date, locations, quantities and prices typed into a transfer were never
 * read into the draft. Here each editor owns its state; there is no shared global reader to collide.
 */
import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';
import type { ActionState } from '@/lib/books';
import { fmt, fq } from '@/lib/fmt';
import { posSellAction, saveBomAction, saveFiskAction, saveLevellingAction, saveStockCountAction, saveTransferAction } from './actions';

export interface ItemOpt {
  id: string;
  code: string;
  name: string;
  unit: string;
  type: string;
  rate: number;
  /** Retail price incl. VAT per location id. */
  sp: Record<string, number>;
  /** Stock per location id (today). */
  have: Record<string, number>;
  /** Average cost (all locations). */
  avg: number;
  /** Average cost per location id (legacy `prAvg`: cost at the source of a transfer). */
  avgBy?: Record<string, number>;
}
export interface LocOpt { id: string; name: string; kind: 'warehouse' | 'store' }

const n = (s: string | number | null | undefined) => {
  const x = Number(String(s ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(x) ? x : 0;
};
const label = (i: ItemOpt) => (i.code ? i.code + ' · ' : '') + i.name;

function Err({ st }: { st: ActionState }) {
  return st.error ? <div className="callout bad" role="alert">{st.error}</div> : st.ok ? <div className="callout good">{st.ok}</div> : null;
}

function ItemPicker({ items, onPick, filter }: { items: ItemOpt[]; onPick: (it: ItemOpt) => void; filter?: (i: ItemOpt) => boolean }) {
  const [q, setQ] = useState('');
  const L = items.filter((i) => !filter || filter(i));
  const pick = (v: string) => {
    const s = v.trim().toLowerCase();
    if (!s) return;
    const it = L.find((i) => label(i).toLowerCase() === s) ?? L.find((i) => i.code.toLowerCase() === s) ?? (L.filter((i) => i.name.toLowerCase().includes(s)).length === 1 ? L.find((i) => i.name.toLowerCase().includes(s)) : undefined);
    if (it) {
      onPick(it);
      setQ('');
    }
  };
  return (
    <label className="f" style={{ minWidth: 280 }}>Додај артикл (шифра, назив)
      <input list="stockItems" value={q} onChange={(e) => { setQ(e.target.value); if (L.some((i) => label(i) === e.target.value)) pick(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); pick(q); } }} placeholder="🔍" />
      <datalist id="stockItems">{L.map((i) => <option key={i.id} value={label(i)} />)}</datalist>
    </label>
  );
}

/* ================================================================== transfer */

export interface TransferDraft { id?: string; number?: string; date: string; from: string; to: string; note: string; lines: { itemId: string; qty: string; sp: string }[] }
/** A purchase calculation offered in „Додај ги артиклите од калкулација“ (legacy `pr_calc`). */
export interface CalcOpt { id: string; wh: string; date: string; label: string; lines: { item: string; qty: number; sp: string | number }[] }

const MARGINS = [10, 15, 20, 25, 30, 40, 50];
const ROUNDS: [string, string][] = [['1', 'на цел денар'], ['0.5', 'на 0,50'], ['10', 'на 10 ден.'], ['0.01', 'без']];

/** Legacy `prMargin`: retail price = average × (1 + margin) × (1 + VAT), rounded (below 5 steps: to 0.01). */
const marginPrice = (avg: number, rate: number, m: number, step: number) => {
  if (!(avg > 0)) return null;
  const sp = avg * (1 + m / 100) * (1 + rate / 100);
  const rr = sp < step * 5 ? 0.01 : step;
  return Math.round(Math.round(sp / rr) * rr * 100) / 100;
};

export function TransferEditor({ initial, items, locs, calcs = [], nextNo, round = '1' }: { initial: TransferDraft; items: ItemOpt[]; locs: LocOpt[]; calcs?: CalcOpt[]; nextNo?: string; round?: string }) {
  const [st, action, pending] = useActionState<ActionState, FormData>(saveTransferAction, {});
  const [d, setD] = useState(initial);
  const [mg, setMg] = useState('');
  const [rd, setRd] = useState(ROUNDS.some(([v]) => v === round) ? round : '1');
  const [msg, setMsg] = useState('');
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const set = (p: Partial<TransferDraft>) => setD((x) => ({ ...x, ...p }));
  const setLine = (i: number, p: Partial<TransferDraft['lines'][number]>) => setD((x) => ({ ...x, lines: x.lines.map((l, k) => (k === i ? { ...l, ...p } : l)) }));
  const avgOf = (it: ItemOpt | undefined) => (it ? it.avgBy?.[d.from] || it.avg || 0 : 0);
  const spOf = (l: TransferDraft['lines'][number], it: ItemOpt | undefined) => (l.sp === '' ? it?.sp[d.to] ?? 0 : n(l.sp));
  let nab = 0;
  let spv = 0;
  for (const l of d.lines) {
    const it = byId.get(l.itemId);
    nab += n(l.qty) * avgOf(it);
    spv += n(l.qty) * spOf(l, it);
  }
  const addCalc = (id: string) => {
    const c = calcs.find((x) => x.id === id);
    if (!c) return;
    const L = [...d.lines];
    for (const s of c.lines) {
      const it = byId.get(s.item);
      if (!it || !n(s.qty)) continue;
      const q = Math.max(0, Math.min(n(s.qty), it.have[d.from] ?? 0));
      const ex = L.find((l) => l.itemId === s.item);
      if (ex) { ex.qty = String(Math.round((n(ex.qty) + q) * 10000) / 10000); continue; }
      const cur = it.sp[d.to];
      L.push({ itemId: s.item, qty: String(Math.round(q * 10000) / 10000), sp: cur ? String(cur) : s.sp !== '' && s.sp != null ? String(s.sp) : '' });
    }
    set({ lines: L });
  };
  const applyMargin = (m: number) => {
    if (!Number.isFinite(m)) { setMsg('Внесете процент.'); return; }
    set({ lines: d.lines.map((l) => { const it = byId.get(l.itemId); const p = marginPrice(avgOf(it), it?.rate ?? 18, m, n(rd) || 1); return p == null ? l : { ...l, sp: String(p) }; }) });
    setMsg(`Малопродажните цени се пресметани со ${m}% разлика.`);
  };
  const payload = { id: d.id ?? null, date: d.date, from: d.from, to: d.to, note: d.note, lines: d.lines.filter((l) => n(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: n(l.qty), sp: l.sp === '' ? null : n(l.sp) })) };
  const fromCalcs = calcs.filter((c) => c.wh === d.from);
  return (
    <form action={action} className="card">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <h2>{d.id ? 'Преносница ' + d.number : 'Нова преносница'} <span className="mini">магацин → продавница</span></h2>
      <Err st={st} />
      <div className="form">
        <label className="f">Датум<input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} required /></label>
        <label className="f">Од магацин<select value={d.from} onChange={(e) => set({ from: e.target.value })}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}{l.kind === 'store' ? ' · продавница' : ''}</option>)}</select></label>
        <label className="f">Во продавница<select value={d.to} onChange={(e) => set({ to: e.target.value })}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}{l.kind === 'warehouse' ? ' · магацин' : ''}</option>)}</select></label>
        <label className="f">Број<input value={d.number ?? nextNo ?? ''} disabled /></label>
        <label className="f wide">Забелешка<input value={d.note} onChange={(e) => set({ note: e.target.value })} /></label>
      </div>
      <div className="row" style={{ marginTop: 10, gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <label className="mini">Додај ги артиклите од калкулација
          <select value="" onChange={(e) => addCalc(e.target.value)} style={{ width: 'auto' }}>
            <option value="">— изберете калкулација —</option>
            {fromCalcs.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <ItemPicker items={items} onPick={(it) => { if (!d.lines.some((l) => l.itemId === it.id)) set({ lines: [...d.lines, { itemId: it.id, qty: '', sp: '' }] }); }} />
        <button type="button" className="btn sm" onClick={() => set({ lines: [...d.lines, ...items.filter((i) => (i.have[d.from] ?? 0) > 1e-9 && !d.lines.some((l) => l.itemId === i.id)).map((i) => ({ itemId: i.id, qty: String(i.have[d.from]), sp: '' }))] })}>Целата залиха од магацинот</button>
      </div>
      <div className="row" style={{ gap: 6, margin: '10px 0 8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="mini">Малопродажна цена = набавна + разлика:</span>
        {MARGINS.map((v) => <button key={v} type="button" className="btn sm" onClick={() => applyMargin(v)}>{v}%</button>)}
        <input value={mg} onChange={(e) => setMg(e.target.value)} inputMode="decimal" placeholder="%" style={{ width: 64 }} />
        <button type="button" className="btn sm" onClick={() => applyMargin(n(mg))}>Примени</button>
        <label className="mini">Заокружи <select value={rd} onChange={(e) => setRd(e.target.value)} style={{ width: 'auto' }}>{ROUNDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
        <button type="button" className="btn sm" title="Постоечка цена во продавницата" onClick={() => set({ lines: d.lines.map((l) => ({ ...l, sp: String(byId.get(l.itemId)?.sp[d.to] ?? '') })) })}>Задржи постоечки цени</button>
        {msg && <span className="pill good">{msg}</span>}
      </div>
      {d.lines.length ? (
        <div className="tw"><table>
          <thead><tr><th>Шифра</th><th>Назив</th><th>Ем</th><th className="n">Залиха во магацин</th><th className="n">Количина</th><th className="n">Набавна цена</th><th className="n">Набавна вредност</th><th className="n">ДДВ</th><th className="n">МПЦ со ДДВ</th><th className="n">Продажна вредност</th><th className="n">Разлика</th><th /></tr></thead>
          <tbody>
            {d.lines.map((l, i) => {
              const it = byId.get(l.itemId);
              const sp = spOf(l, it);
              const have = it?.have[d.from] ?? 0;
              const avg = avgOf(it);
              const rate = it?.rate ?? 18;
              const net = sp / (1 + rate / 100);
              const m = avg ? (net / avg - 1) * 100 : null;
              return (
                <tr key={i}>
                  <td>{it?.code}</td><td>{it?.name ?? '?'}</td><td>{it?.unit}</td>
                  <td className={'n' + (n(l.qty) > have + 1e-9 ? ' bad' : '')} style={n(l.qty) > have + 1e-9 ? { color: 'var(--bad)' } : undefined}>{fq(have)}</td>
                  <td><input inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} style={{ width: 90, textAlign: 'right' }} /></td>
                  <td className="n">{avg.toFixed(4).replace('.', ',')}</td>
                  <td className="n">{fmt(avg * n(l.qty))}</td>
                  <td className="n">{rate}%</td>
                  <td><input inputMode="decimal" value={l.sp} placeholder={fmt(it?.sp[d.to] ?? 0)} onChange={(e) => setLine(i, { sp: e.target.value })} style={{ width: 100, textAlign: 'right' }} /></td>
                  <td className="n">{fmt(n(l.qty) * sp)}</td>
                  <td className="n">{m == null ? '—' : m.toFixed(1) + '%'}</td>
                  <td><button type="button" className="btn sm ghost danger" onClick={() => set({ lines: d.lines.filter((_, k) => k !== i) })} aria-label="Отстрани">✕</button></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr><td colSpan={6}>Вкупно</td><td className="n">{fmt(nab)}</td><td /><td /><td className="n">{fmt(spv)}</td><td /><td /></tr></tfoot>
        </table></div>
      ) : <p className="note">Додајте артикли од калкулација или поединечно.</p>}
      <p className="note">Магацинот се раздолжува по просечна набавна цена на денот; продавницата се задолжува по истата набавна вредност. Празна МПЦ = тековната цена во продавницата; внесената МПЦ станува нова цена на артиклот во продавницата.</p>
      <div className="row">
        <Link className="btn" href="/prenosi">Откажи</Link>
        <button className="btn pri" disabled={pending}>Зачувај пренос</button>
      </div>
    </form>
  );
}

/* ================================================================== levelling */

export interface LevellingDraft { id?: string; number?: string; date: string; wh: string; note: string; promoTo: string; prices: Record<string, string> }

export function LevellingEditor({ initial, items, locs }: { initial: LevellingDraft; items: ItemOpt[]; locs: LocOpt[] }) {
  const [st, action, pending] = useActionState<ActionState, FormData>(saveLevellingAction, {});
  const [d, setD] = useState(initial);
  const [q, setQ] = useState('');
  const set = (p: Partial<LevellingDraft>) => setD((x) => ({ ...x, ...p }));
  const shown = items.filter((i) => i.type !== 'service' && (d.prices[i.id] !== undefined || (i.have[d.wh] ?? 0) !== 0 || q) && (!q || label(i).toLowerCase().includes(q.toLowerCase())));
  let diff = 0;
  for (const [id, v] of Object.entries(d.prices)) {
    const it = items.find((i) => i.id === id);
    if (it && v !== '') diff += (it.have[d.wh] ?? 0) * (n(v) - (it.sp[d.wh] ?? 0));
  }
  const payload = { id: d.id ?? null, date: d.date, wh: d.wh, note: d.note, promoTo: d.promoTo || null, prices: Object.fromEntries(Object.entries(d.prices).filter(([, v]) => v !== '').map(([k, v]) => [k, n(v)])) };
  return (
    <form action={action} className="card">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <h2>{d.id ? 'Корекција на нивелација ' + d.number : 'Нова нивелација'}</h2>
      <Err st={st} />
      <div className="form">
        <label className="f">Датум<input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} required /></label>
        <label className="f">Објект<select value={d.wh} onChange={(e) => set({ wh: e.target.value, prices: {} })} disabled={!!d.id}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        {!d.id && <label className="f">Акција важи до (враќање на цените)<input type="date" value={d.promoTo} onChange={(e) => set({ promoTo: e.target.value })} /></label>}
        <label className="f wide">Забелешка<input value={d.note} onChange={(e) => set({ note: e.target.value })} /></label>
        <label className="f">Барај артикл<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="шифра или назив (и без залиха)" /></label>
      </div>
      <div className="tw"><table>
        <thead><tr><th>Шифра</th><th>Назив</th><th>Ед.</th><th className="n">Залиха (денес)</th><th className="n">Стара МПЦ</th><th className="n">Нова МПЦ</th><th className="n">Разлика</th></tr></thead>
        <tbody>
          {shown.map((it) => {
            const v = d.prices[it.id] ?? '';
            const old = it.sp[d.wh] ?? 0;
            return (
              <tr key={it.id}>
                <td>{it.code}</td><td>{it.name}</td><td>{it.unit}</td><td className="n">{fq(it.have[d.wh] ?? 0)}</td><td className="n">{fmt(old)}</td>
                <td><input inputMode="decimal" value={v} onChange={(e) => set({ prices: { ...d.prices, [it.id]: e.target.value } })} style={{ width: 100, textAlign: 'right' }} /></td>
                <td className="n">{v !== '' ? fmt((it.have[d.wh] ?? 0) * (n(v) - old)) : ''}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr><td colSpan={6}>Вкупна разлика (по залиха денес; при зачувување се зема залихата на датумот)</td><td className="n">{fmt(diff)}</td></tr></tfoot>
      </table></div>
      <div className="row">
        <Link className="btn" href="/nivel">Откажи</Link>
        <button className="btn pri" disabled={pending}>Зачувај нивелација</button>
      </div>
    </form>
  );
}

/* ================================================================== stock count / write-off */

export interface CountDraft { id?: string; number?: string; kind: 'count' | 'writeoff'; date: string; wh: string; note: string; shortageAccount: string; surplusAccount: string; lines: { itemId: string; v: string }[] }

export function CountEditor({ initial, items, locs, accounts }: { initial: CountDraft; items: ItemOpt[]; locs: LocOpt[]; accounts: [string, string][] }) {
  const [st, action, pending] = useActionState<ActionState, FormData>(saveStockCountAction, {});
  const [d, setD] = useState(initial);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const set = (p: Partial<CountDraft>) => setD((x) => ({ ...x, ...p }));
  const setLine = (i: number, v: string) => setD((x) => ({ ...x, lines: x.lines.map((l, k) => (k === i ? { ...l, v } : l)) }));
  const count = d.kind === 'count';
  const payload = {
    id: d.id ?? null, kind: d.kind, date: d.date, wh: d.wh, note: d.note, shortageAccount: d.shortageAccount, surplusAccount: d.surplusAccount,
    lines: d.lines.filter((l) => l.v !== '').map((l) => (count ? { itemId: l.itemId, cnt: n(l.v) } : { itemId: l.itemId, qty: n(l.v) })),
  };
  return (
    <form action={action} className="card">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <datalist id="k4">{accounts.filter(([k]) => k.startsWith('4')).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</datalist>
      <datalist id="k7">{accounts.filter(([k]) => k.startsWith('7')).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</datalist>
      <h2>{(count ? 'Контролен попис' : 'Отпис') + (d.number ? ' ' + d.number : '')}</h2>
      <Err st={st} />
      <div className="form">
        <label className="f">Датум<input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} required /></label>
        <label className="f">Објект<select value={d.wh} onChange={(e) => set({ wh: e.target.value, lines: count ? [] : d.lines })}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label className="f">{count ? 'Конто за кусок (расход)' : 'Конто за отпис (расход)'}<input list="k4" value={d.shortageAccount} onChange={(e) => set({ shortageAccount: e.target.value.trim() })} /></label>
        {count && <label className="f">Конто за вишок (приход)<input list="k7" value={d.surplusAccount} onChange={(e) => set({ surplusAccount: e.target.value.trim() })} /></label>}
        <label className="f wide">Забелешка<input value={d.note} onChange={(e) => set({ note: e.target.value })} /></label>
        <ItemPicker items={items} filter={(i) => i.type !== 'service'} onPick={(it) => set({ lines: [...d.lines, { itemId: it.id, v: '' }] })} />
        {count && <button type="button" className="btn" onClick={() => set({ lines: [...d.lines, ...items.filter((i) => (i.have[d.wh] ?? 0) !== 0 && !d.lines.some((l) => l.itemId === i.id)).map((i) => ({ itemId: i.id, v: String(i.have[d.wh]) }))] })}>Сите артикли со залиха</button>}
      </div>
      <div className="tw"><table>
        <thead><tr><th>Шифра</th><th>Назив</th><th>Ед.</th><th className="n">Залиха (денес)</th><th className="n">{count ? 'Пописна количина' : 'Количина за отпис'}</th>{count && <th className="n">Разлика</th>}<th /></tr></thead>
        <tbody>
          {d.lines.map((l, i) => {
            const it = byId.get(l.itemId);
            const have = it?.have[d.wh] ?? 0;
            return (
              <tr key={i}>
                <td>{it?.code}</td><td>{it?.name ?? '?'}</td><td>{it?.unit}</td><td className="n">{fq(have)}</td>
                <td><input inputMode="decimal" value={l.v} onChange={(e) => setLine(i, e.target.value)} style={{ width: 100, textAlign: 'right' }} /></td>
                {count && <td className="n">{l.v !== '' ? fq(n(l.v) - have) : ''}</td>}
                <td><button type="button" className="btn sm ghost danger" onClick={() => set({ lines: d.lines.filter((_, k) => k !== i) })} aria-label="Отстрани">✕</button></td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      <p className="note">{count ? 'Состојбата се пресметува на датумот на пописот; се зачувуваат само ставките со разлика. Кусокот се раздолжува по просечна набавна цена (Д конто за кусок / П залиха), вишокот се заведува по просечна цена (Д залиха / П конто за вишок).' : 'Отписот се раздолжува по просечна набавна цена: Д конто за отпис / П залиха.'}</p>
      <div className="row">
        <Link className="btn" href={'/m_izlez?t=' + d.kind}>Откажи</Link>
        <button className="btn pri" disabled={pending}>Зачувај</button>
      </div>
    </form>
  );
}

/* ================================================================== POS cart */

export function PosCart({ items, locs, date, wh }: { items: ItemOpt[]; locs: LocOpt[]; date: string; wh: string }) {
  const [st, action, pending] = useActionState<ActionState, FormData>(posSellAction, {});
  const [W, setW] = useState(wh);
  const [D, setDate] = useState(date);
  const [card, setCard] = useState('');
  const [cart, setCart] = useState<{ itemId: string; qty: string; price: string }[]>([]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const add = (it: ItemOpt) => setCart((c) => {
    const k = c.findIndex((x) => x.itemId === it.id);
    if (k >= 0) return c.map((x, i) => (i === k ? { ...x, qty: String(n(x.qty) + 1) } : x));
    return [...c, { itemId: it.id, qty: '1', price: String(it.sp[W] ?? 0) }];
  });
  const total = cart.reduce((s, l) => s + Math.round(n(l.qty) * n(l.price) * 100) / 100, 0);
  const payload = { date: D, wh: W, card: card === '' ? null : n(card), cart: cart.map((l) => ({ itemId: l.itemId, qty: n(l.qty), price: n(l.price), rate: byId.get(l.itemId)?.rate ?? null })) };
  return (
    <form action={action} className="card">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <Err st={st} />
      <div className="form">
        <label className="f">Датум<input type="date" value={D} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="f">Објект<select value={W} onChange={(e) => setW(e.target.value)}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <ItemPicker items={items} onPick={add} />
      </div>
      <div className="tw"><table>
        <thead><tr><th>Артикл</th><th className="n">Количина</th><th className="n">Цена со ДДВ</th><th className="n">ДДВ %</th><th className="n">Износ</th><th /></tr></thead>
        <tbody>
          {cart.map((l, i) => {
            const it = byId.get(l.itemId);
            return (
              <tr key={i}>
                <td>{it ? label(it) : '?'}</td>
                <td><input inputMode="decimal" value={l.qty} onChange={(e) => setCart((c) => c.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)))} style={{ width: 80, textAlign: 'right' }} /></td>
                <td><input inputMode="decimal" value={l.price} onChange={(e) => setCart((c) => c.map((x, k) => (k === i ? { ...x, price: e.target.value } : x)))} style={{ width: 100, textAlign: 'right' }} /></td>
                <td className="n">{it?.rate}</td><td className="n">{fmt(n(l.qty) * n(l.price))}</td>
                <td><button type="button" className="btn sm ghost danger" onClick={() => setCart((c) => c.filter((_, k) => k !== i))} aria-label="Отстрани">✕</button></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr><td colSpan={4}>ВКУПНО ЗА НАПЛАТА</td><td className="n"><b>{fmt(total)}</b></td><td /></tr></tfoot>
      </table></div>
      <div className="row">
        <label className="f">Од тоа со картичка<input inputMode="decimal" value={card} onChange={(e) => setCard(e.target.value)} style={{ width: 120 }} /></label>
        <button className="btn pri" disabled={pending || !cart.length}>Наплати и прокнижи</button>
      </div>
    </form>
  );
}

/* ================================================================== fiscal report (manual Z entry) */

export interface FiskDraft {
  date: string; wh: string; number: string; gross: Record<string, string>; total: string; card: string; sc: string; from: string; to: string;
  meth: 'fifo' | 'lifo' | 'prop'; issue: boolean; note: string;
}

export function FiskEditor({ initial, locs, schemes, nonVat, plan }: {
  initial: FiskDraft; locs: LocOpt[]; schemes: [string, string][]; nonVat: boolean;
  /** Proposed goods to issue (computed on the server for the current inputs, legacy `fkIssuePlan`). */
  plan: { itemId: string; label: string; qty: number; price: number; rate: number }[] | null;
}) {
  const [st, action, pending] = useActionState<ActionState, FormData>(saveFiskAction, {});
  const [d, setD] = useState(initial);
  const set = (p: Partial<FiskDraft>) => setD((x) => ({ ...x, ...p }));
  const rates = nonVat ? ['0'] : ['18', '10', '5', '0'];
  const sum = rates.reduce((s, r) => s + n(d.gross[r]), 0);
  const canIssue = d.sc !== 'usl' && d.sc !== 'trgNoVat';
  const payload = {
    date: d.date, wh: d.wh, number: d.number, note: d.note, sc: d.sc, from: d.from || null, to: d.to || null, meth: d.meth,
    gross: Object.fromEntries(rates.filter((r) => n(d.gross[r])).map((r) => [r, n(d.gross[r])])),
    total: d.total === '' ? null : n(d.total), card: d.card === '' ? null : n(d.card),
    issue: canIssue && d.issue && !!plan?.length, lines: canIssue && d.issue && plan ? plan.map((p) => ({ itemId: p.itemId, qty: p.qty, price: p.price, rate: p.rate })) : [],
  };
  const planHref = '/fiskPer?' + new URLSearchParams({ d: d.date, wh: d.wh, meth: d.meth, ...Object.fromEntries(rates.filter((r) => n(d.gross[r])).map((r) => ['g' + r, String(n(d.gross[r]))])) }).toString();
  return (
    <form action={action} className="card">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <h2>Внес на дневен / периодичен фискален извештај</h2>
      <Err st={st} />
      <div className="form">
        <label className="f">Датум<input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} required /></label>
        <label className="f">Објект<select value={d.wh} onChange={(e) => set({ wh: e.target.value })}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label className="f">Z број<input value={d.number} onChange={(e) => set({ number: e.target.value })} /></label>
        <label className="f">Шема на книжење<select value={d.sc} onChange={(e) => set({ sc: e.target.value })}>{schemes.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
        <label className="f">Периодичен од<input type="date" value={d.from} onChange={(e) => set({ from: e.target.value })} /></label>
        <label className="f">до<input type="date" value={d.to} onChange={(e) => set({ to: e.target.value })} /></label>
        {rates.map((r) => (
          <label className="f" key={r}>Промет {nonVat ? '' : `група ${r}% `}со ДДВ<input inputMode="decimal" value={d.gross[r] ?? ''} onChange={(e) => set({ gross: { ...d.gross, [r]: e.target.value } })} /></label>
        ))}
        <label className="f">Вкупно (празно = збир {fmt(sum)})<input inputMode="decimal" value={d.total} onChange={(e) => set({ total: e.target.value })} /></label>
        <label className="f">Од тоа со картичка<input inputMode="decimal" value={d.card} onChange={(e) => set({ card: e.target.value })} /></label>
        <label className="f wide">Забелешка<input value={d.note} onChange={(e) => set({ note: e.target.value })} /></label>
      </div>
      {canIssue && (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="row" style={{ gap: 12, alignItems: 'end' }}>
            <label className="chk"><input type="checkbox" checked={d.issue} onChange={(e) => set({ issue: e.target.checked })} /> Излез на стока за прометот</label>
            <label className="f">Избор на стока<select value={d.meth} onChange={(e) => set({ meth: e.target.value as FiskDraft['meth'] })}><option value="fifo">FIFO (прво најстарата)</option><option value="lifo">LIFO (прво последната)</option><option value="prop">Пропорционално</option></select></label>
            <Link className="btn" href={planHref}>Предложи стока</Link>
          </div>
          {plan && (plan.length ? (
            <div className="tw"><table>
              <thead><tr><th>Артикл</th><th className="n">Количина</th><th className="n">МПЦ</th><th className="n">Вредност</th></tr></thead>
              <tbody>{plan.map((p) => <tr key={p.itemId}><td>{p.label}</td><td className="n">{fq(p.qty)}</td><td className="n">{fmt(p.price)}</td><td className="n">{fmt(p.qty * p.price)}</td></tr>)}</tbody>
            </table></div>
          ) : <p className="note">Нема стока на залиха за овој промет.</p>)}
          <p className="note">FIFO/LIFO само избираат кои артикли се раздолжуваат; вредноста е секогаш по просечна набавна цена (една политика на вреднување).</p>
        </div>
      )}
      <div className="row"><button className="btn pri" disabled={pending}>Прокнижи извештај</button></div>
    </form>
  );
}

/* ================================================================== BOM (normativ) */

export function BomEditor({ product, initial, items, labor0 }: { product: ItemOpt; initial: { itemId: string; qty: string }[]; items: ItemOpt[]; labor0: string }) {
  const [st, action, pending] = useActionState<ActionState, FormData>(saveBomAction, {});
  const [lines, setLines] = useState(initial);
  const [labor, setLabor] = useState(labor0);
  const [err, setErr] = useState('');
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const stockOf = (it: ItemOpt) => Object.values(it.have).reduce((a, b) => a + b, 0);
  // legacy v437: stock next to every material, materials on stock first, then „── без залиха ──“
  const opts = useMemo(() => {
    const M = items.filter((x) => x.type !== 'service' && x.id !== product.id).map((x) => ({ x, q: stockOf(x) }));
    return { ins: M.filter((m) => m.q > 0), zero: M.filter((m) => !(m.q > 0)) };
  }, [items, product.id]);
  const optLabel = (m: { x: ItemOpt; q: number }) => `${label(m.x)} · залиха ${fq(m.q)} ${m.x.unit}${m.q > 0 ? ' · ' + fmt(m.x.avg) : ''}`;
  const mat = lines.reduce((s, l) => s + n(l.qty) * (byId.get(l.itemId)?.avg ?? 0), 0);
  const payload = { productId: product.id, labor: n(labor), lines: lines.filter((l) => l.itemId && n(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: n(l.qty) })) };
  const noMaterial = !items.some((i) => i.type === 'material');
  // import (legacy pcImport style): columns Шифра / Назив + Количина
  const imp = async (f: File | undefined) => {
    if (!f) return;
    const { readRows } = await import('../_retail/read-file');
    const { parseImport } = await import('@/components/doc-tools');
    const R = parseImport(await readRows(f), [{ key: 'code', label: 'Шифра', re: 'шифр|šifr|code|код' }, { key: 'name', label: 'Назив', re: 'назив|naziv|опис|name|артикл|материјал' }, { key: 'qty', label: 'Количина по единица', re: 'колич|količ|qty|кол\.', num: true, req: true }]);
    if (R.error) { setErr(R.error); return; }
    const miss: string[] = [];
    const add: { itemId: string; qty: string }[] = [];
    for (const r of R.rows) {
      const c = String(r.code ?? '').trim().toLowerCase(), nm = String(r.name ?? '').trim().toLowerCase();
      const it = items.find((x) => c && x.code.toLowerCase() === c) ?? items.find((x) => nm && x.name.toLowerCase() === nm);
      if (!it || it.id === product.id) { miss.push(String(r.code || r.name || '?')); continue; }
      if (Number(r.qty) > 0) add.push({ itemId: it.id, qty: String(r.qty) });
    }
    setLines((x) => [...x.filter((l) => l.itemId), ...add]);
    setErr(miss.length ? 'Не се најдени: ' + miss.slice(0, 8).join(', ') : '');
  };
  return (
    <form action={action} className="card" onSubmit={(e) => {
      if (lines.some((l) => l.itemId && !(n(l.qty) > 0))) { e.preventDefault(); setErr('Внесете количина за секој материјал.'); }
    }}>
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <Err st={st} />
      {err && <div className="callout warn">{err}</div>}
      <p className="note">Колку суровина оди за 1 {product.unit || 'единица'} производ, плус трудот и општите трошоци по единица. Цената на чинење се пресметува со просечните цени од залихата.</p>
      <div className="tw"><table>
        <thead><tr><th>Суровина / материјал</th><th className="n">Количина по единица</th><th className="n">Единечна цена</th><th className="n">Вредност</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => {
            const it = byId.get(l.itemId);
            const q = it ? stockOf(it) : 0;
            return (
              <tr key={i}>
                <td><select value={l.itemId} onChange={(e) => setLines((x) => x.map((y, k) => (k === i ? { ...y, itemId: e.target.value } : y)))}>
                  <option value="">— изберете материјал —</option>
                  {opts.ins.map((m) => <option key={m.x.id} value={m.x.id}>{optLabel(m)}</option>)}
                  {opts.ins.length > 0 && opts.zero.length > 0 && <option disabled>── без залиха ──</option>}
                  {opts.zero.map((m) => <option key={m.x.id} value={m.x.id}>{optLabel(m)}</option>)}
                </select></td>
                <td><input inputMode="decimal" value={l.qty} onChange={(e) => setLines((x) => x.map((y, k) => (k === i ? { ...y, qty: e.target.value } : y)))} style={{ textAlign: 'right', maxWidth: 120 }} />
                  {it && <div className="mini" style={{ marginTop: 2, textAlign: 'right', color: q > 0 ? 'var(--good)' : 'var(--bad)' }}>залиха <b>{fq(q)} {it.unit}</b></div>}</td>
                <td className="n">{fmt(it?.avg ?? 0)}</td><td className="n">{fmt((it?.avg ?? 0) * n(l.qty))}</td>
                <td><button type="button" className="btn sm ghost danger" onClick={() => setLines((x) => x.filter((_, k) => k !== i))} aria-label="Отстрани">✕</button></td>
              </tr>
            );
          })}
          <tr><td>Труд и општи трошоци по единица</td><td colSpan={2}><input inputMode="decimal" value={labor} onChange={(e) => setLabor(e.target.value)} style={{ textAlign: 'right', maxWidth: 120 }} /></td><td className="n">{fmt(n(labor))}</td><td /></tr>
        </tbody>
        <tfoot><tr><td colSpan={3}>Цена на чинење за 1 {product.unit} (по просечни цени, без подсклопови)</td><td className="n">{fmt(mat + n(labor))}</td><td /></tr></tfoot>
      </table></div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {noMaterial && <div className="callout warn" style={{ width: '100%' }}>Во шифрарникот нема суровини (вид „Суровина / материјал“). Прво внесете ги – на пр. брашно, квасец, сол.</div>}
        <button type="button" className="btn" onClick={() => setLines((x) => [...x, { itemId: '', qty: '' }])}>+ Материјал</button>
        <label className="btn">Увоз од Excel (Шифра · Количина)<input type="file" hidden accept=".xlsx,.xls,.csv,.txt" onChange={(e) => { void imp(e.target.files?.[0]); e.target.value = ''; }} /></label>
        <button className="btn pri" disabled={pending}>Зачувај норматив</button>
      </div>
    </form>
  );
}
