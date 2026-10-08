'use client';
/** "🔎 Провери датотека пред увоз" (legacy `bf_files` + `bkAnalyze`): nothing is booked, only what the file contains is shown. */
import { useState, useTransition } from 'react';
import { BANKS_MK } from '@wise/core/bank/payment-order';
import { analyzeFilesAction, type Analysis } from './actions';

const yes = (v: boolean) => (v ? <span className="pill good">✓</span> : <span className="pill bad">✗</span>);

export function Analyzer() {
  const [rows, setRows] = useState<Analysis[]>([]);
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="card"><h2>🔎 Провери датотека пред увоз</h2>
      <p className="note">Изберете една или повеќе датотеки од е-банкарството (XML, MT940/TXT, XLS/XLSX, CSV, .300, PDF). Програмот <b>не ги книжи</b> – само покажува што содржат: назив на комитентот, цел, салда, број на извод. Најдобриот формат за секоја банка се памети.</p>
      <input type="file" multiple disabled={pending} onChange={(e) => {
        const L = Array.from(e.target.files ?? []);
        e.target.value = '';
        if (!L.length) return;
        start(async () => {
          const f = new FormData();
          for (const x of L) f.append('file', x);
          const r = await analyzeFilesAction(f);
          setErr(r.error ?? '');
          if (r.rows) setRows((o) => [...r.rows!, ...o].slice(0, 30));
        });
      }} />
      {pending && <span className="note"> Се чита…</span>}
      {err && <div className="callout bad">{err}</div>}
      {rows.length > 0 && (
        <div className="tw" style={{ marginTop: 10 }}><table className="dense">
          <thead><tr><th>Датотека</th><th>Банка</th><th>Формат</th><th className="n">Ставки</th><th>Назив комитент</th><th>Цел / опис</th><th>Салда</th><th>Бр. извод</th><th>Ден. против.</th><th>Шифра</th><th>Оценка</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}>
              <td><small>{r.file}</small></td><td>{BANKS_MK[r.bank]?.n ?? (r.bank || '?')}</td>
              <td><b>{r.fmt}</b>{r.note && <><br /><small className="mut">{r.note}</small></>}</td><td className="n">{r.n || ''}</td>
              <td>{r.n ? `${r.names}/${r.n} ${r.names / r.n >= 0.8 ? '✓' : r.names ? '◐' : '✗'}` : '—'}</td><td>{r.n ? `${r.purp}/${r.n}` : '—'}</td>
              <td>{yes(r.bal)}</td><td>{r.no || '✗'}</td><td>{r.mkd ? '✓' : '—'}</td><td>{r.osnov ? '✓' : '—'}</td>
              <td>{r.fmt.startsWith('PDF') ? <span className="pill info">се чита со AI</span> : r.score >= 4 ? <span className="pill good">целосен</span> : r.score >= 2.5 ? <span className="pill warn">делумен</span> : <span className="pill bad">слаб</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
