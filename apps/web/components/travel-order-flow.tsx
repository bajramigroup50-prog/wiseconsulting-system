/**
 * Departure / delivery / return forms of a travel order (legacy driver flow `pnDep`, `pnDeliv`, `pnRet`), used by the
 * office editor (`pnalozi`) and the field user's list (`mojpn`). Every step records the time and the phone's GPS
 * position (`DriverForm`); a delivery takes the receiver's signature and a photo (legacy `pnSigInit`, `pnUpload`).
 * Barcode loading with the camera (legacy `pnScan*`) is not ported.
 */
import type { TravelOrderRow } from '@wise/db';
import { eventsOf, stopsOf } from '@wise/db';
import { mapsUrl } from '@wise/core/industry';
import { fmt } from '@/lib/fmt';
import { DriverForm, PhotoField, SignaturePad } from './driver-form';
import { travelEventAction } from '@/app/(app)/pnalozi/actions';

const geoLink = (g: { lat: number; lon: number } | null | undefined) => (g ? <a className="mini" href={mapsUrl(g)} target="_blank" rel="noopener noreferrer">📍</a> : null);

export function TravelOrderFlow({ x }: { x: TravelOrderRow }) {
  const S = stopsOf(x), E = eventsOf(x);
  return (
    <div className="card">
      <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Тек на патувањето</h2>
      {x.status === 'open' && (
        <DriverForm action={travelEventAction} className="row" style={{ gap: 6, alignItems: 'end' }}>
          <input type="hidden" name="id" value={x.id} /><input type="hidden" name="k" value="dep" />
          <label className="f">Км при тргнување<input name="km" type="number" defaultValue={x.depKm ?? ''} /></label>
          <button className="btn pri" style={{ fontSize: 16, padding: '12px 18px' }}>🚚 Тргнав</button>
        </DriverForm>
      )}
      {S.map((s, i) => (
        <div key={i} style={{ borderTop: '1px solid var(--line)', padding: '8px 0' }}>
          <b>{i + 1}. {s.kind === 'pick' ? '📦 Преземи од: ' : '🚚 Испорачај на: '}{s.partner}</b> <span className="mini">{s.doc}</span>
          {s.addr && <div className="mini"><a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(s.addr)}`} target="_blank" rel="noopener noreferrer">🧭 {s.addr}</a></div>}
          <div className="mini">{s.goods.map((g) => `${g.name} ${g.qty}${g.unit ? ' ' + g.unit : ''}`).join(' · ')}</div>
          {s.kind !== 'pick' && Number(s.open) > 0 && s.status !== 'done' && <div className="mini">За наплата: <b>{fmt(s.open)}</b> ден.</div>}
          {s.status === 'done' ? (
            <div className="mini">✅ {s.at ? new Date(s.at).toLocaleString('mk-MK', { timeZone: 'Europe/Skopje' }) : ''}{s.recv ? ` · ${s.recv}` : ''}{s.cash ? ` · готовина ${fmt(s.cash)}` : ''} {geoLink(s.geo)}
              {s.sig && <> · <a href={`/api/files/${s.sig}`} target="_blank" rel="noopener noreferrer">✍ потпис</a></>}
              {s.photo && <> · <a href={`/api/files/${s.photo}`} target="_blank" rel="noopener noreferrer">📷 слика</a></>}</div>
          ) : x.status === 'onroad' && (
            <DriverForm action={travelEventAction} className="card" style={{ margin: '6px 0' }}>
              <input type="hidden" name="id" value={x.id} /><input type="hidden" name="k" value="deliv" /><input type="hidden" name="i" value={i} />
              <div className="form">
                <label className="f">{s.kind === 'pick' ? 'Предал' : 'Примил'} (име)<input name="recv" /></label>
                {s.kind !== 'pick' && <label className="f">Наплатено во готово{s.open ? ` (долг ${fmt(s.open)})` : ''}<input name="cash" type="number" step="any" /></label>}
                {s.kind !== 'pick' && s.goods.map((g, k) => <label key={k} className="f">Поврат: {g.name}<input type="hidden" name={`r.k.${k}`} value={k} /><input name={`r.qty.${k}`} type="number" step="any" max={Number(g.qty) || undefined} /></label>)}
                <PhotoField name="photo" />
                <SignaturePad name="sig" label={s.kind === 'pick' ? 'Потпис на предавачот' : 'Потпис на примачот'} />
              </div>
              <div className="row"><span style={{ flex: 1 }} /><button className="btn pri" style={{ fontSize: 16, padding: '12px 18px' }}>{s.kind === 'pick' ? '📦 Преземено' : '✅ Испорачано'}</button></div>
            </DriverForm>
          )}
        </div>
      ))}
      {x.status === 'onroad' && (
        <DriverForm action={travelEventAction} className="row" style={{ gap: 6, alignItems: 'end', marginTop: 6, flexWrap: 'wrap' }}>
          <input type="hidden" name="id" value={x.id} /><input type="hidden" name="k" value="ret" />
          <label className="f">Км при враќање<input name="km" type="number" /></label>
          <label className="f">Наточено гориво (л)<input name="fuelL" type="number" step="any" /></label>
          <label className="f">Гориво (ден.)<input name="fuelAmt" type="number" step="any" /></label>
          <button className="btn" style={{ fontSize: 16, padding: '12px 18px' }}>🏁 Вратен</button>
        </DriverForm>
      )}
      {E.length > 0 && <table className="dense" style={{ marginTop: 8 }}><tbody>{E.map((e, i) => <tr key={i}><td className="mini">{new Date(e.at).toLocaleString('mk-MK', { timeZone: 'Europe/Skopje' })}</td><td>{e.txt} {geoLink(e.geo)}</td><td className="mini">{e.by}</td></tr>)}</tbody></table>}
      {x.status !== 'done' && <p className="note">При секое копче се бележи време и GPS локација (дозволете „Локација“ и „Камера“ на телефонот). Додека сте на пат, оставете ја страницата „Мои патни налози“ отворена – канцеларијата ја гледа позицијата на возилото во живо. Наплатата и поврат ги проверува и книжи канцеларијата.</p>}
    </div>
  );
}
