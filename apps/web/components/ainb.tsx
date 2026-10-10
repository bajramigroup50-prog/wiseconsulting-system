'use client';
/**
 * „📨 Дојдовни пораки од клиенти“ — legacy `ainbRender` (13997, floating button + panel bottom-left), `msgTop` (14015,
 * the envelope in the top bar, v447) and the dashboard chip `#heroMsg` (14010). One panel, opened from any of them.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { selectFirm } from '@/app/(app)/actions';
import { ainbDone } from '@/app/(app)/top-actions';

export interface AinbRow { id: string; fid: string; firm: string; at: string; from: string; note: string; nf: number }

const EV = 'wc-ainb';
export const ainbToggle = () => window.dispatchEvent(new Event(EV));

const MSG_CSS = '.msg-env{position:relative;display:inline-flex;align-items:center;justify-content:center;background:none;border:0;padding:2px 6px;margin-right:12px;cursor:pointer;filter:drop-shadow(0 3px 6px rgba(0,0,0,.18))}.msg-env.on{animation:msgPulse 1.6s ease-in-out infinite}.msg-env .msg-b{position:absolute;top:-6px;right:-4px;background:#d11a2a;color:#fff;font:700 13px/1 system-ui,sans-serif;border-radius:999px;min-width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;padding:0 6px;border:2px solid #fff}@keyframes msgPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}@media print{.msg-env,#ainb{display:none}}@media(prefers-reduced-motion:reduce){.msg-env.on{animation:none}}';

/** Top-bar envelope (legacy `#msgTop`). */
export function AinbEnvelope({ n }: { n: number }) {
  return (
    <>
      <style>{MSG_CSS}</style>
      <button type="button" id="msgTop" className={'msg-env' + (n ? ' on' : '')} onClick={ainbToggle}
        title={n ? n + ' нови пораки / документи од клиенти – кликнете' : 'Нема нови пораки од клиенти'} aria-label="Дојдовни пораки">
        <svg viewBox="0 0 48 36" width="44" height="33" aria-hidden="true">
          <rect x="2" y="2" width="44" height="32" rx="5" fill={n ? '#1f6feb' : '#eef3fb'} stroke={n ? '#1552b8' : '#9fb6dc'} strokeWidth="2" />
          <path d="M4 5 L24 21 L44 5" fill="none" stroke={n ? '#fff' : '#5b7fbf'} strokeWidth="2.6" strokeLinejoin="round" />
          <path d="M4 33 L18 17 M44 33 L30 17" stroke={n ? '#cfe0ff' : '#9fb6dc'} strokeWidth="1.6" />
        </svg>
        {n > 0 && <span className="msg-b">{n > 99 ? '99+' : n}</span>}
      </button>
    </>
  );
}

/** Dashboard chip (legacy `#heroMsg`). */
export function AinbHeroChip({ n, mine }: { n: number; mine: number }) {
  return (
    <p id="heroMsg" style={{ margin: '8px 0 0' }}>
      <button type="button" className="hchip" onClick={ainbToggle}
        style={{ cursor: 'pointer', border: 0, ...(n ? { background: '#fff', color: '#0f5a46', fontWeight: 700 } : {}) }}>
        📨 Дојдовни пораки{n ? `: ${n} нови${mine ? ` (од оваа фирма ${mine})` : ''}` : ' – нема нови'}
      </button>
    </p>
  );
}

/** Floating button + panel (legacy `#ainb`), also sets „(n)“ in front of the page title. */
export function AinbPanel({ items, current }: { items: AinbRow[]; current: string | null }) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [, start] = useTransition();
  const router = useRouter();
  const L = items.filter((x) => !hidden.has(x.id));
  const n = L.length;
  useEffect(() => {
    const t = () => setOpen((o) => !o);
    window.addEventListener(EV, t);
    return () => window.removeEventListener(EV, t);
  }, []);
  useEffect(() => {
    try { document.title = document.title.replace(/^\(\d+\) /, ''); if (n) document.title = '(' + n + ') ' + document.title; } catch { /* ignore */ }
  });
  const go = (fid: string) => start(async () => { setOpen(false); if (fid !== current) await selectFirm(fid); router.push('/klInbox'); });
  const done = (id: string) => start(async () => { const r = await ainbDone(id); if (r.ok) setHidden((s) => new Set(s).add(id)); else if (r.error) alert(r.error); });
  return (
    <div id="ainb" style={{ position: 'fixed', left: 18, bottom: 18, zIndex: 900 }}>
      {open && (
        <div className="card" style={{ width: 380, maxWidth: 'calc(100vw - 36px)', maxHeight: '60vh', overflow: 'auto', marginBottom: 8, boxShadow: '0 10px 30px rgba(0,0,0,.2)' }}>
          <div className="hd"><b>📨 Дојдовни пораки од клиенти</b><button type="button" className="btn sm" onClick={() => setOpen(false)}>✕</button></div>
          {L.length ? L.map((x) => (
            <div key={x.id} style={{ borderTop: '1px solid var(--line)', padding: '8px 0' }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}><b>{x.firm}</b><span className="mini">{x.at.slice(0, 10).split('-').reverse().join('.')} {new Date(x.at).toLocaleTimeString('mk-MK', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Skopje' })}</span></div>
              <div className="mini">{x.from}{x.nf ? ' · 📎 ' + x.nf + ' датотеки' : ''}</div>
              {x.note && <div style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>{x.note}</div>}
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className="btn sm pri" onClick={() => go(x.fid)}>Отвори</button>
                <button type="button" className="btn sm" onClick={() => done(x.id)}>✓ Обработено</button>
              </div>
            </div>
          )) : <div className="note">Нема нови пораки.</div>}
        </div>
      )}
      <div>
        <button type="button" className={'btn' + (n ? ' pri' : '')} onClick={() => setOpen((o) => !o)}
          style={{ borderRadius: 24, padding: '10px 16px', boxShadow: '0 6px 18px rgba(0,0,0,.18)', ...(n ? {} : { opacity: 0.85 }) }}>
          📨 Дојдовни пораки{n > 0 && <span style={{ background: '#d33', color: '#fff', borderRadius: 12, padding: '1px 8px', marginLeft: 4 }}>{n}</span>}
        </button>
      </div>
    </div>
  );
}
