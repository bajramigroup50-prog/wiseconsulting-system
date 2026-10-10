'use client';
/**
 * Notification reminders — legacy `alStartup` (8582), `alPopup` (8587), `alSpeak` (8576), `alSettingsHTML` (8592) and the
 * daily e-mail. Settings are per browser (legacy `alLS`, keys `al_*`), as in legacy.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { alSummaryText, type AlItem } from '@wise/core/firms/picker';
import { alertItems, mailAlerts } from '@/app/(app)/top-actions';

export const alLS = {
  get: (k: string): string | null => { try { return localStorage.getItem('al_' + k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem('al_' + k, v); } catch { /* private window */ } },
};
const todayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Skopje' });

/** Legacy `alSpeak`: read the summary aloud (Macedonian voice, else a related Slavic one). Returns a hint when no mk voice. */
export function alSpeak(items: readonly AlItem[]): string | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return 'Овој прелистувач не може да чита на глас.';
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(alSummaryText(items, true));
  const V = speechSynthesis.getVoices();
  const v = V.find((x) => /^mk/i.test(x.lang)) || V.find((x) => /^(sr|bg|hr|bs)/i.test(x.lang)) || V.find((x) => /^ru/i.test(x.lang));
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'mk-MK';
  u.rate = 0.95;
  speechSynthesis.speak(u);
  return v ? null : 'На уредот нема македонски глас – се користи основниот. Во Windows: Settings → Time & language → Speech → додадете јазик.';
}

/** „🔊 Прочитај“ button (loads the open notifications, then speaks). */
export function AlVoiceButton({ label = '🔊 Прочитај', className = 'btn' }: { label?: string; className?: string }) {
  const [, start] = useTransition();
  return <button type="button" className={className} onClick={() => start(async () => { const m = alSpeak(await alertItems()); if (m) alert(m); })}>{label}</button>;
}

/** Legacy `alSettingsHTML`: popup / voice / daily e-mail switches. */
export function AlSettings({ email }: { email: string }) {
  const [s, setS] = useState({ pop: true, voice: false, auto: false, mail: email });
  const [msg, setMsg] = useState('');
  const [busy, start] = useTransition();
  useEffect(() => {
    setS({ pop: alLS.get('popup') !== 'off', voice: alLS.get('voice') === 'on', auto: alLS.get('auto') === 'on', mail: alLS.get('mail') || email });
  }, [email]);
  return (
    <details className="card">
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>⚙ Потсетници: прозорец, е-пошта, глас</summary>
      <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
        <label className="chk" style={{ margin: 0 }}><input type="checkbox" checked={s.pop} onChange={(e) => { alLS.set('popup', e.target.checked ? 'on' : 'off'); setS({ ...s, pop: e.target.checked }); }} /> Прозорец со итните известувања при првото отворање на програмата секој ден</label>
        <label className="chk" style={{ margin: 0 }}><input type="checkbox" checked={s.voice} onChange={(e) => { alLS.set('voice', e.target.checked ? 'on' : 'off'); setS({ ...s, voice: e.target.checked }); }} /> 🔊 Прочитај ги на глас при отворање</label>
        <label className="chk" style={{ margin: 0 }}><input type="checkbox" checked={s.auto} onChange={(e) => {
          alLS.set('auto', e.target.checked ? 'on' : 'off'); setS({ ...s, auto: e.target.checked });
          if (e.target.checked) { if (s.mail.trim()) alLS.set('mail', s.mail.trim()); else setMsg('Внесете ја е-поштата.'); }
        }} /> ✉ Испрати ми ги по е-пошта еднаш дневно, при првото отворање</label>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={s.mail} placeholder="vasa@e-posta.mk" style={{ width: 260 }} onChange={(e) => setS({ ...s, mail: e.target.value })} onBlur={() => alLS.set('mail', s.mail.trim())} />
          <button type="button" className="btn" disabled={busy} onClick={() => start(async () => {
            const to = s.mail.trim();
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+/.test(to)) { setMsg('Внесете е-пошта.'); return; }
            alLS.set('mail', to);
            const r = await mailAlerts(to, false);
            setMsg(r.ok ?? r.error ?? '');
          })}>✉ Испрати сега</button>
          <AlVoiceButton label="🔊 Прочитај сега" />
          {msg && <span className="mini">{msg}</span>}
        </div>
        <p className="mini" style={{ margin: 0 }}>Поставките важат за овој прелистувач/уред. Програмата не може да ѕвони кога е затворена – потсетникот доаѓа при отворање (прозорец, глас, е-пошта).</p>
      </div>
    </details>
  );
}

