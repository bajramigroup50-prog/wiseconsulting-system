'use client';
/** „🏦 Изводи од банка“ — the waiting list (tick, print, approve) and the owner's connection settings. */
import { useState, useTransition } from 'react';
import { ActionForm } from '@/components/action-form';
import { RowAction } from '@/components/row-action';
import { approveFeedAction, deleteFeedAction, makeKeyAction, rejectFeedAction, runFeedAction, saveFeedAction, setFeedFirmAction } from './actions';

export interface FeedSt { no: string; date: string; account: string; opening: number | null; closing: number | null; lines: number; inn: number; out: number }
export interface FeedRow {
  id: string; at: string; status: string; result: string; firmId: string | null; firmName: string | null; fileId: string; fileName: string;
  feed: string; printedAt: string | null; problems: boolean; st: FeedSt[];
}
export interface FeedConf {
  id: string; name: string; bank: string; method: string; host: string; port: number | null; username: string; path: string; pattern: string;
  hasPassword: boolean; hold: boolean; at: string; active: boolean; lastRunAt: string | null; lastOk: boolean | null; lastResult: string | null;
}

const m = (c: number | null) => (c == null ? '—' : (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const dmy = (d: string) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '');
/** Already formatted on the server (Skopje time) – the same text on the server and in the browser. */
const dt = (s: string) => s;

export function FeedList({ waiting, decided, firms }: { waiting: FeedRow[]; decided: FeedRow[]; firms: { id: string; name: string }[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const ready = waiting.filter((r) => r.firmId && r.st.length && !r.problems);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const all = sel.size > 0 && waiting.every((r) => sel.has(r.id));
  const ids = [...sel];
  const approve = (L: string[]) => {
    if (!L.length) { setMsg({ error: 'Штиклирајте изводи.' }); return; }
    if (!confirm(`Да се прокнижат ${L.length} извод(и)?`)) return;
    start(async () => { const r = await approveFeedAction(L); setMsg(r); setSel(new Set()); });
  };
  const print = (L: string[]) => { if (L.length) window.open('/bankFeed/print?ids=' + L.join(','), '_blank'); };
  return (
    <div className="card">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>⏳ Чекаат одобрување · {waiting.length}</h2>
        <span style={{ flex: 1 }} />
        <button className="btn" disabled={!waiting.length} onClick={() => print(waiting.map((r) => r.id))}>🖨 Печати ги сите нови</button>
        <button className="btn" disabled={!ids.length} onClick={() => print(ids)}>🖨 Печати избрани ({ids.length})</button>
        <button className="btn pri" disabled={pending || !ids.length} onClick={() => approve(ids)}>✓ Одобри и прокнижи избрани ({ids.length})</button>
        <button className="btn" disabled={pending || !ready.length} onClick={() => approve(ready.map((r) => r.id))} title="Сите со препознаена фирма и усогласени салда">✓ Прокнижи ги сите проверени ({ready.length})</button>
      </div>
      {msg && <div className={`callout ${msg.error ? 'warn' : 'good'}`} style={{ marginTop: 8 }}>{msg.error ?? msg.ok}</div>}
      {!waiting.length ? <p className="note">Нема изводи што чекаат. Новите стигнуваат секоја вечер во поставеното време.</p> : (
        <div className="tw" style={{ marginTop: 10 }}><table>
          <thead><tr>
            <th style={{ width: 28 }}><input type="checkbox" checked={all} onChange={() => setSel(all ? new Set() : new Set(waiting.map((r) => r.id)))} /></th>
            <th>Пристигнат</th><th>Фирма</th><th>Извод</th><th className="n">Почетно</th><th className="n">Прилив</th><th className="n">Одлив</th><th className="n">Крајно</th><th>Статус</th><th></th>
          </tr></thead>
          <tbody>
            {waiting.map((r) => (
              <tr key={r.id}>
                <td><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td className="mini">{dt(r.at)}<br />{r.feed}</td>
                <td>{r.firmId ? <b>{r.firmName}</b> : (
                  <ActionForm action={setFeedFirmAction} className="" reset={false}>
                    <input type="hidden" name="id" value={r.id} />
                    <select name="firmId" defaultValue="" style={{ maxWidth: 220 }}><option value="" disabled>— изберете фирма —</option>{firms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
                    <button className="btn sm">OK</button>
                  </ActionForm>
                )}</td>
                <td>{r.st.map((s) => <div key={s.no + s.date}>бр. <b>{s.no || '—'}</b> од {dmy(s.date)} · {s.account} · {s.lines} ставки</div>)}<div className="mini">{r.fileName}</div></td>
                <td className="n">{r.st.map((s) => <div key={s.no}>{m(s.opening)}</div>)}</td>
                <td className="n" style={{ color: 'var(--good, #0a7d3b)' }}>{r.st.map((s) => <div key={s.no}>{m(s.inn)}</div>)}</td>
                <td className="n" style={{ color: 'var(--bad, #b42318)' }}>{r.st.map((s) => <div key={s.no}>{m(s.out)}</div>)}</td>
                <td className="n">{r.st.map((s) => <div key={s.no}>{m(s.closing)}</div>)}</td>
                <td className="mini" style={{ maxWidth: 260 }}>{r.printedAt ? <span className="pill">🖨 испечатен</span> : <span className="pill warn">не е печатен</span>} {r.result}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <a className="btn sm" href={`/api/files/${r.fileId}`} target="_blank" rel="noopener" title="Оригиналот од банката">👁</a>
                  <button className="btn sm" onClick={() => print([r.id])} title="Печати">🖨</button>
                  {r.firmId && r.st.length > 0 && <RowAction action={approveFeedAction.bind(null, [r.id])} label="✓ Прокнижи" className="btn sm pri" confirm="Да се прокнижи изводот?" showOk />}
                  <RowAction action={rejectFeedAction.bind(null, r.id)} label="✕" title="Отфрли (не се книжи)" confirm="Да се отфрли изводот? Нема да се прокнижи." />
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {decided.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary>📜 Последни обработени ({decided.length})</summary>
          <table className="dense"><tbody>
            {decided.map((r) => <tr key={r.id}><td className="mini">{dt(r.at)}</td><td>{r.firmName ?? '—'}</td><td>{r.st.map((s) => `бр. ${s.no} од ${dmy(s.date)}`).join(', ') || r.fileName}</td><td className="mini">{r.status === 'done' ? '✓ ' : r.status === 'skipped' ? '✕ ' : ''}{r.result}</td><td><a className="btn sm" href={`/api/files/${r.fileId}`} target="_blank" rel="noopener">👁</a></td></tr>)}
          </tbody></table>
        </details>
      )}
    </div>
  );
}

const METHOD: Record<string, string> = { sftp: 'SFTP (host-to-host)', imap: 'Е-пошта (IMAP)', folder: 'Папка на серверот' };

function FeedForm({ f }: { f?: FeedConf }) {
  const [method, setMethod] = useState(f?.method ?? 'sftp');
  return (
    <ActionForm action={saveFeedAction} reset={!f}>
      {f && <input type="hidden" name="id" value={f.id} />}
      <div className="form">
        <label className="f">Назив<input name="name" required defaultValue={f?.name ?? ''} placeholder="Халк Банка – SFTP" /></label>
        <label className="f">Банка<select name="bank" defaultValue={f?.bank ?? ''}>
          <option value="">—</option><option value="270">Халк Банка</option><option value="300">Комерцијална Банка</option><option value="210">НЛБ Банка</option>
          <option value="200">Стопанска Банка</option><option value="250">Шпаркасе Банка</option><option value="380">ПроКредит Банка</option><option value="530">УНИ Банка</option>
          <option value="370">Силк Роуд Банка</option><option value="320">ТТК Банка</option><option value="500">Капитал / друга</option>
        </select></label>
        <label className="f">Начин<select name="method" value={method} onChange={(e) => setMethod(e.target.value)}>{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {method !== 'folder' && <label className="f">Сервер (host)<input name="host" defaultValue={f?.host ?? ''} placeholder={method === 'imap' ? 'imap.gmail.com' : 'sftp.halkbank.mk'} /></label>}
        {method !== 'folder' && <label className="f">Порта<input name="port" type="number" defaultValue={f?.port ?? ''} placeholder={method === 'imap' ? '993' : '22'} /></label>}
        {method !== 'folder' && <label className="f">Корисник<input name="username" defaultValue={f?.username ?? ''} autoComplete="off" /></label>}
        {method !== 'folder' && <label className="f">Лозинка {method === 'sftp' && <span className="mini">(празно = SSH клучот)</span>}<input name="password" type="password" autoComplete="new-password" placeholder={f?.hasPassword ? '•••••• (зачувана)' : ''} /></label>}
        <label className="f">{method === 'imap' ? 'Папка во поштата' : 'Папка'}<input name="path" defaultValue={f?.path ?? ''} placeholder={method === 'imap' ? 'INBOX' : method === 'folder' ? '/data/bank/halk' : '/out'} /></label>
        <label className="f">Датотеки<input name="pattern" defaultValue={f?.pattern ?? ''} placeholder="*.xml;*.sta;*.pdf (празно = сите)" /></label>
        <label className="f">Време (секоја вечер)<input name="at" type="time" defaultValue={f?.at ?? '20:00'} /></label>
      </div>
      <div className="row" style={{ gap: '4px 16px', flexWrap: 'wrap' }}>
        <label className="chk"><input type="checkbox" name="auto" defaultChecked={f ? !f.hold : false} /> Книжи автоматски (без одобрување) кога фирмата е сигурна</label>
        {f?.hasPassword && <label className="chk"><input type="checkbox" name="clearPassword" /> Избриши ја лозинката</label>}
        {f && <label className="chk"><input type="checkbox" name="active" value="off" defaultChecked={!f.active} /> Исклучена</label>}
      </div>
      <button className="btn pri">{f ? 'Зачувај' : '+ Додај врска'}</button>
    </ActionForm>
  );
}

export function FeedSettings({ feeds, pub, pubRsa }: { feeds: FeedConf[]; pub: string; pubRsa: string }) {
  const [copied, setCopied] = useState(false);
  const [copiedR, setCopiedR] = useState(false);
  return (
    <div className="card">
      <h2 style={{ fontSize: 16 }}>⚙ Врски со банки <span className="mini">(само сопственикот)</span></h2>
      <p className="note">Податоците за врската ги дава банката. IP адресата на серверот за „whitelist“ кај банката: <b>207.180.254.154</b>. Ништо не се брише кај банката; секоја датотека се презема еднаш.</p>
      <div className="callout" style={{ margin: '8px 0' }}>
        <b>🔑 SSH клуч за SFTP (host-to-host)</b> – на банката ѝ се праќа само јавниот клуч:
        {pub ? (
          <>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11, background: '#f6f6f6', padding: 8, margin: '6px 0' }}>{pub}</pre>
            <button className="btn sm" onClick={() => { navigator.clipboard.writeText(pub); setCopied(true); }}>{copied ? '✓ Копирано' : '📋 Копирај'}</button>{' '}
            <RowAction action={makeKeyAction.bind(null, true)} label="Нов клуч" confirm="Нов клуч? Стариот престанува да важи – новиот треба повторно да се испрати до банките." showOk />
          </>
        ) : <> <RowAction action={makeKeyAction.bind(null, false)} label="🔑 Направи клуч" className="btn sm pri" showOk /></>}
      </div>
      <div className="callout" style={{ margin: '8px 0' }}>
        <b>🔑 SSH-RSA 4096 клуч</b> – за банките што бараат клуч од тип „ssh-rsa“ со должина 4096 (на пр. Комерцијална банка). Врската сама го пробува клучот што банката го прифаќа.
        <div style={{ margin: '6px 0' }}><a className="btn sm" href="/print/kbH2h" target="_blank" rel="noreferrer">🖨 Комерцијална: Барање + Договор (Host-to-Host) за избраната фирма</a> <span className="mini">– изберете ја фирмата горе, па печатете; се пополнуваат назив, сметка, управител, IP и клучот.</span></div>
        {pubRsa ? (
          <>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11, background: '#f6f6f6', padding: 8, margin: '6px 0' }}>{pubRsa}</pre>
            <button className="btn sm" onClick={() => { navigator.clipboard.writeText(pubRsa); setCopiedR(true); }}>{copiedR ? '✓ Копирано' : '📋 Копирај'}</button>{' '}
            <RowAction action={makeKeyAction.bind(null, true, 'rsa')} label="Нов RSA клуч" confirm="Нов RSA клуч? Стариот престанува да важи – новиот треба повторно да се испрати до банката." showOk />
          </>
        ) : <> <RowAction action={makeKeyAction.bind(null, false, 'rsa')} label="🔑 Направи RSA 4096 клуч" className="btn sm pri" showOk /></>}
      </div>
      {feeds.map((f) => (
        <details key={f.id} className="card" style={{ margin: '8px 0' }}>
          <summary>
            <b>{f.name}</b> · {METHOD[f.method] ?? f.method}{f.host ? ` · ${f.host}` : ''} · {f.at} {f.hold ? '· чека одобрување' : '· автоматско книжење'}{!f.active ? ' · ИСКЛУЧЕНА' : ''}{' '}
            <div className="mini" style={{ marginTop: 2, color: f.lastOk === false ? 'var(--bad, #b42318)' : undefined }}>{f.lastRunAt ? `Последно: ${dt(f.lastRunAt)} – ${f.lastResult ?? ''}` : 'Сè уште не е пуштена.'}</div>
          </summary>
          <div className="row" style={{ gap: 6, margin: '8px 0' }}>
            <RowAction action={runFeedAction.bind(null, f.id, true)} label="🔌 Тест на врската" className="btn sm" showOk />
            <RowAction action={runFeedAction.bind(null, f.id, false)} label="⬇ Преземи сега" className="btn sm" showOk />
            <RowAction action={deleteFeedAction.bind(null, f.id)} label="🗑 Избриши врска" className="btn sm ghost" confirm={`Да се избрише врската „${f.name}“? Преземените изводи остануваат.`} />
          </div>
          <FeedForm f={f} />
        </details>
      ))}
      <details style={{ marginTop: 8 }}>
        <summary className="btn">+ Нова врска со банка</summary>
        <FeedForm />
      </details>
    </div>
  );
}
