'use client';
/**
 * „Нова сметка“ of the till — legacy `VIEWS.kasa` 5680 with the loyalty box 9937: barcode / code scan + Enter (beep,
 * quantity from the qty box, the same item adds up), item select with price and stock, cart, loyalty card (number or
 * phone + Enter), coupon, redeem points, live discount („Попуст … · За плаќање …“), „Евидентирај продажба“ and
 * „Преземи сметка за апаратот“ (.inp file, legacy `posFile`). The server recomputes the discount.
 */
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import * as Retail from '@wise/core/retail';
import type { ActionState } from '@/lib/books';
import { fmt, fq } from '@/lib/fmt';
import { posSellAction } from '../_stock/actions';

export interface TillItem { id: string; code: string; name: string; type: string; rate: number; price: number; have: number; barcodes: string[] }
export interface TillCard { id: string; no: string; name: string; phone: string | null; disc: number; points: number }
type Line = { itemId: string; name: string; qty: number; price: number; rate: number };

function beep(ok: boolean) {
  try {
    const W = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const a = new (W.AudioContext ?? W.webkitAudioContext)!();
    const o = a.createOscillator(), g = a.createGain();
    o.frequency.value = ok ? 1200 : 300; g.gain.value = 0.08; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + (ok ? 0.08 : 0.25));
  } catch { /* no audio */ }
}

