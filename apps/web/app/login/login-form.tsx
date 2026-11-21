'use client';
import { useActionState, useEffect, useState } from 'react';
import { login } from './actions';

const MFA_ASK = '§2FA§';
const REMEMBER = 'wise-login-user';

type Lang = 'mk' | 'sq';
const T = {
  mk: {
    title: 'Најава', user: 'Корисничко име', pass: 'Лозинка', remember: 'Запамети', forgot: 'Заборавена лозинка?', go: 'Најави се',
    code: '🔐 Код од телефонот (6 цифри)', lost: 'Изгубен телефон? Внесете еден од резервните кодови (на пр. ABCD-EFGH).', ok: 'Потврди', back: '← Назад',
    show: 'Прикажи лозинка', hide: 'Скриј лозинка', caps: '⚠ Caps Lock е вклучен',
    forgotText: (m: string) => `Новата лозинка ја дава канцеларијата. Јавете се или пишете на ${m}.`,
    rules: 'Од безбедносни причини најавата завршува кога ќе се затвори програмата, по 60 минути без активност и најдоцна по 8 часа.',
    safe: '🔒 Заштитена врска · 2FA',
  },
  sq: {
    title: 'Hyrja', user: 'Emri i përdoruesit', pass: 'Fjalëkalimi', remember: 'Më mbaj mend', forgot: 'Keni harruar fjalëkalimin?', go: 'Hyr',
    code: '🔐 Kodi nga telefoni (6 shifra)', lost: 'Keni humbur telefonin? Shkruani një nga kodet rezervë (p.sh. ABCD-EFGH).', ok: 'Konfirmo', back: '← Kthehu',
    show: 'Shfaq fjalëkalimin', hide: 'Fshih fjalëkalimin', caps: '⚠ Caps Lock është i ndezur',
    forgotText: (m: string) => `Fjalëkalimin e ri e jep zyra. Telefononi ose shkruani te ${m}.`,
    rules: 'Për siguri, hyrja mbaron kur mbyllet programi, pas 60 minutash pa aktivitet dhe më së voni pas 8 orësh.',
    safe: '🔒 Lidhje e mbrojtur · 2FA',
  },
} as const;

/* the server's messages (actions.ts, lib/login-guard.ts) in Albanian */
const SQ_MSG: Record<string, string> = {
  'Погрешно корисничко име или лозинка.': 'Emër përdoruesi ose fjalëkalim i gabuar.',
  'Премногу неуспешни обиди. Обидете се повторно за 15 минути.': 'Shumë tentativa të gabuara. Provoni përsëri pas 15 minutash.',
  'Внесете корисничко име и лозинка.': 'Shkruani emrin e përdoruesit dhe fjalëkalimin.',
  'Внесете го кодот од апликацијата (Google / Microsoft Authenticator).': 'Shkruani kodin nga aplikacioni (Google / Microsoft Authenticator).',
  'Погрешен или истечен код. Обидете се повторно.': 'Kod i gabuar ose i skaduar. Provoni përsëri.',
};

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* no storage */ } },
};

