/**
 * E-mail signature and confidentiality notice (legacy `MS_DISC` / `msCfg` / `msSigText` / `msHtml` 12124–12131, and the
 * office-wide override 12164: one signature for every message, firm and user). Applied to every outgoing e-mail when
 * it is sent (worker `mail.send`).
 */
export const MS_DISC = 'НАПОМЕНА: Оваа порака и сите прилози во неа се доверливи и наменети исклучиво за лицето, односно правниот субјект на кој му се адресирани. Доколку пораката сте ја добиле по грешка, Ве молиме веднаш да го известите испраќачот и да ја избришете заедно со прилозите. Секое неовластено читање, копирање, препраќање, објавување или користење на содржината е строго забрането. Испраќачот не презема одговорност за нецелосно или неточно пренесување на информациите, ниту за доцнење или штета настаната при нивниот пренос или прием. Пораките разменети по електронски пат може да се користат како доказ во случај на спор.';

export interface MailSig {
  greet: string;
  name: string;
  title: string;
  office: string;
  phone: string;
  email: string;
  /** Add the confidentiality notice (red) at the end. */
  disc: boolean;
  discText: string;
}

export const APP_SETTING_MAIL_SIG = 'mailSig';

/** Legacy `msCfg` defaults merged with the stored value. */
export function mailSigCfg(stored: unknown, userName = ''): MailSig {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<MailSig>;
  const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
  return {
    greet: str(s.greet, 'Со почит,') || 'Со почит,', name: str(s.name, userName), title: str(s.title, ''), office: str(s.office, ''),
    phone: str(s.phone, ''), email: str(s.email, ''), disc: s.disc !== false, discText: str(s.discText, MS_DISC) || MS_DISC,
  };
}

/** Legacy `msSigText`: plain-text signature. */
export function mailSigText(c: MailSig): string {
  return [c.greet, '', c.name, c.title, c.office, [c.phone ? 'тел. ' + c.phone : '', c.email].filter(Boolean).join(' · ')]
    .filter((x, i) => i < 2 || x).join('\n');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Signature block (+ notice) in legacy `msHtml` styling. `now` = "dd.mm.yyyy hh:mm" printed above the notice. */
export function mailSigHtml(c: MailSig, now: string): string {
  const L = [
    c.name ? `<b style="font-size:14px">${esc(c.name)}</b>` : '',
    c.title ? `<span style="color:#0d5b4b;font-weight:600">${esc(c.title)}</span>` : '',
    c.office ? esc(c.office) : '',
    [c.phone ? 'тел. ' + esc(c.phone) : '', c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''].filter(Boolean).join(' · '),
  ].filter(Boolean);
  const sig = L.length ? `<br><br>${esc(c.greet)}<br><div style="margin-top:8px;padding-left:10px;border-left:3px solid #0d5b4b">${L.join('<br>')}</div>` : '';
  const disc = c.disc && c.discText
    ? `<div style="margin-top:18px;border-top:1px solid #e3c4c1;padding-top:8px"><div style="font-size:10px;color:#8a8a8a">${esc(now)}${c.name ? ' · ' + esc(c.name) : ''}</div><p style="margin:4px 0 0;font-size:11px;line-height:1.4;color:#b3261e">${esc(c.discText)}</p></div>`
    : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1b1b1b;line-height:1.5">${sig}${disc}</div>`;
}

/** Marker so a body is never signed twice (retries, forwarded bodies). */
export const MAIL_SIG_MARK = '<!--wise-sig-->';

/** Append the signature to an HTML body (legacy `msSign` + `msHtml`), unless already signed. */
export function signMailHtml(html: string, c: MailSig | null, now: string): string {
  if (!c || html.includes(MAIL_SIG_MARK)) return html;
  const block = mailSigHtml(c, now);
  return html + MAIL_SIG_MARK + block;
}
