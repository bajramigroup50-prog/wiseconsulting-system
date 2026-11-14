'use client';
/**
 * „✉ Е-пошта → WISE“ card on „📥 Пристигнати документи“ (owner only): the office mailbox (info@…) read every 10
 * minutes; each document of a client's mail lands here, in its firm. Server / user / password (sealed, never shown),
 * how many days back the first reading goes, on / off, test, read now, read again; the learned senders.
 */
import { useActionState, useState, useTransition } from 'react';
import type { ActionState } from '@/lib/books';
import { forgetSenderAction, runMailInAction, saveMailInAction } from './mail-in-actions';

export interface MailInView {
  on: boolean; host: string; port: number; user: string; folder: string; days: number; hasPass: boolean; forwarders: string[];
  lastRun: string | null; ok: boolean | null; result: string | null; senders: { addr: string; firm: string }[];
}

export function MailInCard({ c }: { c: MailInView }) {
  const [st, act, busy] = useActionState<ActionState, FormData>(saveMailInAction, {});
  const [msg, setMsg] = useState<ActionState>({});
  const [pend, start] = useTransition();
  const run = (w: 'test' | 'now' | 'restart') => start(async () => setMsg(await runMailInAction(w)));
  const [open, setOpen] = useState(!c.host);
  return (
    <details className="card" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary style={{ cursor: 'pointer' }}>
        <b>✉ Е-пошта → WISE</b>{' '}
        <span className={`pill ${c.on ? (c.ok === false ? 'bad' : 'good') : ''}`}>{c.on ? `вклучено · ${c.user}` : 'исклучено'}</span>
        {c.result && <small className="mini"> · {c.result}{c.lastRun ? ` (${new Date(c.lastRun).toLocaleString('mk-MK', { timeZone: 'Europe/Skopje' })})` : ''}</small>}
      </summary>
      <p className="note" style={{ marginTop: 8 }}>
        Програмата го чита сандачето на канцеларијата на секои 10 минути. Секој прилог (фактура, извод, договор…) од пораките на
        клиентите влегува тука, <b>во фирмата на клиентот</b> – според испраќачот, ЕДБ или името на фирмата во пораката. Кога не е
        сигурно, чека овде под „🏢 Канцеларија“: изберете фирма и следните пораки од тој испраќач одат таму сами.
        Пораките во сандачето <b>не се менуваат</b> (не се бришат, не се означуваат како прочитани).
      </p>
      <form action={act} className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="f">Сервер (IMAP)<input name="host" defaultValue={c.host} placeholder="arya.mk-host.mk" required style={{ width: 190 }} /></label>
        <label className="f">Порта<input name="port" type="number" defaultValue={c.port} style={{ width: 80 }} /></label>
        <label className="f">Е-пошта (корисник)<input name="user" type="email" defaultValue={c.user} placeholder="info@wiseconsulting.com.mk" required style={{ width: 240 }} /></label>
        <label className="f">Лозинка<input name="pass" type="password" autoComplete="new-password" placeholder={c.hasPass ? '•••••• (зачувана)' : 'лозинката на сандачето'} style={{ width: 180 }} /></label>
        <label className="f">Папка<input name="folder" defaultValue={c.folder} style={{ width: 100 }} /></label>
        <label className="f">Прво читање: дена наназад<input name="days" type="number" min={1} max={1095} defaultValue={c.days} style={{ width: 90 }} /></label>
        <label className="f" title="Наши адреси што препраќаат пошта тука (на пр. Hotmail со правило „Препрати / Redirect“): клиентот се чита од текстот на пораката.">Препраќа и од (наши адреси)<input name="forwarders" defaultValue={c.forwarders.join(', ')} placeholder="vbkonsalting@hotmail.com" style={{ width: 230 }} /></label>
        <label className="chk"><input type="checkbox" name="on" defaultChecked={c.on || !c.host} /> вклучено</label>
        <button className="btn pri" disabled={busy}>Зачувај</button>
      </form>
      {(st.error || st.ok) && <div className={`callout ${st.error ? 'bad' : 'good'}`}>{st.error ?? st.ok}</div>}
      {c.hasPass && <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn sm" disabled={pend} onClick={() => run('test')}>🔌 Провери врска</button>
        <button type="button" className="btn sm" disabled={pend} onClick={() => run('now')}>⬇ Прочитај сега</button>
        <button type="button" className="btn sm ghost" disabled={pend} onClick={() => { if (confirm(`Да се прочитаат пак сите пораки од последните ${c.days} дена? Веќе преземените документи не се додаваат двапати.`)) run('restart'); }}>↺ Одново од почеток</button>
        {(msg.error || msg.ok) && <small className="mini" style={{ color: msg.error ? 'var(--bad)' : undefined }}>{msg.error ?? msg.ok} (освежете за резултатот)</small>}
      </div>}
      {c.senders.length > 0 && (
        <details style={{ marginTop: 8 }}><summary className="mini" style={{ cursor: 'pointer' }}>Запаметени испраќачи ({c.senders.length})</summary>
          {c.senders.map((s) => <div key={s.addr} className="mini" style={{ marginTop: 3 }}>{s.addr} → <b>{s.firm}</b>{' '}
            <button type="button" className="btn sm ghost" onClick={() => start(async () => setMsg(await forgetSenderAction(s.addr)))}>заборави</button></div>)}
        </details>
      )}
    </details>
  );
}
