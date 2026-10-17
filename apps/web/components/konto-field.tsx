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
  return (
    <>
      <input id={id} ref={inputRef} list={list} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Конто" autoComplete="off" data-fe="konto" onKeyDown={onKeyDown} />
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
