'use client';
/** Legacy `fimpHTML`: choose the Excel, check the list, import the ticked firms. */
import { useState, useTransition } from 'react';
import { klCredHtml } from '@wise/core/firms/klprofili';
import { importFirms, readFirmsFile, type FimpPreview, type FimpResult } from './actions';

export function ImportBox({ canProfiles }: { canProfiles: boolean }) {
  const [P, setP] = useState<FimpPreview | null>(null);
  const [on, setOn] = useState<boolean[]>([]);
  const [ddv, setDdv] = useState(true);
  const [prof, setProf] = useState(canProfiles);
  const [res, setRes] = useState<FimpResult | null>(null);
  const [pending, start] = useTransition();
  const rows = P?.rows ?? [];
  const sel = rows.filter((_, i) => on[i]);
  const nw = rows.filter((x) => !x.ex).length;
  return (
    <>
      <div className="card" style={{ borderColor: 'var(--accent)' }}>
        <h2 style={{ margin: '0 0 6px' }}>📥 Увоз на фирми од Excel</h2>
        <p className="note" style={{ margin: '0 0 10px' }}>Изберете Excel со листа на фирми (на пр. извоз од друга програма). Колоните се препознаваат по насловот: Име на фирма, Година, Жиро сметка, Дејност, Матичен број, Даночен, Адреса, Банка, Општина, Лице за контакт… Пред увозот се прикажува листа за проверка.</p>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn" href="/firmiImp/obrazec">⬇ Excel образец</a>
          <label className="btn pri">{pending ? 'Се чита…' : 'Избери Excel датотека'}<input type="file" accept=".xlsx,.xls,.csv" hidden disabled={pending} onChange={(e) => {
            const fl = e.target.files?.[0]; e.target.value = '';
            if (!fl) return;
            const fd = new FormData(); fd.set('file', fl);
            start(async () => { const r = await readFirmsFile(fd); setRes(null); setP(r); setOn((r.rows ?? []).map(() => true)); });
          }} /></label>
        </div>
        {P?.error && <div className="callout bad">{P.error}</div>}
      </div>
      {res && (
        <div className="card">
          {res.error ? <div className="callout bad">{res.error}</div> : <div className="callout good">{res.ok}</div>}
          {!!res.creds?.length && (
            <>
              <p className="note">Пристапните податоци на новите профили се прикажуваат само сега:</p>
              <button type="button" className="btn pri" onClick={() => { const w = window.open('', '_blank'); if (w) { w.document.write(`<!doctype html><meta charset="utf-8"><body style="font-family:Arial;padding:12mm">${klCredHtml(res.creds!, new Date().toLocaleDateString('mk-MK'))}<script>setTimeout(()=>print(),300)</script>`); w.document.close(); } }}>🖨 Печати пристапни податоци ({res.creds.length})</button>
            </>
          )}
        </div>
      )}
      {rows.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <div className="hd"><h2>Увоз на фирми од „{P!.file}“</h2><button type="button" className="btn sm" onClick={() => setP(null)}>✕</button></div>
          <p className="note" style={{ margin: '0 0 8px' }}>Пронајдени <b>{rows.length}</b> фирми: <b>{nw}</b> нови, <b>{rows.length - nw}</b> веќе постојат (се споредува по ЕДБ, матичен број или назив – кај нив се дополнуваат празните полиња, а пополнетите не се менуваат). Препознаени колони: {P!.cols!.length}.</p>
          <div className="tw" style={{ maxHeight: 360 }}><table className="dense">
            <thead><tr><th><input type="checkbox" checked={on.every(Boolean)} onChange={(e) => setOn(rows.map(() => e.target.checked))} /></th><th>Име на фирма</th><th>ЕДБ</th><th>Матичен</th><th>Жиро сметка</th><th>Банка</th><th>Дејност</th><th>Адреса</th><th>Статус</th></tr></thead>
            <tbody>{rows.map((x, i) => (
              <tr key={i}>
                <td><input type="checkbox" checked={!!on[i]} onChange={(e) => setOn(on.map((v, j) => (j === i ? e.target.checked : v)))} /></td>
                <td><b>{String(x.f.name)}</b></td><td>{String(x.f.edb ?? '')}</td><td>{String(x.f.embs ?? '')}</td><td>{String(x.f.bank ?? '')}</td><td>{String(x.f.bankName ?? '')}</td><td>{String(x.f.activity ?? '')}</td><td>{String(x.f.address ?? '')}</td>
                <td>{x.ex ? <span className="pill info" title={x.exName}>постои – дополни</span> : <span className="pill good">нова</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <label className="chk" style={{ margin: '8px 0' }}><input type="checkbox" checked={ddv} onChange={(e) => setDdv(e.target.checked)} /> Новите фирми се ДДВ обврзници (тромесечно) – ако во датотеката нема колона за ДДВ</label>
          {canProfiles && <label className="chk" style={{ margin: '0 0 8px' }}><input type="checkbox" checked={prof} onChange={(e) => setProf(e.target.checked)} /> креирај профил за клиентот на секоја нова фирма (🔑 Профили на клиенти)</label>}
          <div className="row" style={{ gap: 8 }}>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn" onClick={() => setP(null)}>Откажи</button>
            <button type="button" className="btn pri" disabled={pending || !sel.length} onClick={() => {
              if (!window.confirm(`Да се увезат ${sel.length} фирми?`)) return;
              start(async () => { const r = await importFirms(sel.map((x) => x.f), { ddv, profiles: prof }); setRes(r); if (!r.error) setP(null); });
            }}>{pending ? 'Се увезува…' : `Увези ${sel.length} фирми`}</button>
          </div>
          <p className="mini" style={{ margin: '6px 0 0' }}>По увозот проверете ја секоја фирма во „Измени“: ДДВ (месечно/тромесечно), контен план и лого.</p>
        </div>
      )}
    </>
  );
}
