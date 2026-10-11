/**
 * Departure / delivery / return forms of a travel order (legacy driver flow `pnDep`, `pnDeliv`, `pnRet`,
 * `pnDriverStopHTML` 9369), used by the office editor (`pnalozi`) and the field user's list (`mojpn`). Every step
 * records the time and the phone's GPS position (`DriverForm`); a delivery takes the receiver's name, a photo, the cash
 * collected (invoice stops, with „= долг“ quick fill), the signature and the returned goods. Confirmations as legacy:
 * departure with scanned but not loaded goods, delivery without receiver name and signature, cash above the debt,
 * return with open stops.
 */
import type { TravelOrderRow } from '@wise/db';
import { eventsOf, stopsOf } from '@wise/db';
import { departureCheck, mapsUrl } from '@wise/core/industry';
import { fmt, fq } from '@/lib/fmt';
import { DriverForm, PhotoField, SignaturePad } from './driver-form';
import { CashFill } from './travel-scan';
import { travelEventAction } from '@/app/(app)/pnalozi/actions';

const geoLink = (g: { lat: number; lon: number } | null | undefined) => (g ? <a className="mini" href={mapsUrl(g)} target="_blank" rel="noopener noreferrer">📍</a> : null);
const hm = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('mk-MK', { timeZone: 'Europe/Skopje', hour: '2-digit', minute: '2-digit' }) : '');

export function TravelOrderFlow({ x, events = true }: { x: TravelOrderRow; events?: boolean }) {
  const S = stopsOf(x), E = eventsOf(x);
  const dc = departureCheck(S);
  const openN = S.filter((s) => s.status !== 'done').length;
  return (
    <div className="card">
      <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Тек на патувањето</h2>
      {x.status === 'open' && (
        <DriverForm action={travelEventAction} className="row" style={{ gap: 8, alignItems: 'end', margin: '8px 0' }}
          confirmMsg={dc.notLoaded && dc.scanned ? `${dc.notLoaded} ставки не се означени како натоварени. Сепак тргнувате?` : undefined}>
          <input type="hidden" name="id" value={x.id} /><input type="hidden" name="k" value="dep" />
          <label className="f">Км при тргнување<input name="km" type="number" defaultValue={x.depKm ?? ''} style={{ width: 130 }} /></label>
          <button className="btn pri" style={{ fontSize: 16, padding: '12px 18px' }}>🚚 Тргнав</button>
        </DriverForm>
      )}
      {S.map((s, i) => {
        const pk = s.kind === 'pick';
        return (
          <div key={i} style={{ borderTop: '1px solid var(--line)', padding: '10px 0' }}>
            <b>{i + 1}. {pk ? '📦 Преземи од: ' : '🚚 Испорачај на: '}{s.partner}</b>
            {s.addr && <div className="mini" style={{ display: 'block', margin: '2px 0' }}><a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(s.addr)}`} target="_blank" rel="noopener noreferrer">🧭 {s.addr}</a></div>}
            <div className="mini" style={{ display: 'block' }}>{s.goods.map((g) => `${g.name} – ${fq(Number(g.qty) || 0)} ${g.unit ?? ''}`).join(' · ')}</div>
            {!pk && Number(s.open) > 0 && s.status !== 'done' && <div className="mini" style={{ display: 'block' }}>За наплата: <b>{fmt(s.open)}</b> ден.</div>}
            {s.status === 'done' ? (
              <div className="mini" style={{ color: '#1f8a4c', display: 'block' }}>✅ {pk ? 'преземено' : 'испорачано'} {hm(s.at)}{s.recv ? ` · ${s.recv}` : ''}{Number(s.cash) ? ` · 💰 ${fmt(s.cash)} ден.` : ''}{(s.ret ?? []).some((r) => Number(r.qty)) ? ' · ↩ поврат' : ''} {geoLink(s.geo)}
                {s.sig && <> · <a href={`/api/files/${s.sig}`} target="_blank" rel="noopener noreferrer">✍ потпис</a></>}
                {s.photo && <> · <a href={`/api/files/${s.photo}`} target="_blank" rel="noopener noreferrer">📷 слика</a></>}</div>
            ) : x.status === 'onroad' && (
              <DriverForm action={travelEventAction} style={{ marginTop: 6, display: 'grid', gap: 8 }} needOne={pk ? undefined : ['recv', 'sig']} cashOpen={Number(s.open) || undefined}>
                <input type="hidden" name="id" value={x.id} /><input type="hidden" name="k" value="deliv" /><input type="hidden" name="i" value={i} />
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
                  <label className="f">{pk ? 'Предал (име)' : 'Примил (име)'}<input name="recv" style={{ width: 170 }} /></label>
                  <PhotoField name="photo" label="📷 Слика" />
                  {!pk && s.ref?.type === 'invoice' && <CashFill open={Number(s.open) || 0} />}
                </div>
                {!pk && <>
                  <SignaturePad name="sig" label="Потпис на примачот (со прст):" />
                  <details><summary className="mini" style={{ cursor: 'pointer' }}>↩ Купувачот враќа стока (оштетено / погрешно / вишок)</summary>
                    {s.goods.map((g, k) => (
                      <label key={k} className="mini" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0', maxWidth: 420 }}>
                        <span style={{ flex: 1 }}>{g.name} ({fq(Number(g.qty) || 0)} {g.unit ?? ''})</span>
                        <input type="hidden" name={`r.k.${k}`} value={k} />
                        <input name={`r.qty.${k}`} type="number" step="any" min={0} max={Number(g.qty) || undefined} inputMode="decimal" style={{ width: 90 }} placeholder="0" />
                      </label>))}
                  </details>
                </>}
                <div><button className="btn pri" style={{ fontSize: 15, padding: '10px 16px' }}>{pk ? '📦 Преземено' : '✅ Испорачано'}</button></div>
              </DriverForm>
            )}
          </div>
        );
      })}
      {x.status === 'onroad' && (
        <DriverForm action={travelEventAction} className="row" style={{ gap: 8, alignItems: 'end', marginTop: 8, flexWrap: 'wrap' }}
          confirmMsg={openN ? `${openN} застанувања не се означени како испорачани. Сепак да се заврши налогот?` : undefined}>
          <input type="hidden" name="id" value={x.id} /><input type="hidden" name="k" value="ret" />
          <label className="f">Км при враќање<input name="km" type="number" style={{ width: 130 }} /></label>
          <label className="f">Гориво (л)<input name="fuelL" type="number" step="any" style={{ width: 100 }} /></label>
          <label className="f">Гориво (ден.)<input name="fuelAmt" type="number" step="any" style={{ width: 110 }} /></label>
          <button className="btn" style={{ fontSize: 16, padding: '12px 18px' }}>🏁 Вратен</button>
        </DriverForm>
      )}
      {events && E.length > 0 && <table className="dense" style={{ marginTop: 8 }}><tbody>{E.map((e, i) => <tr key={i}><td className="mini">{new Date(e.at).toLocaleString('mk-MK', { timeZone: 'Europe/Skopje' })}</td><td>{e.txt} {geoLink(e.geo)}</td><td className="mini">{e.by}</td></tr>)}</tbody></table>}
    </div>
  );
}
