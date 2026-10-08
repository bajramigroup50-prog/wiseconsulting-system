'use client';
/**
 * Statement upload (legacy `#bankFile` + `importBankFile`): choose files → preview (accounts, statement numbers,
 * duplicates, automatic classification) → save. XML, MT940, KB `.300`, CSV and Excel are read on the server.
 */
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { fmt, dmy } from '@/lib/fmt';
import { previewImportAction, saveImportAction, type PreviewResult } from './actions';

const CLS: Record<string, string> = { pos: 'POS картички', conv: 'откуп на девизи', own: 'пренос меѓу свои сметки', fee: 'провизија' };

export function ImportBox({ accounts, defaultAcct, fx }: { accounts: { id: string; label: string }[]; defaultAcct: string; fx: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [acct, setAcct] = useState(defaultAcct);
  const [dups, setDups] = useState(false);
  const [prev, setPrev] = useState<PreviewResult | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();

  const form = () => {
    const f = new FormData();
    for (const x of files) f.append('file', x);
    f.set('acct', acct);
    if (dups) f.set('dups', 'on');
    return f;
  };
  const preview = (L: File[]) => {
    setFiles(L);
    setMsg({});
    if (!L.length) { setPrev(null); return; }
    start(async () => {
      const f = new FormData();
      for (const x of L) f.append('file', x);
      f.set('acct', acct);
      setPrev(await previewImportAction(f));
    });
  };
  const save = () => start(async () => {
    const r = await saveImportAction(form());
    setMsg(r);
    if (!r.error) { setFiles([]); setPrev(null); if (ref.current) ref.current.value = ''; router.refresh(); }
  });

  return (
    <div>
      <h2>Увоз на извод од е-банкарство</h2>
      <p className="note">Секој формат што го нуди банката: <b>XML</b> (Халк, ISO camt.053), <b>MT940</b>, <b>Комерцијална .300</b>, <b>Excel</b>, <b>CSV/TXT</b>.
        Најцелосен е XML од е-банкарството (комитент, цел на дознака, шифра, денарска противвредност, салда).
        {fx && ' Девизните износи се пресметуваат по курсот од курсната листа на датумот на изводот (може да се промени кај изводот).'}</p>
      <div className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <label className="f" style={{ minWidth: 260 }}>{fx ? 'Девизна сметка' : 'Банкарска сметка'} (ако датотеката не ја наведува)
          <select value={acct} onChange={(e) => setAcct(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </label>
        <input ref={ref} type="file" multiple accept=".xml,.xls,.xlsx,.csv,.txt,.sta,.940,.mt940,.swi,.300,.pdf" disabled={pending}
          onChange={(e) => preview(Array.from(e.target.files ?? []))} />
        {pending && <span className="note">Се чита…</span>}
      </div>
      {msg.ok && <div className="callout good" role="status">{msg.ok}</div>}
      {(msg.error || prev?.error) && <div className="callout bad" role="alert">{msg.error || prev?.error}</div>}
      {prev?.plans && (
        <div className="card" style={{ borderColor: 'var(--accent)', marginTop: 8 }}>
          {prev.plans.map((p) => (
            <div key={p.file}>
              <h3 style={{ margin: '4px 0' }}>{p.file} <span className="pill">{p.format}</span></h3>
              {p.plan.errors.map((e) => <div key={e} className="callout bad">{e}</div>)}
              {p.plan.warnings.map((w) => <div key={w} className="callout warn">{w}</div>)}
              {p.plan.days.map((d) => (
                <div key={d.accountId + d.date} className="tw"><table className="dense">
                  <thead>
                    <tr className="sub"><td colSpan={5}><b>{d.accountName}</b> · Извод бр. {d.no || '—'} од {dmy(d.date)} · {d.lines.length} ставки
                      {d.existingId && <span className="pill warn">се додава на постоечки извод</span>}
                      {d.allDup && <span className="pill bad">веќе увезен</span>}
                      {d.rate != null && <> · курс {d.rate}</>}
                      {d.opening != null && <> · салдо {fmt(d.opening / 100)} → {fmt((d.closing ?? 0) / 100)} {d.cur}</>}</td></tr>
                    <tr><th>Датум</th><th>Опис</th><th className="n">Прилив</th><th className="n">Одлив</th><th>Препознаено</th></tr>
                  </thead>
                  <tbody>{d.lines.map((l, i) => (
                    <tr key={i} style={l.dup ? { opacity: 0.5 } : undefined}>
                      <td>{dmy(l.date)}</td><td>{l.desc}</td>
                      <td className="n">{l.amount > 0 ? fmt(l.amount / 100) : ''}{l.amountCur != null && l.amount > 0 ? <><br /><small className="note">{d.cur} {fmt(l.amountCur / 100)}</small></> : null}</td>
                      <td className="n">{l.amount < 0 ? fmt(-l.amount / 100) : ''}{l.amountCur != null && l.amount < 0 ? <><br /><small className="note">{d.cur} {fmt(-l.amountCur / 100)}</small></> : null}</td>
                      <td>{l.dup && <span className="pill bad">дупликат</span>} {l.cls && <span className="pill info">{CLS[l.cls] ?? l.cls}{l.konto ? ' → ' + l.konto : ''}</span>}
                        {l.newPartner && <span className="pill warn" title="Комитентот не постои – ќе може да се додаде при книжењето">нов комитент: {l.newPartner}</span>}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              ))}
            </div>
          ))}
          <div className="row" style={{ gap: 10, marginTop: 8 }}>
            <label className="chk"><input type="checkbox" checked={dups} onChange={(e) => setDups(e.target.checked)} /> увези ги и дупликатите</label>
            <span style={{ flex: 1 }} />
            <button className="btn" type="button" onClick={() => preview([])} disabled={pending}>Откажи</button>
            <button className="btn pri" type="button" onClick={save} disabled={pending || prev.plans.some((p) => p.plan.errors.length > 0)}>Зачувај и прокнижи</button>
          </div>
        </div>
      )}
    </div>
  );
}
