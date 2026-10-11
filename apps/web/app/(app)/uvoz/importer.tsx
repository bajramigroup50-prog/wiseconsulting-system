'use client';
/**
 * Excel / CSV / XML import (legacy `VIEWS.uvoz` 5413 + 17228/17231): pick a file, the header row and the columns are
 * recognised (`impHeaderRow`, `impAuto`), the user corrects the mapping, sees the first 8 rows and imports. Numbers and
 * dates are parsed here with the detected decimal separator; the server receives field → value rows.
 */
import { startTransition, useActionState, useRef, useState } from 'react';
import { IMP_EXAMPLE, IMP_T, detectDec, impAuto, impDate, impHeaderRow, impMissing, impNum, type ImpType } from '@wise/core/retail/import';
import type { ActionState } from '@/lib/books';
import { importAction } from '../_retail/actions';
import { downloadXlsx, readRows } from '../_retail/read-file';

const NUM = new Set(['price', 'rate', 'min', 'weight', 'netBase', 'coef', 'base18', 'vat18', 'base10', 'vat10', 'base5', 'vat5', 'base0', 'total', 'qty', 'disc', 'cost', 'amount', 'mpc', 'cnt', 'd', 'p']);
const DATE = new Set(['date', 'due', 'start', 'end']);
const NEEDS_WH: ImpType[] = ['in', 'pop', 'nivel'];
const NEEDS_DATE: ImpType[] = ['stock', 'in', 'pop', 'nivel'];

/** Per-row checks shown in the preview (rows with an error are skipped by the server too). */
function rowErr(t: ImpType, get: (k: string) => unknown, num: (k: string) => number | null): string {
  if (t === 'in' || t === 'pop' || t === 'nivel') {
    const id = [get('code'), get('barcode'), get('name')].some((x) => String(x ?? '').trim());
    if (!id) return 'нема шифра / баркод / назив';
    if (t === 'in' && !(num('qty') ?? 0)) return 'нема количина';
    if (t === 'pop' && num('cnt') == null) return 'нема пописана количина';
    if (t === 'nivel' && !((num('mpc') ?? 0) > 0)) return 'нема нова МПЦ';
    if (t === 'in' && String(get('rate') ?? '').trim() !== '' && ![0, 5, 10, 18].includes(num('rate') ?? -1)) return 'ДДВ % мора да е 0, 5, 10 или 18';
  }
  return '';
}

