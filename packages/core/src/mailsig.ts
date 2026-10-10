/**
 * E-mail signature and confidentiality notice — legacy `MS_DISC`, `msCfg`, `msSigText`, `msHtml` 12124–12133
 * (`VIEWS.mailPotpis` 12179). Legacy kept the settings in localStorage per user; on the server they are stored per
 * user in `app_settings` (`mailsig:<userId>`) and applied to every e-mail the user queues.
 */

export const MS_DISC = 'НАПОМЕНА: Оваа порака и сите прилози во неа се доверливи и наменети исклучиво за лицето, односно правниот субјект на кој му се адресирани. Доколку пораката сте ја добиле по грешка, Ве молиме веднаш да го известите испраќачот и да ја избришете заедно со прилозите. Секое неовластено читање, копирање, препраќање, објавување или користење на содржината е строго забрането. Испраќачот не презема одговорност за нецелосно или неточно пренесување на информациите, ниту за доцнење или штета настаната при нивниот пренос или прием. Пораките разменети по електронски пат може да се користат како доказ во случај на спор.';

export interface MailSig { greet: string; name: string; title: string; office: string; phone: string; email: string; disc: boolean; discText: string }

export const mailSigKey = (userId: string) => `mailsig:${userId}`;

/** Legacy `msCfg`: defaults (the user's name, standard notice) overridden by the saved settings. */
export function mailSigCfg(saved: Partial<MailSig> | null | undefined, userName = ''): MailSig {
  return { greet: 'Со почит,', name: userName, title: '', office: '', phone: '', email: '', disc: true, discText: MS_DISC, ...(saved ?? {}) };
}

/** Legacy `msSigText`: greeting, blank line, then the non-empty lines. */
export function mailSigText(c: MailSig): string {
  return [c.greet, '', c.name, c.title, c.office, [c.phone ? 'тел. ' + c.phone : '', c.email].filter(Boolean).join(' · ')].filter((x, i) => i < 2 || x).join('\n');
}

const h = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const MAIL_SIG_MARK = '<!--wise-mailsig-->';

/** HTML signature block + notice (legacy `msHtml` styling), marked so it is never added twice. */
export function mailSigHtml(c: MailSig, stamp?: string): string {
  const L = [c.name ? `<b style="font-size:14px">${h(c.name)}</b>` : '', c.title ? `<span style="color:#0d5b4b;font-weight:600">${h(c.title)}</span>` : '', c.office ? h(c.office) : '',
    [c.phone ? 'тел. ' + h(c.phone) : '', c.email ? `<a href="mailto:${h(c.email)}">${h(c.email)}</a>` : ''].filter(Boolean).join(' · ')].filter(Boolean);
  const disc = c.disc && c.discText
    ? `<div style="margin-top:18px;border-top:1px solid #e3c4c1;padding-top:8px">${stamp || c.name ? `<div style="font-size:10px;color:#8a8a8a">${h([stamp, c.name].filter(Boolean).join(' · '))}</div>` : ''}<p style="margin:4px 0 0;font-size:11px;line-height:1.4;color:#b3261e">${h(c.discText)}</p></div>`
    : '';
  return `${MAIL_SIG_MARK}<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1b1b1b;line-height:1.5"><br>${h(c.greet)}<br><div style="margin-top:8px;padding-left:10px;border-left:3px solid #0d5b4b">${L.join('<br>')}</div>${disc}</div>`;
}

/** Append the signature to an HTML body (legacy `msSign` + `msHtml` on send); idempotent. */
export function signMailHtml(html: string, c: MailSig, stamp?: string): string {
  if (html.includes(MAIL_SIG_MARK)) return html;
  return html + mailSigHtml(c, stamp);
}

/** Normalise form input. */
export function mailSigInput(raw: Readonly<Record<string, unknown>>): MailSig {
  const s = (k: string) => String(raw[k] ?? '').trim().slice(0, 4000);
  return { greet: s('greet'), name: s('name'), title: s('title'), office: s('office'), phone: s('phone'), email: s('email'), disc: raw.disc === true || raw.disc === 'on', discText: s('discText') || MS_DISC };
}
