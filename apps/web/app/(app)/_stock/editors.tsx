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

export function TransferEditor({ initial, items, locs }: { initial: TransferDraft; items: ItemOpt[]; locs: LocOpt[] }) {
  const [st, action, pending] = useActionState<ActionState, FormData>(saveTransferAction, {});
  const [d, setD] = useState(initial);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const set = (p: Partial<TransferDraft>) => setD((x) => ({ ...x, ...p }));
  const setLine = (i: number, p: Partial<TransferDraft['lines'][number]>) => setD((x) => ({ ...x, lines: x.lines.map((l, k) => (k === i ? { ...l, ...p } : l)) }));
  let nab = 0;
  let spv = 0;
  for (const l of d.lines) {
    const it = byId.get(l.itemId);
    nab += n(l.qty) * (it?.avg ?? 0);
    spv += n(l.qty) * (l.sp === '' ? it?.sp[d.to] ?? 0 : n(l.sp));
  }
  const payload = { id: d.id ?? null, date: d.date, from: d.from, to: d.to, note: d.note, lines: d.lines.filter((l) => n(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: n(l.qty), sp: l.sp === '' ? null : n(l.sp) })) };
  return (
    <form action={action} className="card">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <h2>{d.id ? 'Преносница ' + d.number : 'Нов пренос од магацин во продавница'}</h2>
      <Err st={st} />
      <div className="form">
        <label className="f">Датум<input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} required /></label>
        <label className="f">Од објект<select value={d.from} onChange={(e) => set({ from: e.target.value })}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label className="f">Во објект<select value={d.to} onChange={(e) => set({ to: e.target.value })}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label className="f wide">Забелешка<input value={d.note} onChange={(e) => set({ note: e.target.value })} /></label>
        <ItemPicker items={items} onPick={(it) => set({ lines: [...d.lines, { itemId: it.id, qty: '', sp: '' }] })} />
        <button type="button" className="btn" onClick={() => set({ lines: [...d.lines, ...items.filter((i) => (i.have[d.from] ?? 0) > 0 && !d.lines.some((l) => l.itemId === i.id)).map((i) => ({ itemId: i.id, qty: String(i.have[d.from]), sp: '' }))] })}>Сета залиха од објектот</button>
      </div>
      <div className="tw"><table>
        <thead><tr><th>Шифра</th><th>Назив</th><th>Ед.</th><th className="n">Залиха (од)</th><th className="n">Количина</th><th className="n">Набавна (просек)</th><th className="n">МПЦ со ДДВ во продавница</th><th className="n">Продажна вредност</th><th /></tr></thead>
        <tbody>
          {d.lines.map((l, i) => {
            const it = byId.get(l.itemId);
            const sp = l.sp === '' ? it?.sp[d.to] ?? 0 : n(l.sp);
            const have = it?.have[d.from] ?? 0;
            return (
              <tr key={i}>
                <td>{it?.code}</td><td>{it?.name ?? '?'}</td><td>{it?.unit}</td>
                <td className="n" style={n(l.qty) > have + 1e-9 ? { color: 'var(--bad)' } : undefined}>{fq(have)}</td>
                <td><input inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} style={{ width: 90, textAlign: 'right' }} /></td>
                <td className="n">{fmt(it?.avg ?? 0)}</td>
                <td><input inputMode="decimal" value={l.sp} placeholder={fmt(it?.sp[d.to] ?? 0)} onChange={(e) => setLine(i, { sp: e.target.value })} style={{ width: 100, textAlign: 'right' }} /></td>
                <td className="n">{fmt(n(l.qty) * sp)}</td>
                <td><button type="button" className="btn sm ghost danger" onClick={() => set({ lines: d.lines.filter((_, k) => k !== i) })} aria-label="Отстрани">✕</button></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr><td colSpan={5}>Вкупно</td><td className="n">{fmt(nab)}</td><td /><td className="n">{fmt(spv)}</td><td /></tr></tfoot>
      </table></div>
      <p className="note">Магацинот се раздолжува по просечна набавна цена на денот; продавницата се задолжува по истата набавна вредност. Празна МПЦ = тековната цена во продавницата; внесената МПЦ станува нова цена на артиклот во продавницата.</p>
      <div className="row">
        <Link className="btn" href="/prenosi">Откажи</Link>
        <button className="btn pri" disabled={pending}>Зачувај преносница</button>
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
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const mat = lines.reduce((s, l) => s + n(l.qty) * (byId.get(l.itemId)?.avg ?? 0), 0);
  const payload = { productId: product.id, labor: n(labor), lines: lines.filter((l) => l.itemId && n(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: n(l.qty) })) };
  return (
    <form action={action} className="card">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <Err st={st} />
      <p className="note">Колку суровина оди за 1 {product.unit || 'единица'} производ, плус трудот и општите трошоци по единица. Цената на чинење се пресметува со просечните цени од залихата.</p>
      <div className="tw"><table>
        <thead><tr><th>Суровина / материјал</th><th className="n">Количина по единица</th><th className="n">Единечна цена</th><th className="n">Вредност</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => {
            const it = byId.get(l.itemId);
            return (
              <tr key={i}>
                <td><select value={l.itemId} onChange={(e) => setLines((x) => x.map((y, k) => (k === i ? { ...y, itemId: e.target.value } : y)))}>
                  <option value="">—</option>
                  {items.filter((x) => x.type !== 'service' && x.id !== product.id).map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}
                </select></td>
                <td><input inputMode="decimal" value={l.qty} onChange={(e) => setLines((x) => x.map((y, k) => (k === i ? { ...y, qty: e.target.value } : y)))} style={{ textAlign: 'right', maxWidth: 120 }} /></td>
                <td className="n">{fmt(it?.avg ?? 0)}</td><td className="n">{fmt((it?.avg ?? 0) * n(l.qty))}</td>
                <td><button type="button" className="btn sm ghost danger" onClick={() => setLines((x) => x.filter((_, k) => k !== i))} aria-label="Отстрани">✕</button></td>
              </tr>
            );
          })}
          <tr><td>Труд и општи трошоци по единица</td><td colSpan={2}><input inputMode="decimal" value={labor} onChange={(e) => setLabor(e.target.value)} style={{ textAlign: 'right', maxWidth: 120 }} /></td><td className="n">{fmt(n(labor))}</td><td /></tr>
        </tbody>
        <tfoot><tr><td colSpan={3}>Цена на чинење за 1 {product.unit} (по просечни цени, без подсклопови)</td><td className="n">{fmt(mat + n(labor))}</td><td /></tr></tfoot>
      </table></div>
      <div className="row">
        <button type="button" className="btn" onClick={() => setLines((x) => [...x, { itemId: '', qty: '' }])}>+ Материјал</button>
        <button className="btn pri" disabled={pending}>Зачувај норматив</button>
      </div>
    </form>
  );
}
