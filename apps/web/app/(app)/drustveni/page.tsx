/**
 * 📣 Објави на мрежи (owner only): the robot's public law news posted automatically to the office's Facebook page and
 * Instagram — connect, switch on, preview the next card, „Објави сега“, history. Only `law_changes` (public news).
 */
import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { LAW_INST } from '@wise/core/law';
import { todaySkopje } from '@wise/core/office/dates';
import { SOCIAL_SCOPES, cardHtml, caption, socialPage } from '@wise/core/social/post';
import { getSocialSettings, lawChanges, nextSocialNews, socialPostList } from '@wise/db';
import { ActionForm, Submit } from '@/components/action-form';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { ownerContext } from '@/lib/demo-office';
import { viewAllowed } from '@/lib/nav';
import { OWNER_ONLY_MSG } from '@/lib/office-owner';
import { socialConnect, socialDelete, socialDisconnect, socialPostNow, socialPrefs } from './actions';

const T = '📣 Објави на мрежи';
const ST: Record<string, [string, string]> = { posted: ['објавено', 'good'], partial: ['делумно', 'warn'], failed: ['неуспешно', 'bad'], deleted: ['избришано', ''] };
const dt = (d: Date | null) => (d ? d.toLocaleString('mk-MK', { timeZone: 'Europe/Skopje', dateStyle: 'short', timeStyle: 'short' }) : '');

