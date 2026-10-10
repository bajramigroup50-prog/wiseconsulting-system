'use client';
/**
 * Legacy `ACT.frGRead` / `frGSave` (14628): the fuel-card statement (Excel / CSV) is read in the browser, the columns
 * are recognised (or chosen by hand), and the valid rows are posted to `saveFuelImportAction`.
 */
import { useActionState, useState } from 'react';
import { detectFuelColumns, FUEL_COLS, fuelRowsFromSheet, type FuelMap } from '@wise/core/industry';
import { saveFuelImportAction } from '@/app/(app)/frGor/actions';
import type { FormState } from './bank-form';

type Parsed = { name: string; head: string[]; map: FuelMap; rows: unknown[][] };

export function FuelImport() {
  const [P, setP] = useState<Parsed | null>(null);
  const [cur, setCur] = useState('EUR');
  const [err, setErr] = useState('');
  const [st, run, pending] = useActionState<FormState, FormData>(async (prev, fd) => {
    const r = await saveFuelImportAction(prev, fd);
    if (r.ok) setP(null);
    return r;
  }, {});

  const read = async (f: File | undefined) => {
    setErr('');
    if (!f) return;
    try {
      const XLSX = await import('xlsx');
      const buf = new Uint8Array(await f.arrayBuffer());
      const wb = /\.csv$/i.test(f.name) ? XLSX.read(new TextDecoder().decode(buf), { type: 'string', raw: true }) : XLSX.read(buf, { type: 'array', cellDates: true });
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, raw: true, defval: '' });
      const d = detectFuelColumns(aoa);
      setP({ name: f.name, head: d.head, map: d.map, rows: aoa.slice(d.hi + 1).filter((r) => r.some((x) => String(x ?? '').trim() !== '')) });
    } catch { setErr('Датотеката не може да се прочита.'); }
  };
  const res = P ? fuelRowsFromSheet(P.rows, P.map, cur) : null;

  return (
    <div className="card">
      <b>Увоз од Excel / CSV</b> (извештај од DKV, Shell, OMV, Eurowag, UTA…) <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => read(e.target.files?.[0])} />
      <p className="note">Програмата ги препознава колоните; ако не – изберете ги рачно. Гориво со иста регистрација во периодот на турата автоматски влегува во трошоците на турата. Книжењето е преку влезната фактура од издавачот на картичката.</p>
      {(err || st.error) && <div className="callout bad" role="alert">{err || st.error}</div>}
      {st.ok && <div className="callout good" role="status">{st.ok}</div>}
      {P && <>
        <div className="form">
          {FUEL_COLS.map(([k, n]) => (
            <label key={k} className="f">{n}<select value={P.map[k] ?? ''} onChange={(e) => setP({ ...P, map: { ...P.map, [k]: e.target.value === '' ? undefined : Number(e.target.value) } })}>
              <option value="">—</option>{P.head.map((x, i) => <option key={i} value={i}>{x}</option>)}</select></label>))}
          <label className="f">Валута ако нема колона<select value={cur} onChange={(e) => setCur(e.target.value)}>{['EUR', 'MKD', 'USD', 'CHF'].map((x) => <option key={x}>{x}</option>)}</select></label>
        </div>
        <p className="note">{P.rows.length} редови · прв ред: {P.rows[0] ? P.rows[0].slice(0, 8).map(String).join(' | ') : ''}{res && !res.error ? ` · важечки ${res.rows.length}` : ''}</p>
        {res?.error && <div className="callout warn">{res.error}</div>}
        <form action={run} className="row" style={{ gap: 8 }}>
          <input type="hidden" name="name" value={P.name} /><input type="hidden" name="rows" value={res && !res.error ? JSON.stringify(res.rows) : '[]'} />
          <button type="button" className="btn" onClick={() => setP(null)}>Откажи</button>
          <button className="btn pri" disabled={pending || !res || !!res.error}>Зачувај увоз</button>
        </form>
      </>}
    </div>
  );
}
