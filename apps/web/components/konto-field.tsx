'use client';
/**
 * Konto input of the bank line form („Прокнижи…“ → „Директно на конто“): a synthetic konto with analytics under it
 * offers the analytics in one click; a konto that is not in the chart offers „+ Ново конто“ with its name (default: the
 * parent synthetic's name) — the server creates it with the chart editor's rules and then posts the line.
 */
import { useMemo, useState } from 'react';
import { kontoHint } from '@wise/core/konto-hint';

export function KontoHintNote({ chart, value, onPick }: { chart: { code: string; name: string }[]; value: string; onPick: (code: string) => void }) {
  const h = useMemo(() => kontoHint(chart, value), [chart, value]);
  if (h.kind === 'synthetic') {
    return (
      <small className="mut" style={{ display: 'block' }}>
        синтетичко конто – изберете аналитика:{' '}
        {h.analytics.slice(0, 6).map((a) => (
          <button key={a.code} type="button" className="btn sm ghost" title={a.name} onClick={() => onPick(a.code)}>{a.code} {a.name.slice(0, 28)}</button>
        ))}
        {h.analytics.length > 6 && ' …'}
      </small>
    );
  }
  if (h.kind === 'ok') return <small className="mut" style={{ display: 'block' }}>{h.acc.name}</small>;
  if (h.kind === 'new') return <small className="mut" style={{ display: 'block' }}>нема во контниот план (под {h.parent.code} {h.parent.name})</small>;
  if (h.kind === 'missing') return <small style={{ display: 'block', color: 'var(--bad)' }}>{h.error}</small>;
  return null;
}

/**
 * „📋 Контен план“: the whole chart to browse – by class (0–9), sorted by code, a search by code (from the start) or by
 * name; a click picks the konto. The browser's suggestion list only shows what contains the typed text.
 */
export function ChartBrowser({ chart, onPick, onClose }: { chart: { code: string; name: string }[]; onPick: (code: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [cls, setCls] = useState('');
  const L = useMemo(() => {
    const t = q.trim().toLowerCase();
    return [...chart].sort((a, b) => a.code.localeCompare(b.code))
      .filter((k) => (!cls || k.code.startsWith(cls)) && (!t || k.code.startsWith(t) || k.name.toLowerCase().includes(t)));
  }, [chart, q, cls]);
  return (
    <div className="card" style={{ marginTop: 6, padding: 8, border: '1px solid var(--line)' }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 шифра или назив…" style={{ flex: 1, minWidth: 160 }} aria-label="Барај конто" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }} />
        {['', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].map((c) => (
          <button key={c || 'all'} type="button" className={'btn sm' + (cls === c ? ' pri' : ' ghost')} onClick={() => setCls(c)}>{c === '' ? 'сите' : 'кл. ' + c}</button>
        ))}
        <button type="button" className="btn sm ghost" onClick={onClose} aria-label="Затвори">✕</button>
      </div>
      <div style={{ maxHeight: 320, overflowY: 'auto', marginTop: 6 }}>
        <table className="dense"><tbody>{L.slice(0, 1500).map((k) => (
          <tr key={k.code} style={{ cursor: 'pointer' }} onClick={() => { onPick(k.code); onClose(); }}>
            <td className="num" style={{ fontWeight: k.code.length <= 3 ? 700 : 400, paddingLeft: Math.max(0, k.code.length - 3) * 6 }}>{k.code}</td><td>{k.name}</td>
          </tr>
        ))}</tbody></table>
        {!L.length && <p className="note">Нема конто за „{q}“.</p>}
      </div>
    </div>
  );
}

/** „+ Ново конто“ choice of a controlled konto input (`mk` = create it, `name` = its name). */
export interface NewKonto { mk: boolean; name: string }

/**
 * Controlled konto input with the same hints as `KontoField` (name, synthetic → analytics, „+ Ново конто“) — used by
 * the fast-entry dialog („Нова ставка“), which keeps the value in its own state.
 */
export function KontoInput({ chart, value, onChange, nk, onNk, list, inputRef, id, onKeyDown }: {
  chart: { code: string; name: string }[]; value: string; onChange: (v: string) => void; nk: NewKonto; onNk: (n: NewKonto) => void;
  list?: string; inputRef?: React.Ref<HTMLInputElement>; id?: string; onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  const code = value.trim().split(/\s/)[0] ?? '';
  const h = useMemo(() => kontoHint(chart, code), [chart, code]);
  const [browse, setBrowse] = useState(false);
  return (
    <>
      <span className="row" style={{ gap: 4, alignItems: 'center' }}>
        <input id={id} ref={inputRef} list={list} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Конто" autoComplete="off" data-fe="konto" onKeyDown={onKeyDown} />
        <button type="button" className="btn sm ghost" title="Целиот контен план" onClick={() => setBrowse((x) => !x)}>📋 Контен план</button>
      </span>
      {browse && <ChartBrowser chart={chart} onPick={onChange} onClose={() => setBrowse(false)} />}
      {h.kind === 'new' ? (
        <span style={{ display: 'block', marginTop: 4 }}>
          <label className="chk"><input type="checkbox" checked={nk.mk} onChange={(e) => onNk({ mk: e.target.checked, name: nk.name || h.parent.name })} /> + Ново конто {code}</label>
          {nk.mk && <input value={nk.name} onChange={(e) => onNk({ mk: true, name: e.target.value })} aria-label="Назив на новото конто" placeholder="назив на контото" style={{ marginTop: 4 }} />}
          {!nk.mk && <small className="mut" style={{ display: 'block' }}>нема во контниот план (под {h.parent.code} {h.parent.name})</small>}
        </span>
      ) : <KontoHintNote chart={chart} value={code} onPick={onChange} />}
    </>
  );
}

export function KontoField({ chart, name = 'konto', defaultValue, list, required }: {
  chart: [string, string][]; name?: string; defaultValue?: string; list?: string; required?: boolean;
}) {
  const C = useMemo(() => chart.map(([code, n]) => ({ code, name: n })), [chart]);
  const [v, setV] = useState(defaultValue ?? '');
  const [mk, setMk] = useState(false);
  const code = v.trim().split(/\s/)[0] ?? '';
  const h = useMemo(() => kontoHint(C, code), [C, code]);
  return (
    <>
      <input name={name} list={list} value={v} required={required} onChange={(e) => setV(e.target.value)} aria-label="Конто" />
      {h.kind === 'new' ? (
        <span style={{ display: 'block', marginTop: 4 }}>
          <label className="chk"><input type="checkbox" name="newKonto" value="1" checked={mk} onChange={(e) => setMk(e.target.checked)} /> + Ново конто {code}</label>
          {mk && <input key={h.parent.code} name="newName" defaultValue={h.parent.name} aria-label="Назив на новото конто" placeholder="назив на контото" style={{ marginTop: 4 }} required />}
          {!mk && <small className="mut" style={{ display: 'block' }}>нема во контниот план (под {h.parent.code} {h.parent.name})</small>}
        </span>
      ) : <KontoHintNote chart={C} value={code} onPick={setV} />}
    </>
  );
}
