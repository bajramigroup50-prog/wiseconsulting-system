/** Office e-mail signature (`mailPotpis`, app setting `mailSig`) applied to every message at send time. */
import { eq } from 'drizzle-orm';
import { APP_SETTING_MAIL_SIG, mailSigCfg, signMailHtml } from '@wise/core/firms/mailsig';
import { appSettings, type DB } from '@wise/db';

const nowMk = () => new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Skopje' }).slice(0, 16).replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3.$2.$1');

/** Signer for `MailDeps.signHtml`; only signs when the office saved a signature in „✏ Потпис и напомена“. */
export const signatureSigner = (db: DB) => async (html: string): Promise<string> => {
  const [r] = await db.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, APP_SETTING_MAIL_SIG)).limit(1);
  return r ? signMailHtml(html, mailSigCfg(r.v), nowMk()) : html;
};