export function LoginForm({ brand, mail }: { brand: string; mail: string }) {
  const [res, action, pending] = useActionState(login, '');
  // controlled: the password stays filled for the 2nd step (the code)
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [see, setSee] = useState(false);
  const [caps, setCaps] = useState(false);
  const [keep, setKeep] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [lang, setLang] = useState<Lang>('mk');
  const [today, setToday] = useState('');
  const t = T[lang];
  const mfa = res.startsWith(MFA_ASK);
  const raw = mfa ? res.slice(MFA_ASK.length) : res;
  const msg = lang === 'sq' ? SQ_MSG[raw] ?? raw : raw;

  useEffect(() => {
    const u = store.get(REMEMBER);
    if (u) { setUser(u); setKeep(true); }
    const l = store.get('wise-login-lang');
    if (l === 'sq') setLang('sq');
  }, []);
  useEffect(() => {
    // own names: not every browser has Macedonian / Albanian dates
    const [y, m, d, w] = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Europe/Skopje' })
      .formatToParts(new Date()).reduce<[number, number, number, number]>((a, p) => {
        if (p.type === 'year') a[0] = +p.value; else if (p.type === 'month') a[1] = +p.value; else if (p.type === 'day') a[2] = +p.value;
        else if (p.type === 'weekday') a[3] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.value);
        return a;
      }, [0, 0, 0, 0]);
    const N = lang === 'sq'
      ? { d: ['e diel', 'e hënë', 'e martë', 'e mërkurë', 'e enjte', 'e premte', 'e shtunë'], m: ['janar', 'shkurt', 'mars', 'prill', 'maj', 'qershor', 'korrik', 'gusht', 'shtator', 'tetor', 'nëntor', 'dhjetor'] }
      : { d: ['недела', 'понеделник', 'вторник', 'среда', 'четврток', 'петок', 'сабота'], m: ['јануари', 'февруари', 'март', 'април', 'мај', 'јуни', 'јули', 'август', 'септември', 'октомври', 'ноември', 'декември'] };
    const txt = `${N.d[w] ?? ''}, ${d} ${N.m[m - 1] ?? ''} ${y}`;
    setToday(txt.charAt(0).toUpperCase() + txt.slice(1));
  }, [lang]);
  // „Запамети“: only the user name, in this browser (never the password)
  // „Запамети“: only the user name, in this browser (never the password); saved when it changes
  const remember = (k: boolean, u: string) => store.set(REMEMBER, k && u.trim() ? u.trim() : null);
  // also the cookie `wise-lang`: the НПО screens (🍲 оброци, членови) open in the same language
  const pickLang = (l: Lang) => { setLang(l); store.set('wise-login-lang', l); try { document.cookie = `wise-lang=${l}; path=/; max-age=31536000; samesite=lax`; } catch { /* no cookies */ } };
  const capsKey = (e: React.KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.('CapsLock') ?? false);

  return (
    <>
      <div className="lg-date" suppressHydrationWarning>{today}</div>
      <form className="lg-card" action={action} autoComplete="on" aria-label={`${t.title} – ${brand}`}>
        <div className="lg-head">
          <h1>{mfa ? '🔐 2FA' : t.title}</h1>
          <div className="lg-lang" role="group" aria-label="Јазик / Gjuha">
            <button type="button" className={lang === 'mk' ? 'on' : ''} aria-pressed={lang === 'mk'} onClick={() => pickLang('mk')}>МК</button>
            <button type="button" className={lang === 'sq' ? 'on' : ''} aria-pressed={lang === 'sq'} onClick={() => pickLang('sq')}>SQ</button>
          </div>
        </div>
        <div style={mfa ? { display: 'none' } : undefined}>
          <label className="lg-f">{t.user}
            <input name="username" required autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus={!user}
              value={user} onChange={(e) => { setUser(e.target.value); if (keep) remember(true, e.target.value); }} />
          </label>
          <label className="lg-f">{t.pass}
            <span className="lg-pass">
              <input name="password" type={see ? 'text' : 'password'} required autoComplete="current-password" autoFocus={!!user}
                value={pass} onChange={(e) => setPass(e.target.value)} onKeyUp={capsKey} onKeyDown={capsKey} />
              <button type="button" className="lg-eye" onClick={() => setSee((v) => !v)} aria-label={see ? t.hide : t.show} title={see ? t.hide : t.show}>{see ? '🙈' : '👁'}</button>
            </span>
          </label>
          {caps && <div className="lg-caps" role="status">{t.caps}</div>}
          <div className="lg-row">
            <label className="lg-chk"><input type="checkbox" checked={keep} onChange={(e) => { setKeep(e.target.checked); remember(e.target.checked, user); }} /> {t.remember}</label>
            <button type="button" className="lg-link" onClick={() => setForgot((v) => !v)} aria-expanded={forgot}>{t.forgot}</button>
          </div>
          {forgot && <div className="lg-forgot">{t.forgotText(mail)}</div>}
        </div>
        {mfa && (
          <label className="lg-f">{t.code}
            <input name="code" required autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={9} placeholder="123456" className="lg-code" />
            <span className="lg-mini">{t.lost}</span>
          </label>
        )}
        <div className={`lg-msg${mfa && !/Погрешен/.test(raw) ? ' info' : ''}`} role="alert">{msg}</div>
        <button className="lg-btn" type="submit" disabled={pending}>{pending ? '…' : mfa ? t.ok : t.go}</button>
        {mfa && <button type="button" className="lg-btn ghost" onClick={() => window.location.reload()}>{t.back}</button>}
        {!mfa && <p className="lg-mini lg-rules">{t.rules}</p>}
      </form>
      <div className="lg-safe">{t.safe}</div>
    </>
  );
}
