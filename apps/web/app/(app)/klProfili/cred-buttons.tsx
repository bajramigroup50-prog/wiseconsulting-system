'use client';
/** Buttons that create / reset client profiles and show the new access data once, with a print button (legacy `klCredHTML`). */
import { useState, useTransition } from 'react';
import { klCredHtml, type KlCred } from '@wise/core/firms/klprofili';
import type { CredResult } from './actions';

function printCreds(L: KlCred[]) {
  const w = window.open('', '_blank');
  if (!w) { window.alert('Дозволете скокачки прозорци за печатење.'); return; }
  const d = new Date().toLocaleDateString('mk-MK');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Pristapni_podatoci</title><style>body{font-family:Arial,sans-serif;font-size:11pt;padding:12mm}</style></head><body>${klCredHtml(L, d)}<script>setTimeout(()=>print(),300)</script></body></html>`);
  w.document.close();
}

export function CredButton({ action, label, confirm, className = 'btn' }: { action: () => Promise<CredResult>; label: string; confirm?: string; className?: string }) {
  const [pending, start] = useTransition();
  const [r, setR] = useState<CredResult | null>(null);
  return (
    <>
      <button type="button" className={className} disabled={pending} onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => setR(await action()));
      }}>{pending ? '…' : label}</button>
      {r && (r.error || r.creds?.length || r.ok) && (
        <div className="card" style={{ borderColor: 'var(--accent)', flexBasis: '100%' }}>
          {r.error && <div className="callout bad">{r.error}</div>}
          {r.ok && <div className="callout good">{r.ok}</div>}
          {!!r.creds?.length && (
            <>
              <p className="note" style={{ margin: 0 }}>Лозинките се прикажуваат <b>само сега</b> – испечатете ги или препишете ги и доставете ги на клиентите (при прва најава ја менуваат).</p>
              <div className="tw"><table className="dense">
                <thead><tr><th>Фирма</th><th>Корисничко име</th><th>Лозинка</th></tr></thead>
                <tbody>{r.creds.map((c) => <tr key={c.username}><td>{c.firm}</td><td><b>{c.username}</b></td><td><code style={{ fontSize: 13 }}>{c.password}</code></td></tr>)}</tbody>
              </table></div>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn pri" onClick={() => printCreds(r.creds!)}>🖨 Печати пристапни податоци</button>
                <button type="button" className="btn" onClick={() => setR(null)}>Затвори</button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