export default async function DrustveniPage() {
  const u = await requireUser();
  if (u.role === 'klient' || u.role === 'teren') notFound();
  const oc = viewAllowed(u.role, 'drustveni') ? await ownerContext(u) : null;
  if (!oc || oc.demo) return <><Hd t={T} exp={false} /><div className="card empty">{OWNER_ONLY_MSG}</div></>;
  const today = todaySkopje();
  const [s, P, recent] = await Promise.all([
    getSocialSettings(db()),
    socialPostList(db(), 30),
    db().select({ id: lawChanges.id, verified: lawChanges.verified, inst: lawChanges.inst, title: lawChanges.title, what: lawChanges.what, who: lawChanges.who, impact: lawChanges.impact, date: lawChanges.date, from: lawChanges.from, urls: lawChanges.urls })
      .from(lawChanges).orderBy(desc(lawChanges.createdAt)).limit(10),
  ]);
  const page = socialPage(s);
  const next = s.auto ? await nextSocialNews(db(), s.since) : recent[0] ?? null;
  const posted = new Set(P.filter((x) => x.status !== 'failed').map((x) => x.lawId));
  return (
    <>
      <Hd t={T} sub="Новостите на роботот (само јавни законски промени) – автоматски на Facebook и Instagram" exp={false} />
      <div className={`callout ${page ? (s.auto ? 'good' : 'warn') : 'bad'}`}>
        {page ? <>Поврзано: <b>{page.name}</b>{page.igName ? <> + Instagram <b>@{page.igName}</b></> : ' (без Instagram)'} · автоматско објавување: <b>{s.auto ? `вклучено, ${s.perDay} дневно` : 'исклучено'}</b></>
          : <>Не е поврзано. Пополнете ги трите полиња подолу.</>}
        <div className="mini" style={{ marginTop: 4 }}>🔒 Се објавуваат само јавните новости на роботот (УЈП, Службен весник…). Ништо од фирмите, книгите или лицата.</div>
      </div>

      <ActionForm action={socialConnect} className="card" reset={false}>
        <h3 style={{ marginTop: 0 }}>1. Поврзи со Facebook / Instagram</h3>
        <ol className="mini" style={{ margin: '0 0 10px', paddingLeft: 18 }}>
          <li>developers.facebook.com → <b>WISE Robot</b> → App settings → Basic: <b>App ID</b> и <b>App secret</b>.</li>
          <li>Tools → <b>Graph API Explorer</b>: Meta App = WISE Robot · User or Page = <b>Get User Access Token</b> · дозволи: {SOCIAL_SCOPES.join(', ')} → <b>Generate Access Token</b> → одберете ја страницата <b>Wise Cónsulting</b> → копирајте го токенот.</li>
        </ol>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="f" style={{ margin: 0 }}>App ID<input name="appId" inputMode="numeric" defaultValue={s.appId} style={{ width: 200 }} /></label>
          <label className="f" style={{ margin: 0 }}>App secret<input name="appSecret" type="password" autoComplete="off" placeholder={s.appSecret ? '•••••• (зачувано)' : ''} style={{ width: 240 }} /></label>
          <label className="f" style={{ margin: 0, flex: '1 1 320px' }}>Токен од Graph API Explorer<input name="userToken" type="password" autoComplete="off" /></label>
          <Submit>🔗 Поврзи</Submit>
        </div>
        {page && <div style={{ marginTop: 8 }}><RowAction action={socialDisconnect} label="Исклучи" confirm="WISE повеќе нема да може да објавува. Продолжи?" /></div>}
      </ActionForm>

      {s.pages.length > 0 && (
        <ActionForm action={socialPrefs} className="card" reset={false}>
          <h3 style={{ marginTop: 0 }}>2. Автоматско објавување</h3>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'end' }}>
            <label className="f" style={{ margin: 0 }}>Страница<select name="pageId" defaultValue={page?.id}>{s.pages.map((p) => <option key={p.id} value={p.id}>{p.name}{p.igName ? ` + @${p.igName}` : ''}</option>)}</select></label>
            <label className="f" style={{ margin: 0 }}>Колку дневно<select name="perDay" defaultValue={String(s.perDay)}><option value="1">1 (09:00)</option><option value="2">2 (09:00 и 15:00)</option></select></label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" name="auto" defaultChecked={s.auto} /> <b>Објавувај автоматски</b></label>
            <label className="f" style={{ margin: 0 }}>Лого на картичката (PNG/JPG/SVG, до 300 KB)<input type="file" name="logo" accept="image/png,image/jpeg,image/svg+xml,image/webp" /></label>
            {s.logo && <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" name="logoReset" /> врати го WISE знакот</label>}
            <Submit>Зачувај</Submit>
          </div>
          <p className="mini" style={{ marginBottom: 0 }}>При вклучување се објавуваат само новостите што роботот ќе ги најде од тој момент – старите не.</p>
        </ActionForm>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Преглед{next ? ` – ${s.auto ? 'следна објава' : 'последна новост'}` : ''}</h3>
        {next ? (
          <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <iframe title="Картичка" srcDoc={cardHtml(next, { logo: s.logo, today })} sandbox="" style={{ width: 1080, height: 1350, border: 0, transform: 'scale(.33)', transformOrigin: '0 0', marginRight: -723, marginBottom: -904 }} />
            <pre style={{ whiteSpace: 'pre-wrap', flex: '1 1 320px', margin: 0, fontFamily: 'inherit', fontSize: 14 }}>{caption(next)}</pre>
          </div>
        ) : <div className="empty">Нема нова новост за објавување.</div>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Последни новости на роботот</h3>
        <div className="tw"><table className="dense">
          <thead><tr><th>Датум</th><th>Институција</th><th>Наслов</th><th /></tr></thead>
          <tbody>{recent.map((n) => (
            <tr key={n.id}><td>{n.date ?? ''}</td><td>{LAW_INST[n.inst] ?? n.inst}</td>
              <td>{n.title}{n.urls[0] && <> · <a href={n.urls[0]} target="_blank" rel="noreferrer">извор</a></>}{!n.verified && <> <span className="pill warn" title="Проверете го изворот пред објавување">⚠ да се потврди</span></>}</td>
              <td>{posted.has(n.id) ? <span className="pill good">објавено</span> : page && n.urls[0] ? <RowAction action={socialPostNow.bind(null, n.id)} label={n.verified ? '📣 Објави сега' : '✔ Потврди и објави'}
                confirm={`${n.verified ? '' : 'Ја проверивте веста на официјалниот извор? Ќе се означи како потврдена. '}Да се објави „${n.title.slice(0, 80)}“ на ${page.name}${page.igName ? ' и Instagram' : ''}?`} showOk /> : null}</td></tr>
          ))}</tbody>
        </table></div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Објави</h3>
        {P.length ? <div className="tw"><table className="dense">
          <thead><tr><th>Време</th><th>Новост</th><th>Статус</th><th>Линкови</th><th /></tr></thead>
          <tbody>{P.map((x) => (
            <tr key={x.id}><td>{dt(x.postedAt ?? x.createdAt)}</td><td>{LAW_INST[x.inst] ?? x.inst}: {x.title}</td>
              <td><span className={`pill ${ST[x.status]?.[1] ?? ''}`}>{ST[x.status]?.[0] ?? x.status}</span>{x.error && <div className="mini">{x.error}</div>}</td>
              <td>{x.fbPostId && <a href={`https://www.facebook.com/${x.fbPostId}`} target="_blank" rel="noreferrer">Facebook</a>} {x.igLink && <a href={x.igLink} target="_blank" rel="noreferrer">Instagram</a>}</td>
              <td>{x.status !== 'deleted' && x.fbPostId && <RowAction action={socialDelete.bind(null, x.id)} label="🗑" title="Избриши од Facebook" confirm="Да се избрише објавата од Facebook? (Instagram се брише рачно во апликацијата.)" showOk />}</td></tr>
          ))}</tbody>
        </table></div> : <div className="empty">Сè уште нема објави.</div>}
      </div>
    </>
  );
}
