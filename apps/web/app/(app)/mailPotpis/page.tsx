/**
 * Legacy `VIEWS.mailPotpis` 12179 + `msEditorHTML` 12136 — Систем › ✏ Потпис и напомена за е-пошта: greeting, name,
 * title, office, phone, e-mail and the confidentiality notice, with a preview. Saved per user (legacy: per user in
 * localStorage) and appended by `queueMailRow` to every e-mail the user sends (invoices, dossier, payslips, portal…).
 */
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { can } from '@wise/core';
import { mailSigCfg, mailSigHtml, mailSigKey, type MailSig } from '@wise/core/mailsig';
import { appSettings } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { viewAllowed } from '@/lib/nav';
import { ActionForm } from '@/components/action-form';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { resetMailSigAction, saveMailSigAction } from './actions';

export default async function MailPotpisPage() {
  const u = await requireUser();
  if (!viewAllowed(u.role, 'mailPotpis')) notFound();
  const [s] = await db().select().from(appSettings).where(eq(appSettings.key, mailSigKey(u.id))).limit(1);
  const c = mailSigCfg(s?.value as Partial<MailSig> | undefined, u.name);
  const ed = can(u.principal, 'write');
  const F: [keyof MailSig, string, string?][] = [['greet', 'Поздрав'], ['name', 'Име и презиме'], ['title', 'Звање', 'Овластен сметководител'], ['office', 'Канцеларија / фирма'], ['phone', 'Телефон'], ['email', 'Е-пошта']];
  return (
    <>
      <Hd t="✏ Потпис и напомена за е-пошта" sub="за сите пораки што ги праќате, од сите фирми" />
      {!s && <div className="callout">Сè уште немате зачуван потпис – пораките се праќаат без потпис. Зачувајте го подолу.</div>}
      {ed && (
        <ActionForm action={saveMailSigAction} reset={false} style={{ gap: 8, background: 'var(--soft)' }}>
          <b>✏ Потпис и напомена (за сите пораки што ги праќате)</b>
          <div className="form">
            {F.map(([k, l, ph]) => <label className="f" key={k}>{l}<input name={k} defaultValue={String(c[k])} placeholder={ph} /></label>)}
          </div>
          <label className="chk"><input type="checkbox" name="disc" defaultChecked={c.disc} /> додај напомена за доверливост на крајот (со црвено)</label>
          <textarea name="discText" rows={5} defaultValue={c.discText} />
          <div className="row" style={{ gap: 8 }}>
            {s && <RowAction action={resetMailSigAction} label="Отстрани го потписот" className="btn sm ghost" confirm="Да се отстрани зачуваниот потпис?" />}
            <span style={{ flex: 1 }} /><button className="btn sm pri">Зачувај потпис</button>
          </div>
        </ActionForm>
      )}
      <div className="card" style={{ background: '#fff' }}>
        <b style={{ fontSize: 14 }}>👁 Како изгледа пораката</b>
        <div style={{ marginTop: 8 }} dangerouslySetInnerHTML={{ __html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px">Почитувани,<br><br>Во прилог Ви го доставуваме бараниот документ.</div>${mailSigHtml(c, new Date().toLocaleString('mk-MK', { timeZone: 'Europe/Skopje', dateStyle: 'short', timeStyle: 'short' }))}` }} />
      </div>
    </>
  );
}