export function Importer({ t, locs, date0, wh0, tpl }: {
  t: ImpType; locs: { id: string; name: string; kind: string }[]; date0: string; wh0: string;
  /** Own template (header + example row) instead of the generic one, e.g. the retail stock list. */
  tpl?: { name: string; rows: (string | number)[][] };
}) {
  const T = IMP_T[t];
  const [st, run, pending] = useActionState<ActionState, FormData>(importAction, {});
  const [rows, setRows] = useState<unknown[][] | null>(null);
  const [file, setFile] = useState('');
  const [hi, setHi] = useState(0);
  const [map, setMap] = useState<Record<string, number>>({});
  const [date, setDate] = useState(date0);
  const [wh, setWh] = useState(wh0);
  const [err, setErr] = useState('');
  const inp = useRef<HTMLInputElement>(null);
  const whs = t === 'nivel' ? locs.filter((l) => l.kind === 'store') : locs;

  const load = async (f: File | undefined) => {
    if (!f) return;
    setErr('');
    try {
      const R = await readRows(f);
      if (!R.length) { setErr('Датотеката е празна или форматот не е препознаен.'); return; }
      const h = impHeaderRow(R);
      setRows(R); setFile(f.name); setHi(h); setMap(impAuto(t, R[h] ?? []));
    } catch { setErr('Датотеката не може да се прочита.'); }
  };
  const hdr = rows?.[hi] ?? [];
  const data = (rows ?? []).slice(hi + 1).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  const cell = (v: unknown) => (v instanceof Date ? impDate(v) : String(v ?? ''));
  const dec0 = detectDec(data);
  const errs = data.map((r) => rowErr(t, (k) => (map[k] != null ? r[map[k]!] : ''), (k) => (map[k] != null && String(r[map[k]!] ?? '').trim() !== '' ? impNum(r[map[k]!], dec0) : null)));
  const nErr = errs.filter(Boolean).length;
  const go = () => {
    const miss = impMissing(t, map);
    if (miss.length) { setErr('Поврзете ги задолжителните колони: ' + miss.join(', ')); return; }
    if (NEEDS_WH.includes(t) && !wh) { setErr('Изберете објект.'); return; }
    if (!window.confirm(`Да се увезат ${data.length} редови?`)) return;
    const dec = detectDec(data);
    const out = data.map((r) => Object.fromEntries(Object.entries(map).map(([k, i]) => {
      const v = r[i];
      return [k, NUM.has(k) ? (String(v ?? '').trim() === '' ? null : impNum(v, dec)) : DATE.has(k) ? impDate(v) : String(v instanceof Date ? impDate(v) : v ?? '').trim()];
    })));
    const fd = new FormData();
    fd.set('payload', JSON.stringify({ t, date, wh: NEEDS_WH.includes(t) ? wh : null, rows: out }));
    startTransition(() => run(fd));
  };

  return (
    <>
      <div className="row" style={{ gap: 10, margin: '12px 0', flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn pri" style={{ fontSize: 15, padding: '10px 18px' }} onClick={() => inp.current?.click()}>📂 Избери Excel / CSV / XML датотека</button>
        <button type="button" className="btn" onClick={() => (tpl ? downloadXlsx(tpl.name, tpl.rows) : downloadXlsx(`Obrazec_uvoz_${t}.xlsx`, [T.f.map((x) => x[1].replace('*', '')), [...IMP_EXAMPLE[t]]]))}>⬇ Преземи образец за „{T.t}“</button>
        <input ref={inp} type="file" hidden accept=".xlsx,.xls,.csv,.txt,.xml" onChange={(e) => { void load(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {!rows && (
        <label className="drop" style={{ border: '2px dashed var(--accent)', padding: 28, cursor: 'pointer', display: 'block' }}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void load(e.dataTransfer.files[0]); }} onClick={() => inp.current?.click()}>
          <b>Изберете или повлечете датотека</b> – Excel (.xlsx, .xls), CSV или XML.<br /><small>Првиот ред треба да ги има насловите на колоните (програмот ги препознава на македонски, албански и англиски).</small>
        </label>
      )}
      {err && <div className="callout bad">{err}</div>}
      {st.error && <div className="callout bad">{st.error}</div>}
      {st.ok && <div className={'callout ' + (st.ok.includes('прескокнати') ? 'warn' : 'good')}>{st.ok}</div>}
      {rows && (
        <>
          <div className="card">
            <div className="hd"><h2>Поврзување на колоните</h2><span className="note">{file} · {data.length} редови</span></div>
            <p className="note">Програмот сам ги препозна колоните. Проверете и поправете ако треба (* = задолжително).</p>
            <div className="form">{T.f.map(([k, n]) => (
              <label key={k} className="f">{n}<select value={map[k] ?? ''} onChange={(e) => setMap((m) => { const x = { ...m }; if (e.target.value === '') delete x[k]; else x[k] = Number(e.target.value); return x; })}>
                <option value="">— нема —</option>{hdr.map((x, i) => <option key={i} value={i}>{String(x || 'Колона ' + (i + 1)).slice(0, 40)}</option>)}
              </select></label>
            ))}</div>
            <div className="row" style={{ marginTop: 8, gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label className="mini">Заглавие во ред <input type="number" min={1} value={hi + 1} style={{ width: 60 }} onChange={(e) => { const h = Math.max(0, (Number(e.target.value) || 1) - 1); setHi(h); setMap(impAuto(t, rows[h] ?? [])); }} /></label>
              {NEEDS_DATE.includes(t) && <label className="mini">Датум <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>}
              {NEEDS_WH.includes(t) && <label className="mini">{t === 'nivel' ? 'Продавница' : 'Објект'} <select value={wh} onChange={(e) => setWh(e.target.value)} style={{ width: 'auto' }}><option value="">—</option>{whs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>}
            </div>
          </div>
          <div className="card">
            <div className="hd"><h2>Преглед (првите 8 редови{nErr ? ' и редовите со грешка' : ''})</h2>{nErr ? <span className="pill bad">{nErr} редови со грешка – ќе се прескокнат</span> : <span className="pill good">сите редови се во ред</span>}</div>
            <div className="tw"><table className="dense">
              <thead><tr><th>Ред</th>{T.f.filter(([k]) => map[k] != null).map(([k, n]) => <th key={k}>{n.replace('*', '')}</th>)}<th>Проверка</th></tr></thead>
              <tbody>{data.map((r, i) => ({ r, i })).filter(({ i }) => i < 8 || errs[i]).slice(0, 60).map(({ r, i }) => <tr key={i}><td className="mini">{hi + 2 + i}</td>{T.f.filter(([k]) => map[k] != null).map(([k]) => <td key={k}>{cell(r[map[k]!])}</td>)}
                <td>{errs[i] ? <span className="mini" style={{ color: 'var(--bad)' }}>{errs[i]}</span> : '✓'}</td></tr>)}</tbody>
            </table></div>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10, gap: 8 }}>
              <button type="button" className="btn" onClick={() => { setRows(null); setFile(''); }}>Друга датотека</button>
              <button type="button" className="btn pri" disabled={pending} onClick={go}>{pending ? 'Се увезува…' : `Увези ${data.length} редови`}</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
