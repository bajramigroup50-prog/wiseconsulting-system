/**
 * „✉ Е-пошта на програмата“ (Систем, administrator): the sending account, the last failures with their reason, the app
 * password field (never shown back) and „↻ Испрати повторно неуспешните“.
 */
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { appSettings, mailLog } from '@wise/db';
import { ActionForm } from '@/components/action-form';
import { RowAction } from '@/components/row-action';
import { db } from '@/lib/db';
import { resendFailedMailAction, saveSmtpAction } from './smtp-actions';

export async function SmtpCard({ admin }: { admin: boolean }) {
  if (!admin) return null;
  const [[s], failed] = await Promise.all([
    db().select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, 'smtp')).limit(1),
    db().select({ error: mailLog.error, at: mailLog.createdAt }).from(mailLog).where(and(eq(mailLog.status, 'failed'), gt(mailLog.createdAt, sql`now() - interval '7 days'`))).orderBy(desc(mailLog.createdAt)).limit(50),
  ]);
  const v = (s?.v ?? {}) as { user?: string; at?: string; by?: string };
  const user = v.user || process.env.SMTP_USER || '';
  const needsAppPass = failed.some((f) => /Application-specific password|InvalidSecondFactor|Invalid login|534|535/i.test(f.error ?? ''));
  return (
    <div className="card" id="smtp" style={needsAppPass ? { borderLeft: '4px solid var(--bad)' } : undefined}>
      <h2 style={{ margin: '0 0 6px' }}>✉ Е-пошта на програмата</h2>
      <p className="mini" style={{ margin: '0 0 6px' }}>Програмата праќа од <b>{user || '—'}</b>{v.at ? ` · лозинката е поставена на ${v.at.slice(0, 10).split('-').reverse().join('.')}${v.by ? ' (' + v.by + ')' : ''}` : ''}.
        {failed.length ? <> Неуспешни во последните 7 дена: <b style={{ color: 'var(--bad)' }}>{failed.length}</b>.</> : ' Нема неуспешни е-пораки.'}</p>
      {needsAppPass && (
        <div className="callout bad" style={{ margin: '0 0 8px' }}>Gmail ја одбива најавата: по вклучување на <b>верификација во 2 чекори</b> бара <b>лозинка за апликација</b>.
          Отворете <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">myaccount.google.com/apppasswords</a> (најавени како {user}), име „WISE“ → Create, копирајте ги 16-те букви и внесете ги подолу.</div>
      )}
      <ActionForm action={saveSmtpAction} className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <label className="f">Gmail сметка<input name="user" type="email" defaultValue={user} style={{ width: 240 }} autoComplete="off" /></label>
        <label className="f">Лозинка за апликација (16 букви)<input name="pass" type="password" placeholder="xxxx xxxx xxxx xxxx" style={{ width: 200 }} autoComplete="new-password" /></label>
        <button className="btn pri">Зачувај</button>
      </ActionForm>
      {failed.length > 0 && <div style={{ marginTop: 8 }}><RowAction inline className="btn" action={resendFailedMailAction} label={`↻ Испрати повторно неуспешните (${failed.length})`} /></div>}
    </div>
  );
}
