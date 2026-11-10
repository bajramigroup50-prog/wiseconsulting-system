/**
 * „✉ Е-пошта на фирмата за фактури“ (Фирми → Измени): the firm's own mailbox – its invoices (and the recurring ones)
 * go to the customers from it. The app password is never shown back; the last sending problem is shown.
 */
import { and, desc, eq, like } from 'drizzle-orm';
import { firmMailboxInfo, mailLog } from '@wise/db';
import { ActionForm } from '@/components/action-form';
import { RowAction } from '@/components/row-action';
import { db } from '@/lib/db';
import { clearFirmMailAction, saveFirmMailAction } from './mail-actions';

export async function FirmMailCard({ firmId, firmEmail }: { firmId: string; firmEmail: string | null }) {
  const [box, [bad]] = await Promise.all([
    firmMailboxInfo(db(), firmId),
    db().select({ error: mailLog.error, at: mailLog.createdAt }).from(mailLog)
      .where(and(eq(mailLog.firmId, firmId), like(mailLog.error, 'Е-поштата на фирмата%'))).orderBy(desc(mailLog.createdAt)).limit(1),
  ]);
  return (
    <div className="card" id="firmMail" style={{ marginTop: 10 }}>
      <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>✉ Е-пошта на фирмата за фактури</h2>
      <p className="mini" style={{ margin: '0 0 6px' }}>
        {box ? <>Фактурите се праќаат до клиентите од <b>{box.user}</b> ({box.host}:{box.port}){box.at ? ` · поставено на ${box.at.slice(0, 10).split('-').reverse().join('.')}${box.by ? ' (' + box.by + ')' : ''}` : ''}.</>
          : <>Сега фактурите одат од е-поштата на програмата, со името на фирмата, а одговорите стигнуваат на {firmEmail ? <b>{firmEmail}</b> : 'е-поштата на фирмата (внесете ја горе)'}. Внесете ја е-поштата на фирмата за да одат директно од неа.</>}
      </p>
      {bad && <div className="callout bad" style={{ margin: '0 0 8px' }}>{bad.error} <span className="mini">({bad.at.toISOString().slice(0, 10).split('-').reverse().join('.')})</span></div>}
      <ActionForm action={saveFirmMailAction} reset={false} className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <input type="hidden" name="firmId" value={firmId} />
        <label className="f" style={{ minWidth: 220 }}>Е-пошта<input name="user" type="email" defaultValue={box?.user ?? firmEmail ?? ''} placeholder="firma@gmail.com" required /></label>
        <label className="f" style={{ minWidth: 200 }}>Лозинка за апликација<input name="pass" type="password" autoComplete="new-password" placeholder={box ? '•••••• (зачувана)' : '16 букви од Google / Microsoft'} /></label>
        <label className="f" style={{ minWidth: 170 }}>SMTP сервер (само за друг домен)<input name="host" defaultValue={box?.host ?? ''} placeholder="автоматски за Gmail / Outlook" /></label>
        <label className="f" style={{ width: 90 }}>Порта<input name="port" type="number" defaultValue={box?.port ?? ''} placeholder="465" /></label>
        <button className="btn pri">Зачувај</button>
        {box && <RowAction className="btn" action={clearFirmMailAction.bind(null, firmId)} label="Отстрани" confirm="Фактурите повеќе да не се праќаат од е-поштата на фирмата?" />}
      </ActionForm>
      <p className="note" style={{ margin: '6px 0 0' }}>Gmail: најавени како фирмата отворете <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">myaccount.google.com/apppasswords</a> (потребна е верификација во 2 чекори), име „WISE“ → Create и внесете ги 16-те букви.
        Ако е-поштата ја одбие пораката, фактурата сепак се праќа од програмата и причината се гледа тука.</p>
    </div>
  );
}
