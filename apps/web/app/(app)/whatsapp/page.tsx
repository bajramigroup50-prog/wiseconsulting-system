/**
 * 💬 WhatsApp (owner only): the office number on the official WhatsApp Business Cloud API (Meta). Phone Number ID,
 * WABA ID, app secret and access token (sealed, shown only as „поставено / не е поставено“), the on switch, the
 * webhook address and verify token for Meta, the approved templates (for sends outside the 24-hour window), the
 * limits and „Испрати тест порака“. Off (the default) = every send button keeps the old wa.me / Viber links.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { WA_LANG_CODE, WA_PURPOSES, WA_VARS, waConfigured, type WaTemplate } from '@wise/core/whatsapp/wa';
import { waEnsureVerifyToken, waSettings, waUnreadCount } from '@wise/db';
import { ActionForm, Submit } from '@/components/action-form';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { ownerContext } from '@/lib/demo-office';
import { viewAllowed } from '@/lib/nav';
import { OWNER_ONLY_MSG } from '@/lib/office-owner';
import { waRotateAction, waSaveAction, waTemplatesAction, waTestAction } from './actions';

const T = '💬 WhatsApp';
const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('mk-MK', { timeZone: 'Europe/Skopje', dateStyle: 'short', timeStyle: 'short' }) : '');

/** The public address Meta calls: the website host (Caddy lets `/api/whatsapp` through), else the app itself. */
function hookUrl(): string {
  const site = (process.env.SITE_ADDRS ?? '').split(/[,\s]+/).map((x) => x.trim()).find((x) => x && !x.startsWith('http://localhost'));
  if (site) return `https://${site.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}/api/whatsapp`;
  const dom = process.env.APP_DOMAIN || process.env.DOMAIN || 'localhost:3000';
  return `${dom.startsWith('http') ? dom : 'https://' + dom}/api/whatsapp/webhook`.replace(/([^:])\/\//, '$1/');
}

export default async function WhatsappPage() {
  const u = await requireUser();
  if (u.role === 'klient' || u.role === 'teren') notFound();
  const oc = viewAllowed(u.role, 'whatsapp') ? await ownerContext(u) : null;
  if (!oc || oc.demo) return <><Hd t={T} exp={false} /><div className="card empty">{OWNER_ONLY_MSG}</div></>;
  let s = await waSettings(db());
  if (!s.verifyToken) { await db().transaction((tx) => waEnsureVerifyToken(tx, u.id)); s = await waSettings(db()); }
  const unread = await waUnreadCount(db());
  const ready = waConfigured({ phoneNumberId: s.phoneNumberId, token: s.hasToken ? 'x' : null, appSecret: s.hasSecret ? 'x' : null });
  const rows: (WaTemplate | null)[] = [...s.templates, null, null, null];
  const set = (b: boolean) => <span className={`pill ${b ? 'good' : 'bad'}`}>{b ? '✓ поставено' : 'не е поставено'}</span>;
  return (
    <>
      <Hd t={T} sub="Бројот на канцеларијата (+389 71 204 123) преку официјалниот WhatsApp Business Cloud API" exp={false}>
        <Link className="btn" href="/waInbox">📨 Разговори{unread ? ` (${unread} нови)` : ''}</Link>
      </Hd>
      <div className={`callout ${s.on && ready ? 'good' : ready ? 'warn' : 'bad'}`}>
        {s.on && ready ? <>✓ <b>Вклучено</b> – пораките, потсетниците, опомените и PDF-овите одат директно од WISE; дојдовните пораки и документи пристигнуваат во WISE.</>
          : ready ? <>Сè е внесено, но е <b>исклучено</b> – копчињата ги отвораат старите wa.me / Viber линкови.</>
            : <>Не е поврзано. Откако Meta ќе ја одобри фирмата: WhatsApp Manager → додајте го бројот (coexistence – апликацијата на телефонот продолжува да работи) → внесете ги вредностите подолу.</>}
        {s.lastTest && <div className="mini" style={{ marginTop: 4 }}>Последна проверка {dt(s.lastTest.at)}: {s.lastTest.ok ? '✓' : '✕'} {s.lastTest.msg}</div>}
        <div className="mini" style={{ marginTop: 4 }}>🔒 App secret и токенот се чуваат шифрирани и никогаш не се прикажуваат. Внесете ги само тука, во WISE – никому не ги праќајте по пошта или чет.</div>
      </div>

      <ActionForm action={waSaveAction} className="card" reset={false}>
        <h3 style={{ marginTop: 0 }}>1. Поврзување (Meta for Developers → вашата апликација → WhatsApp → API Setup)</h3>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="f" style={{ margin: 0 }}>Phone Number ID<input name="phoneNumberId" inputMode="numeric" defaultValue={s.phoneNumberId} style={{ width: 200 }} /></label>
          <label className="f" style={{ margin: 0 }}>WhatsApp Business Account ID<input name="wabaId" inputMode="numeric" defaultValue={s.wabaId} style={{ width: 200 }} /></label>
          <label className="f" style={{ margin: 0 }}>App secret (App settings → Basic) {set(s.hasSecret)}<input name="appSecret" type="password" autoComplete="off" placeholder={s.hasSecret ? '•••••• (зачувано – празно = без промена)' : ''} style={{ width: 280 }} /></label>
          <label className="f" style={{ margin: 0, flex: '1 1 320px' }}>Трајен токен (System user → Generate token: whatsapp_business_messaging, whatsapp_business_management) {set(s.hasToken)}
            <input name="token" type="password" autoComplete="off" placeholder={s.hasToken ? '•••••• (зачувано – празно = без промена)' : ''} /></label>
        </div>
        <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'end', marginTop: 10 }}>
          <label className="f" style={{ margin: 0 }}>Најмногу пораки во минута<input name="perMinute" type="number" min={1} max={80} defaultValue={s.perMinute} style={{ width: 90 }} /></label>
          <label className="f" style={{ margin: 0 }}>Најмногу за 24 часа<input name="perDay" type="number" min={1} max={5000} defaultValue={s.perDay} style={{ width: 100 }} /></label>
          {s.hasToken && <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" name="clearToken" /> избриши го токенот</label>}
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 15 }}><input type="checkbox" name="on" defaultChecked={s.on} /> <b>Вклучи WhatsApp од WISE</b></label>
          <Submit>Зачувај</Submit>
        </div>
      </ActionForm>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>2. Webhook (Meta → WhatsApp → Configuration → Webhook → Edit)</h3>
        <table className="dense"><tbody>
          <tr><td>Callback URL</td><td><code>{hookUrl()}</code></td></tr>
          <tr><td>Verify token</td><td><code>{s.verifyToken}</code> <RowAction action={waRotateAction} label="↻ нов" confirm="Нов verify token? Потоа внесете го и во Meta." /></td></tr>
          <tr><td>Webhook fields</td><td>вклучете <b>messages</b> (Subscribe)</td></tr>
        </tbody></table>
        <p className="mini" style={{ marginBottom: 0 }}>Секоја порака од Meta е потпишана со App secret (X-Hub-Signature-256) – WISE ги одбива сите непотпишани. Текстот оди во разговорот на фирмата; сликите и PDF-овите – во „📥 Пристигнати документи“ (AI читање). Непознат број → „Неразпоредени“ во 📨 Разговори.</p>
      </div>

      <ActionForm action={waTemplatesAction} className="card" reset={false}>
        <h3 style={{ marginTop: 0 }}>3. Одобрени шаблони (за пораки надвор од 24-часовниот прозорец)</h3>
        <p className="mini" style={{ marginTop: 0 }}>Ако клиентот не пишал во последните 24 часа, WhatsApp дозволува само шаблон одобрен во WhatsApp Manager → Message templates.
          Тука внесете го истото <b>име</b> и <b>јазик</b>, за што служи, и редоследот на променливите {'{{1}}, {{2}}…'}. Шаблон со „PDF“ има заглавие Document – фактурата / платниот лист оди со него.</p>
        <div className="tw"><table className="dense">
          <thead><tr><th>Име (како во Meta)</th><th>Јазик</th><th>За</th><th>Променливи по ред</th><th>PDF</th></tr></thead>
          <tbody>{rows.map((t, i) => (
            <tr key={i}>
              <td><input name="t_name" defaultValue={t?.name ?? ''} placeholder="на пр. potsetnik_rok" style={{ width: 200 }} /></td>
              <td><select name="t_lang" defaultValue={t?.lang ?? 'mk'}>{Object.keys(WA_LANG_CODE).map((l) => <option key={l} value={l}>{l === 'mk' ? 'македонски' : 'албански'}</option>)}</select></td>
              <td><select name="t_purpose" defaultValue={t?.purpose ?? 'rok'}>{Object.entries(WA_PURPOSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
              <td><input name="t_vars" defaultValue={t?.vars.join(', ') ?? ''} placeholder="firma, opis, rok" style={{ width: 240 }} /></td>
              <td><input type="checkbox" name="t_doc" value={i} defaultChecked={!!t?.doc} /></td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="mini">Променливи: {Object.entries(WA_VARS).map(([k, v]) => <span key={k}><code>{k}</code> = {v}; </span>)} Празно име = редот се брише.</p>
        <Submit>Зачувај шаблони</Submit>
      </ActionForm>

      <ActionForm action={waTestAction} className="card" reset={false}>
        <h3 style={{ marginTop: 0 }}>4. Проверка</h3>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="f" style={{ margin: 0 }}>Ваш телефон (празно = само проверка на врската)<input name="phone" inputMode="tel" placeholder="070 123 456" style={{ width: 200 }} /></label>
          <Submit>📤 Испрати тест порака</Submit>
        </div>
        <p className="mini" style={{ marginBottom: 0 }}>Тест пораката е слободен текст: прво пратете „здраво“ од тој телефон до бројот на канцеларијата (го отвора 24-часовниот прозорец), или додајте шаблон „💬 Општа порака“.</p>
      </ActionForm>
    </>
  );
}
