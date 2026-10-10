'use client';
/** Legacy `kalkCalc` form: recalculates on every change (`S.kalk` kept per browser in localStorage). */
import { useEffect, useState } from 'react';
import { priceCalc } from '@wise/core/retail';
import { fmt } from '@/lib/fmt';

const KEY = 'wc_kalkCalc';
const RATES = [18, 10, 5, 0];

export function PriceCalc() {
  const [k, setK] = useState({ cost: '', trans: '', margin: '25', rate: '18' });
  useEffect(() => { try { const v = localStorage.getItem(KEY); if (v) setK((x) => ({ ...x, ...JSON.parse(v) })); } catch { /* private mode */ } }, []);
  const set = (p: Partial<typeof k>) => setK((x) => { const y = { ...x, ...p }; try { localStorage.setItem(KEY, JSON.stringify(y)); } catch { /* ignore */ } return y; });
  const r = priceCalc({ cost: k.cost.replace(',', '.'), trans: k.trans.replace(',', '.'), margin: k.margin.replace(',', '.'), rate: k.rate });
  return (
    <div className="cols">
      <div className="card"><div className="form">
        <label className="f">Фактурна цена од добавувач (без ДДВ)<input inputMode="decimal" value={k.cost} onChange={(e) => set({ cost: e.target.value })} /></label>
        <label className="f">Зависни трошоци (транспорт, царина)<input inputMode="decimal" value={k.trans} onChange={(e) => set({ trans: e.target.value })} /></label>
        <label className="f">Разлика во цена %<input inputMode="decimal" value={k.margin} onChange={(e) => set({ margin: e.target.value })} /></label>
        <label className="f">ДДВ<select value={k.rate} onChange={(e) => set({ rate: e.target.value })}>{RATES.map((x) => <option key={x}>{x}</option>)}</select></label>
      </div></div>
      <div className="tw"><table><tbody>
        <tr><td>Набавна цена</td><td className="n">{fmt(r.nab)}</td></tr>
        <tr><td>Разлика во цена</td><td className="n">{fmt(r.marg)}</td></tr>
        <tr><td>Продажна цена без ДДВ</td><td className="n">{fmt(r.net)}</td></tr>
        <tr><td>ДДВ {k.rate}%</td><td className="n">{fmt(r.vat)}</td></tr>
        <tr className="tot"><td>Малопродажна цена со ДДВ</td><td className="n">{fmt(r.retail)}</td></tr>
      </tbody></table></div>
    </div>
  );
}
