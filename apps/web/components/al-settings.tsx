'use client';
/**
 * Notification reminder settings and voice — legacy `alSettingsHTML` (8592) „⚙ Потсетници: прозорец, е-пошта, глас“
 * („✉ Испрати сега“, „🔊 Прочитај сега“) and `alSpeak` (8576). Settings are per browser (legacy `alLS`, keys `al_*`).
 */
import { useEffect, useState, useTransition } from 'react';
import { alSummaryText, type AlItem } from '@wise/core/firms/picker';
import { alertItems, mailAlerts } from '@/app/(app)/top-actions';

export const alLS = {
  get: (k: string): string | null => { try { return localStorage.getItem('al_' + k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem('al_' + k, v); } catch { /* private window */ } },
};

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