/** Legacy `alStartup`: once a day — popup (or a short notice on busy screens), optional voice and e-mail. */
export function AlStartup() {
  const path = usePathname();
  const [pop, setPop] = useState<AlItem[] | null>(null);
  const [toast, setToast] = useState('');
  const [noPop, setNoPop] = useState(false);
  useEffect(() => {
    let off = false;
    const t = setTimeout(async () => {
      const td = todayStr();
      const wantPop = alLS.get('popup') !== 'off' && alLS.get('popDay') !== td;
      const to = alLS.get('mail');
      const wantMail = alLS.get('auto') === 'on' && !!to && alLS.get('mailDay') !== td;
      const wantVoice = alLS.get('voice') === 'on' && alLS.get('voiceDay') !== td;
      if (!wantPop && !wantMail && !wantVoice) return;
      let I: AlItem[] = [];
      try { I = await alertItems(); } catch { return; }
      if (off) return;
      const bad = I.filter((a) => a.lvl === 'bad').length, warn = I.filter((a) => a.lvl === 'warn').length;
      if (!bad && !warn) return;
      if (wantPop) {
        alLS.set('popDay', td);
        if (['/', '/firmi', '/izvestuvanja'].includes(window.location.pathname)) setPop(I);
        else { setToast(`🔔 ${bad} итни и ${warn} известувања за внимание – Фирми → Известувања`); setTimeout(() => setToast(''), 6000); }
      }
      if (wantMail && to) {
        const r = await mailAlerts(to, true);
        if (r.ok) { alLS.set('mailDay', td); setToast('🔔 Известувањата се испратени на ' + to); setTimeout(() => setToast(''), 6000); }
      }
      if (wantVoice) { alLS.set('voiceDay', td); setTimeout(() => alSpeak(I), 800); }
    }, 2500);
    return () => { off = true; clearTimeout(t); };
  }, []);
  useEffect(() => { if (path === '/izvestuvanja') setPop(null); }, [path]);
  const bad = pop?.filter((a) => a.lvl === 'bad') ?? [], warn = pop?.filter((a) => a.lvl === 'warn') ?? [];
  return (
    <>
      {toast && <div className="toast" role="status" style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 950 }}>{toast}</div>}
      {pop && (
        <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) setPop(null); }}>
          <div className="card" style={{ maxWidth: 680, width: '100%' }}>
            <div className="hd"><h2>🔔 Потсетник: {bad.length} итни · {warn.length} за внимание</h2><button type="button" className="btn" onClick={() => setPop(null)}>Затвори</button></div>
            <div style={{ maxHeight: '50vh', overflow: 'auto' }}>
              {[...bad, ...warn].slice(0, 25).map((a, i) => (
                <div key={i} style={{ padding: '5px 0', borderBottom: '1px solid var(--line)' }}><span className={`pill ${a.lvl}`}>{a.lvl === 'bad' ? '🔴' : '🟠'}</span> <b>{a.firm}</b> – {a.txt}</div>
              ))}
            </div>
            <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <Link className="btn pri" href="/izvestuvanja" onClick={() => setPop(null)}>Отвори ги сите</Link>
              <button type="button" className="btn" onClick={() => { const m = alSpeak(pop); if (m) alert(m); }}>🔊 Прочитај на глас</button>
              <span style={{ flex: 1 }} />
              <label className="chk" style={{ margin: 0 }}><input type="checkbox" checked={noPop} onChange={(e) => { setNoPop(e.target.checked); alLS.set('popup', e.target.checked ? 'off' : 'on'); }} /> не прикажувај при отворање</label>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
