'use client';
/** Legacy `npModal` 17048: distribute one journal line without partner (konto 12.. / 22..) over partners. */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { npDistAction } from '@/app/(app)/zsProc/actions';

export interface NpLine { id: number; account: string; side: 'd' | 'p'; amt: number; jdesc: string; jdate: string; jnumber: string; kind: string; kname: string; withP: number }

const f2 = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (s: string) => { const v = Number(String(s ?? '').replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return Number.isFinite(v) ? v : 0; };

export function NpDist({ g, list, ti, names, turnover }: { g: '12' | '22'; list: NpLine[]; ti: number; names: string[]; turnover: string[] }) {
  const T = list[ti]!;
  const [rows, setRows] = useState<{ n: string; a: string }[]>([{ n: '', a: '' }]);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const dist = Math.round(rows.reduce((s, r) => s + num(r.a), 0) * 100) / 100;
  const rest = Math.round((T.amt - dist) * 100) / 100;
  const who = g === '12' ? 'купувачи' : 'добавувачи';
  const imp = T.kind === 'bbimp' || T.kind === 'open';
  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <div className="hd"><h2>Распредели по {who} – конто {T.account}</h2><a className="btn" href="/zsKontrola">Затвори</a></div>
      <div style={{ margin: '6px 0 10px', padding: '10px 12px', background: 'var(--soft)', borderRadius: 8, lineHeight: 1.55 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Од каде е овој износ?</div>
        <div>Налог: <b>{T.jnumber} {T.jdesc}</b>{T.jdate ? ' · датум ' + T.jdate.split('-').reverse().join('.') : ''}</div>
        <div>Конто: <b>{T.account}</b> {T.kname} · {T.side === 'd' ? <><b>должи</b> (побарување од купувачи)</> : <><b>побарува</b> (обврска кон добавувачи)</>}: <b>{f2(T.amt)}</b> – <span style={{ color: 'var(--warn)' }}>без партнер</span></div>
        {imp && <div className="mini">Износот е <b>збирното салдо</b> на конто {T.account} од {T.kind === 'bbimp' ? 'увезениот бруто биланс' : 'почетната состојба'} – при увозот не беа прочитани имињата на {who}. Во стариот програм отпечатете аналитичка картица / ИОС по {who} за конто {T.account} и препишете ги салдата тука.</div>}
        {T.withP > 0 && <div className="mini">На истото конто во налогот веќе има {T.withP} ставки со партнер.</div>}
        {list.length > 1 && <div className="mini">Ставки без партнер: {list.map((x, i) => <a key={x.id} className={`pill ${i === ti ? 'info' : ''}`} href={`/zsKontrola?np=${g}&ti=${i}`}>{x.account} · {f2(x.amt)}</a>)}</div>}
      </div>
      <datalist id="npPL">{names.map((n) => <option key={n} value={n} />)}</datalist>
      <div className="tw"><table className="dense">
        <thead><tr><th>Партнер (пишете дел од името)</th><th className="n" style={{ width: 170 }}>Износ</th><th /></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i}><td><input list="npPL" value={r.n} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, n: e.target.value } : x)))} style={{ width: '100%' }} /></td>
            <td><input inputMode="decimal" value={r.a} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} style={{ width: 150, textAlign: 'right' }} /></td>
            <td><button type="button" className="btn sm ghost" onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ n: '', a: '' }])}>✕</button></td></tr>
        ))}</tbody>
        <tfoot><tr><td>Распределено</td><td className="n">{f2(dist)}</td><td /></tr>
          <tr><td>Остаток без партнер</td><td className="n" style={{ color: Math.abs(rest) < 0.01 ? 'var(--good)' : rest < 0 ? 'var(--bad)' : 'var(--warn)' }}>{f2(rest)}</td><td /></tr></tfoot>
      </table></div>
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button type="button" className="btn" onClick={() => setRows([...rows, { n: '', a: '' }])}>+ Ред</button>
        <button type="button" className="btn" onClick={() => { const have = new Set(rows.map((r) => r.n)); setRows([...rows.filter((r) => r.n || r.a), ...turnover.filter((n) => !have.has(n)).map((n) => ({ n, a: '' }))]); }}>+ Сите {who} со промет</button>
        <span style={{ flex: 1 }} />
        {list.length > 1 && <span className="mini">Ставка {ti + 1} од {list.length}</span>}
        <button type="button" className="btn pri" disabled={pending} onClick={() => start(async () => { const r = await npDistAction(T.id, rows); setMsg(r); if (!r.error) router.refresh(); })}>Зачувај распределба</button>
      </div>
      {msg && <div className={'callout ' + (msg.error ? 'bad' : 'good')} style={{ marginTop: 8 }}>{msg.error ?? msg.ok}</div>}
      <p className="mini" style={{ marginTop: 6 }}>Нов партнер (што го нема во шифрарникот) се креира при зачувување.</p>
    </div>
  );
}