export function PosTill({ items, cards, coupons, rules, date, wh, order, initial }: {
  items: TillItem[]; cards: TillCard[]; coupons: Retail.Coupon[]; rules: Retail.LoyaltyRules; date: string; wh: string;
  /** Restaurant bill paid through the till (legacy `roPay` → kasa). */
  order?: string | null; initial?: Line[];
}) {
  const [st, action, pending] = useActionState<ActionState, FormData>(posSellAction, {});
  const [cart, setCart] = useState<Line[]>(initial ?? []);
  const [D, setDate] = useState(date);
  const [sel, setSel] = useState(items[0]?.id ?? '');
  const [qty, setQty] = useState('1');
  const [bc, setBc] = useState('');
  const [msg, setMsg] = useState('');
  const [cardQ, setCardQ] = useState('');
  const [cardId, setCardId] = useState('');
  const [coupon, setCoupon] = useState('');
  const [usePts, setUsePts] = useState(false);
  const [payCard, setPayCard] = useState('');
  const bcRef = useRef<HTMLInputElement>(null);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const scanItems = useMemo(() => items.map((i) => ({ ...i, active: true })), [items]);

  useEffect(() => {
    if (st.ok) { setCart([]); setCardId(''); setCardQ(''); setCoupon(''); setUsePts(false); setPayCard(''); }
    setTimeout(() => bcRef.current?.focus(), 30);
  }, [st]);

  const q = () => Number(String(qty).replace(',', '.')) || 1;
  const add = (it: TillItem, n: number) => setCart((c) => Retail.cartScan(c, { itemId: it.id, name: it.name, qty: n, price: it.price, rate: it.rate }));
  const scan = () => {
    const v = bc.trim();
    if (!v) return;
    const it = Retail.itemByCode(scanItems, v);
    if (!it) {
      beep(false);
      setMsg(`Баркодот / шифрата ${v} не е пронајден. Внесете го кај артиклот (Шифрарник → Производи и артикли) или преку влезната фактура.`);
      bcRef.current?.select();
      return;
    }
    beep(true); setMsg(''); add(it, q()); setBc('');
  };
  const card = cards.find((c) => c.id === cardId) ?? null;
  const tot = Retail.cartTotal(cart);
  const lc: Retail.LoyaltyCard | null = card ? { id: card.id, no: card.no, name: card.name, phone: card.phone, disc: card.disc, points: card.points } : null;
  const cardDisc = card && card.disc ? Math.round(tot * card.disc) / 100 : 0;
  const cp = coupon.trim() ? Retail.couponCheck(coupons, coupon, tot - cardDisc, D) : null;
  const x = Retail.posDiscount(tot, { card: lc, coupon: cp, usePts, rules });
  const findCard = () => {
    const c = Retail.findCard(cards, cardQ);
    if (!c) { beep(false); setMsg('Картичката не е пронајдена.'); return; }
    beep(true); setMsg(''); setCardId(c.id); setCardQ(c.no);
  };
  const inp = () => {
    const txt = Retail.fiscalInpFile(cart);
    const url = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
    Object.assign(document.createElement('a'), { href: url, download: `smetka_${Date.now()}.inp` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const payload = {
    date: D, wh, card: payCard === '' ? null : Number(payCard.replace(',', '.')) || 0, order: order ?? null,
    cart: cart.map((l) => ({ itemId: l.itemId, qty: l.qty, price: l.price, rate: l.rate })),
    cardNo: card?.no ?? null, coupon: coupon.trim() || null, usePts,
  };
  return (
    <form action={action} className="card">
      <h2>Нова сметка</h2>
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      {st.ok && <div className="callout good">{st.ok}</div>}
      {msg && <div className="callout warn">{msg}</div>}
      <div className="row" style={{ marginBottom: 8 }}>
        <input ref={bcRef} id="posBc" value={bc} onChange={(e) => setBc(e.target.value)} placeholder="📷 Скенирај баркод или внеси шифра + Enter" style={{ flex: 1, fontSize: 16 }} autoComplete="off" autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); scan(); } }} />
      </div>
      <div className="row">
        <select id="posItem" style={{ flex: 1 }} value={sel} onChange={(e) => setSel(e.target.value)}>
          {items.map((i) => <option key={i.id} value={i.id}>{i.name} · {fmt(i.price)}{i.type && i.type !== 'service' ? ' · залиха ' + fq(i.have) : ''}</option>)}
        </select>
        <input id="posQty" type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 80 }} />
        <button type="button" className="btn" onClick={() => { const it = byId.get(sel); if (it) setCart((c) => [...c, { itemId: it.id, name: it.name, qty: q(), price: it.price, rate: it.rate }]); }}>Додај</button>
      </div>
      <label className="f" style={{ maxWidth: 180 }}>Датум<input type="date" value={D} onChange={(e) => setDate(e.target.value)} /></label>
      {cart.length ? <>
        <div className="tw"><table><tbody>
          {cart.map((c, i) => (
            <tr key={i}><td>{c.name}</td><td className="n">{c.qty} × {fmt(c.price)}</td><td className="n">{fmt(c.qty * c.price)}</td>
              <td><button type="button" className="btn sm ghost danger" aria-label="Отстрани" onClick={() => setCart((L) => L.filter((_, k) => k !== i))}>✕</button></td></tr>
          ))}
        </tbody><tfoot><tr><td colSpan={2}>Вкупно со ДДВ</td><td className="n">{fmt(tot)}</td><td /></tr></tfoot></table></div>
        <div className="card" style={{ margin: '8px 0', padding: 10, background: 'var(--accent-soft)' }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
            <label className="f">💳 Картичка за лојалност<input id="posCard" placeholder="скенирај или телефон" style={{ width: 190 }} value={cardQ}
              onChange={(e) => { setCardQ(e.target.value); if (!e.target.value.trim()) { setCardId(''); setUsePts(false); } }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); findCard(); } }} onBlur={() => { if (cardQ.trim() && !cardId) findCard(); }} /></label>
            <label className="f">🎟 Купон<input id="posCp" style={{ width: 130 }} value={coupon} onChange={(e) => setCoupon(e.target.value)} /></label>
            {card && card.points >= rules.min && <label className="chk"><input type="checkbox" checked={usePts} onChange={(e) => setUsePts(e.target.checked)} /> искористи {fq(card.points)} поени</label>}
          </div>
          {card && <div className="mini" style={{ marginTop: 4 }}>👤 {card.name} · {fq(card.points)} поени{card.disc ? ` · постојан попуст ${card.disc}%` : ''}</div>}
          {cp && 'err' in cp && <div className="mini" style={{ color: 'var(--bad)' }}>{cp.err}</div>}
          {x.disc > 0 && <div style={{ marginTop: 6 }}><b>Попуст {fmt(x.disc)}</b> <span className="mini">({x.parts.join(', ')})</span> · <b>За плаќање {fmt(x.pay)}</b></div>}
        </div>
        <div className="row">
          <label className="f">Од тоа со картичка<input inputMode="decimal" value={payCard} onChange={(e) => setPayCard(e.target.value)} style={{ width: 120 }} /></label>
          <button className="btn pri" disabled={pending || (!!cp && 'err' in cp)}>Евидентирај продажба</button>
          <button type="button" className="btn" onClick={inp}>Преземи сметка за апаратот</button>
        </div>
      </> : <div className="empty">Додадете артикли во сметката.</div>}
    </form>
  );
}
