/**
 * Legacy `VIEWS.mailPotpis` (12179) + `msEditorHTML` / `msHtml` — Потпис и напомена за е-пошта: one signature and
 * confidentiality notice for every message, firm and user. The worker appends it to every e-mail when it is sent.
 * Gap: the signature / stamp images of legacy (`ms_img`, `ms_stamp`) are not added to the e-mail.
 */
import { eq } from 'drizzle-orm';
import { can } from '@wise/core';
import { APP_SETTING_MAIL_SIG, MS_DISC, mailSigCfg, mailSigHtml } from '@wise/core/firms/mailsig';
import { appSettings } from '@wise/db';
import { db } from '@/lib/db';
import { officePage } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { Hd } from '@/components/hd';
import { saveMailSig } from './actions';

export default async function MailPotpisPage() {
  const { u } = await officePage('mailPotpis');
  const [r] = await db().select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, APP_SETTING_MAIL_SIG)).limit(1);
  const c = mailSigCfg(r?.v, u.name);
  const now = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Skopje' }).slice(0, 16).replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3.$2.$1');
  const edit = can(u.principal, 'office');
  return (
    <>
      <Hd t="✏ Потпис и напомена за е-пошта" sub="заеднички за сите пораки, сите фирми и сите корисници" />
      {!r && <div className="callout">Потписот уште не е зачуван – пораките се праќаат без потпис додека не го зачувате.</div>}
      {edit && (
        <ActionForm action={saveMailSig} reset={false} style={{ gap: 8, background: 'var(--soft)' }}>
          <b>✏ Потпис и напомена – заеднички за сите пораки и сите корисници</b>
          <div className="form">
            <label className="f">Поздрав<input name="greet" defaultValue={c.greet} /></label>
            <label className="f">Име и презиме<input name="name" defaultValue={c.name} /></label>
            <label className="f">Звање<input name="title" defaultValue={c.title} placeholder="Овластен сметководител" /></label>
            <label className="f">Канцеларија / фирма<input name="office" defaultValue={c.office} /></label>
            <label className="f">Телефон<input name="phone" defaultValue={c.phone} /></label>
            <label className="f">Е-пошта<input name="email" type="email" defaultValue={c.email} /></label>
          </div>
          <label className="chk"><input type="checkbox" name="disc" defaultChecked={c.disc} /> додај напомена за доверливост на крајот (со црвено)</label>
          <textarea name="discText" rows={5} defaultValue={c.discText} />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm ghost" name="reset" value="1">Врати го стандардниот текст</button>
            <span style={{ flex: 1 }} />
            <button className="btn sm pri">Зачувај потпис</button>
          </div>
        </ActionForm>
      )}
      <div className="card" style={{ background: '#fff' }}>
        <b style={{ fontSize: 14 }}>👁 Како изгледа пораката</b>
        <div style={{ marginTop: 8 }} dangerouslySetInnerHTML={{
          __html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1b1b1b;line-height:1.5">Почитувани,<br><br>Во прилог Ви го доставуваме бараниот документ.</div>` + mailSigHtml(c, now),
        }} />
      </div>
      <p className="note">Потписот и напомената се додаваат автоматски на крајот од секоја е-порака што ја праќа програмата (фактури, опомени, пресметки на плата, документи од досието…). Стандардна напомена: {MS_DISC.slice(0, 80)}…</p>
    </>
  );
}
