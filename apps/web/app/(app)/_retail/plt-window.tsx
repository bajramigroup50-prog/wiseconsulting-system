'use client';
/**
 * „📄 ПЛТ на клиентот“ – the window for clients who bring their own приемен лист: the supplier's invoice (supplier,
 * number, date, purchase value and VAT per rate) and the retail value with VAT per rate from the client's ПЛТ; the
 * price difference and the VAT in stock are shown as they will be posted.
 */
import Link from 'next/link';
import { useState } from 'react';
import { ActionForm } from '@/components/action-form';
import { savePltAction } from './plt-actions';

const RATES = [18, 10, 5, 0] as const;
const n = (s: string) => { const t = s.trim().replace(/\s/g, ''); const x = Number(/,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')); return Number.isFinite(x) ? x : 0; };
// the same on the server and in the browser (no locale): 1.234,56
const f2 = (x: number) => { const [i, d] = Math.abs(x).toFixed(2).split('.'); return (x < 0 ? '-' : '') + i!.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d; };

export function PltWindow({ stores, partners, today, vatReg }: { stores: { id: string; name: string }[]; partners: { id: string; name: string }[]; today: string; vatReg: boolean }) {
  const [v, setV] = useState<Record<string, string>>({});
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setV((o) => ({ ...o, [k]: e.target.value }));
  const row = (r: number) => {
    const b = n(v['b' + r] ?? ''), vat = n(v['v' + r] ?? ''), sp = n(v['s' + r] ?? '');
    const inStock = sp && vatReg ? Math.round(sp * r / (100 + r) * 100) / 100 : 0;
    return { b, vat, sp, inStock, diff: sp ? Math.round((sp - inStock - b) * 100) / 100 : 0 };
  };
  const T = RATES.map(row).reduce((a, x) => ({ b: a.b + x.b, vat: a.vat + x.vat, sp: a.sp + x.sp, inStock: a.inStock + x.inStock, diff: a.diff + x.diff }), { b: 0, vat: 0, sp: 0, inStock: 0, diff: 0 });
  return (
    <div className="card" style={{ borderColor: 'var(--accent)', borderWidth: 2 }}>
      <div className="hd"><h2>📄 Внес по приемен лист (ПЛТ) на клиентот</h2><Link className="btn sm" href="/kalkM">Затвори</Link></div>
      <p className="note" style={{ marginTop: 0 }}>За клиенти што сами го прават приемниот лист: од <b>фактурата</b> – добавувач, број, датум, набавна вредност и ДДВ по стапки; од <b>ПЛТ-то на клиентот</b> – продажната вредност со ДДВ по стапки. Се книжи како обична калкулација во продавницата (според шемата на фирмата; при водење по продажни цени: 6630, разлика во цена 6694, ДДВ во залиха 6640), а продажната вредност од ПЛТ влегува во залихата и ЕТ.</p>
      <ActionForm action={savePltAction} reset>
        <div className="form">
          <label className="f">Продавница<select name="wh" required defaultValue={stores.length === 1 ? stores[0]!.id : ''}><option value="" disabled>— изберете —</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label className="f wide">Добавувач<select name="partnerId" defaultValue=""><option value="">— нов (внесете назив) —</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="f">Нов добавувач – назив<input name="supplierName" placeholder="ако го нема во листата" /></label>
          <label className="f">ЕДБ (нов)<input name="supplierEdb" inputMode="numeric" /></label>
          <label className="f">Број на фактура<input name="number" required /></label>
          <label className="f">Датум<input name="date" type="date" defaultValue={today} required /></label>
          <label className="f">Рок за плаќање<input name="due" type="date" /></label>
          <label className="f">Број на ПЛТ (на клиентот)<input name="pltNo" /></label>
        </div>
        <table className="dense" style={{ marginTop: 8 }}>
          <thead><tr><th>Стапка</th><th className="n">Набавна вредност без ДДВ<br /><small>(од фактурата)</small></th><th className="n">ДДВ<br /><small>(од фактурата)</small></th><th className="n">Продажна вредност со ДДВ<br /><small>(од ПЛТ на клиентот)</small></th><th className="n">ДДВ во залиха</th><th className="n">Разлика во цена</th></tr></thead>
          <tbody>{RATES.map((r) => { const x = row(r); return (
            <tr key={r}><td><b>{r}%</b></td>
              <td className="n"><input name={'b' + r} inputMode="decimal" value={v['b' + r] ?? ''} onChange={set('b' + r)} style={{ width: 130, textAlign: 'right' }} /></td>
              <td className="n"><input name={'v' + r} inputMode="decimal" value={v['v' + r] ?? ''} onChange={set('v' + r)} style={{ width: 110, textAlign: 'right' }} disabled={!vatReg} /></td>
              <td className="n"><input name={'s' + r} inputMode="decimal" value={v['s' + r] ?? ''} onChange={set('s' + r)} style={{ width: 140, textAlign: 'right' }} /></td>
              <td className="n">{x.sp ? f2(x.inStock) : ''}</td>
              <td className="n" style={x.sp && x.diff < 0 ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{x.sp ? f2(x.diff) : ''}</td></tr>); })}</tbody>
          <tfoot><tr><th>Вкупно</th><th className="n">{f2(T.b)}</th><th className="n">{f2(T.vat)}</th><th className="n">{f2(T.sp)}</th><th className="n">{f2(T.inStock)}</th><th className="n">{f2(T.diff)}</th></tr>
            <tr><td colSpan={6} className="mini">За плаќање на добавувачот: <b>{f2(T.b + T.vat)}</b> ден.{T.diff < 0 ? <b style={{ color: 'var(--bad)' }}> · Разликата во цена е негативна – проверете го ПЛТ.</b> : null}</td></tr></tfoot>
        </table>
        <div className="row savebar"><button className="btn pri">💾 Зачувај и прокнижи</button></div>
      </ActionForm>
    </div>
  );
}
