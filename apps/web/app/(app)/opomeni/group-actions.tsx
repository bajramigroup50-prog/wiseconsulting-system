'use client';
/** Per-customer letter controls: level (legacy `data-oplv` select), e-mail compose, WhatsApp / Viber, PDF. */
import { useActionState, useState, useTransition } from 'react';
import type { RowResult } from '@/components/row-action';
import { logDunning, sendDunning } from './actions';

const LV = ['1. Опомена', '2. Опомена', 'Последна опомена пред тужба'];

export function GroupActions({ pid, lvlAuto, email, phone, texts, canMail }: {
  pid: string; lvlAuto: number; email: string; phone: string; texts: { subj: string; body: string }[]; canMail: boolean;
}) {
  const [lvl, setLvl] = useState(lvlAuto);
  const [open, setOpen] = useState<'' | 'mail' | 'wa'>('');
  const [ph, setPh] = useState(phone);
  const [st, run, busy] = useActionState<RowResult, FormData>(sendDunning.bind(null, pid), {});
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState('');
  const t = texts[lvl]!;
  const [waText, setWaText] = useState(t.body);
  const log = (channel: string) => start(async () => { const r = await logDunning(pid, lvl, channel); setMsg(r.error ?? r.ok ?? ''); });
  return (
    <>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        <select value={lvl} onChange={(e) => { setLvl(+e.target.value); setWaText(texts[+e.target.value]!.body); }} title="Која опомена се праќа – програмата предлага според испратените претходно (не се бројат PDF и повторно праќање истиот ден)" style={{ fontWeight: 700, width: 'auto', maxWidth: 280, flex: '0 0 auto' }}>
          {LV.map((n, i) => <option key={i} value={i}>{n}{i === lvlAuto ? ' (предлог)' : ''}</option>)}
        </select>
        {canMail && <button type="button" className="btn sm pri" onClick={() => setOpen(open === 'mail' ? '' : 'mail')}>✉ Е-пошта</button>}
        {canMail && <button type="button" className="btn sm" style={{ borderColor: '#25D366' }} onClick={() => { setWaText(t.body); setOpen(open === 'wa' ? '' : 'wa'); }}>💬 WhatsApp / Viber</button>}
        <button type="button" className="btn sm" disabled={pending} onClick={() => { window.open(`/opomeni/pecati?p=${encodeURIComponent(pid)}&l=${lvl}`, '_blank'); if (canMail) log('PDF'); }}>⬇ PDF опомена</button>
        {msg && <span className="mini">{msg}</span>}
      </div>
      {open === 'mail' && (
        <form className="card" style={{ borderColor: 'var(--accent)', marginTop: 8 }} action={run} key={lvl}>
          <b>✉ {LV[lvl]}</b>
          {st.error && <div className="callout bad">{st.error}</div>}
          {st.ok && <div className="callout good">{st.ok}</div>}
          <input type="hidden" name="lvl" value={lvl} />
          <label className="f">До<input name="to" type="email" defaultValue={email} required /></label>
          <label className="f">Наслов<input name="subject" defaultValue={t.subj} /></label>
          <label className="f">Порака<textarea name="body" rows={12} defaultValue={t.body} /></label>
          <p className="mini" style={{ margin: 0 }}>Опомената (како во PDF) се додава под текстот; потписот и напомената од „✏ Потпис и напомена“ – на крајот.</p>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn pri" disabled={busy}>{busy ? 'Се праќа…' : '✉ Испрати'}</button>
            <button type="button" className="btn" onClick={() => setOpen('')}>Откажи</button>
          </div>
        </form>
      )}
      {open === 'wa' && (
        <div className="card" style={{ borderColor: '#25D366', marginTop: 8 }}>
          <b>💬 {LV[lvl]}</b>
          <label className="f">Телефон (со 389)<input value={ph} onChange={(e) => setPh(e.target.value)} /></label>
          <label className="f">Порака<textarea rows={10} value={waText} onChange={(e) => setWaText(e.target.value)} /></label>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <a className="btn pri" href={`https://wa.me/${ph.replace(/\D/g, '')}?text=${encodeURIComponent(waText)}`} target="_blank" rel="noopener noreferrer" style={{ background: '#25D366', borderColor: '#25D366', textDecoration: 'none' }}>Отвори WhatsApp</a>
            <a className="btn pri" href={`viber://forward?text=${encodeURIComponent(waText)}`} style={{ background: '#7360F2', borderColor: '#7360F2', textDecoration: 'none' }}>Отвори Viber</a>
            <button type="button" className="btn" disabled={pending} onClick={() => { log('WhatsApp/Viber'); setOpen(''); }}>✓ Испратено – запамети</button>
            <button type="button" className="btn" onClick={() => setOpen('')}>Откажи</button>
          </div>
        </div>
      )}
    </>
  );
}

/** Legacy `opWaAll`: one row per customer with a phone; WhatsApp cannot be sent automatically, the user clicks each. */
export function WaAllRow({ pid, lvl, href, viber }: { pid: string; lvl: number; href: string; viber: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState('');
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <a className="btn sm pri" href={href} target="_blank" rel="noopener noreferrer" style={{ background: '#25D366', borderColor: '#25D366', textDecoration: 'none' }}>Отвори WhatsApp</a>{' '}
      <a className="btn sm" href={viber}>Viber</a>{' '}
      <button type="button" className="btn sm" disabled={pending || !!done} onClick={() => start(async () => { const r = await logDunning(pid, lvl, 'WhatsApp/Viber'); setDone(r.error ?? '✓'); })}>{done || '✓ Испратено'}</button>
    </span>
  );
}
