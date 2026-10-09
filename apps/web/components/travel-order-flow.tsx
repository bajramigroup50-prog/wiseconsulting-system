/**
 * Departure / delivery / return forms of a travel order (legacy driver flow `pnDep`, `pnDeliv`, `pnRet`), used by the
 * office editor (`pnalozi`) and the field user's list (`mojpn`). GPS, signature and barcode scanning of the legacy
 * phone flow are not ported (known gap).
 */
import type { TravelOrderRow } from '@wise/db';
import { eventsOf, stopsOf } from '@wise/db';
import { fmt } from '@/lib/fmt';
import { BankForm } from './bank-form';
import { travelEventAction } from '@/app/(app)/pnalozi/actions';

export function TravelOrderFlow({ x }: { x: TravelOrderRow }) {
  const S = stopsOf(x), E = eventsOf(x);
  return (
    <div className="card">
      <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Тек на патувањето</h2>
      {x.status === 'open' && (
        <BankForm action={travelEventAction} className="row" style={{ gap: 6, alignItems: 'end' }}>
          <input type="hidden" name="id" value={x.id} /><input type="hidden" name="k" value="dep" />
          <label className="f">Км при тргнување<input name="km" type="number" defaultValue={x.depKm ?? ''} /></label>
          <button className="btn pri">🚚 Тргнување</button>
        </BankForm>
      )}
      {x.status === 'onroad' && S.map((s, i) => s.status === 'done' ? null : (
        <BankForm key={i} action={travelEventAction} className="card" style={{ margin: '6px 0' }}>
          <input type="hidden" name="id" value={x.id} /><input type="hidden" name="k" value="deliv" /><input type="hidden" name="i" value={i} />
          <b>{s.kind === 'pick' ? '📦 Преземање' : '🏁 Испорака'}: {s.partner}</b> <span className="mini">{s.doc} · {s.addr}</span>
          <div className="mini">{s.goods.map((g) => `${g.name} ${g.qty}${g.unit ? ' ' + g.unit : ''}`).join(' · ')}</div>
          <div className="form">
            <label className="f">{s.kind === 'pick' ? 'Предал' : 'Примил'} (име)<input name="recv" /></label>
            {s.kind !== 'pick' && <label className="f">Наплатено во готово{s.open ? ` (долг ${fmt(s.open)})` : ''}<input name="cash" type="number" step="any" /></label>}
            {s.kind !== 'pick' && s.goods.map((g, k) => <label key={k} className="f">Поврат: {g.name}<input type="hidden" name={`r.k.${k}`} value={k} /><input name={`r.qty.${k}`} type="number" step="any" max={Number(g.qty) || undefined} /></label>)}
          </div>
          <div className="row"><span style={{ flex: 1 }} /><button className="btn pri">{s.kind === 'pick' ? '📦 Преземено' : '✅ Испорачано'}</button></div>
        </BankForm>
      ))}
      {x.status === 'onroad' && (
        <BankForm action={travelEventAction} className="row" style={{ gap: 6, alignItems: 'end', marginTop: 6 }}>
          <input type="hidden" name="id" value={x.id} /><input type="hidden" name="k" value="ret" />
          <label className="f">Км при враќање<input name="km" type="number" /></label>
          <label className="f">Наточено гориво (л)<input name="fuelL" type="number" step="any" /></label>
          <label className="f">Гориво (ден.)<input name="fuelAmt" type="number" step="any" /></label>
          <button className="btn">🏠 Враќање (заврши налог)</button>
        </BankForm>
      )}
      {E.length > 0 && <table className="dense" style={{ marginTop: 8 }}><tbody>{E.map((e, i) => <tr key={i}><td className="mini">{new Date(e.at).toLocaleString('mk-MK', { timeZone: 'Europe/Skopje' })}</td><td>{e.txt}</td><td className="mini">{e.by}</td></tr>)}</tbody></table>}
    </div>
  );
}
