/**
 * „📅 Календар на рокови“ (new) — the statutory and agreed deadlines of ALL firms, generated from each firm's settings
 * (`@wise/core/office/rokovi`): ДДВ-04 (monthly / quarterly), МПИН, аконтации, year-end forms, ПДД-ГИ, ДЗС, М1/М2,
 * expiring documents / licences, contract renewals and the dossier's own deadlines.
 *
 * Month and list view, filters (colleague = users assigned to the firm, firm, type, status), „✓ Направено“, „Отвори“
 * (switches to the firm and opens the screen that does the work), ICS export, reminder settings. Deadlines whose date
 * is not confirmed from an official source are marked „за проверка“. The worker keeps them fresh every morning and
 * marks them done automatically (VAT period closed, МПИН accepted, annual account submitted, М1 entered; the advance and
 * the МПИН payment also when the bank statement shows the Treasury payment — the note „✓ платено (извод бр. …)“).
 */
import Link from 'next/link';
import { and, gte, inArray, lte, sql } from 'drizzle-orm';
import { addDays } from '@wise/core/office';
import {
  ROK_SRC, ROK_STATE_LBL, ROK_TYPE_IDS, ROK_TYPES, rokClientDay, rokDays, rokMonthGrid, rokMonthName, rokState, rokYmAdd, type RokSettings, type RokType,
} from '@wise/core/office/rokovi';
import { rokovi, rokoviLastRun, syncRokovi } from '@wise/db';
import { isDemoUser } from '@/lib/demo';
import { officeProfileFor } from '@/lib/demo-office';
import { db } from '@/lib/db';
import { officePage, today } from '@/lib/office';
import { rokColleagues, rokRows, type RokView } from '@/lib/rokovi';
import { ActionForm } from '@/components/action-form';
import { FirmGo } from '@/components/firm-go';
import { Hd, dmy } from '@/components/hd';
import { AutoStatus } from '@/components/auto-status';
import { hubTabs } from '@/components/hub-tabs';
import { RowAction } from '@/components/row-action';
import { markRokAction, saveRokSettings, syncRokAction } from './actions';

type SP = { m?: string; v?: string; fid?: string; uid?: string; t?: string; st?: string };
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const WD = ['Пон', 'Вто', 'Сре', 'Чет', 'Пет', 'Саб', 'Нед'];
const wd = (d: string) => WD[(new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7];

export default async function RokoviPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { u, firm } = await officePage('rokovi', { perm: 'office', demoGlobal: true });
  const demo = isDemoUser(u);
  const sp = await searchParams;
  const td = today();
  const list = sp.v === 'lista';
  const ym = sp.m && YM.test(sp.m) ? sp.m : td.slice(0, 7);
  // the list without a month: from 30 days back to 60 days ahead
  const [from, to] = list && !sp.m ? [addDays(td, -30), addDays(td, 60)] : [`${ym}-01`, addDays(`${rokYmAdd(ym, 1)}-01`, -1)];
  const st = sp.st === 'open' || sp.st === 'done' ? sp.st : 'all';
  const S = ((await officeProfileFor(u)) as { rok?: RokSettings }).rok ?? {};
  const days = rokDays(S);
  let res = await rokRows(u, { from, to, fid: sp.fid, uid: sp.uid, t: sp.t, st });
  // first visit of a month nobody has generated yet: generate it now (the worker covers only its own window)
  const ids = res.firms.map((f) => f.id);
  if (ids.length) {
    const [c] = await db().select({ n: sql<number>`count(*)::int` }).from(rokovi).where(and(inArray(rokovi.firmId, ids), gte(rokovi.due, from), lte(rokovi.due, to)));
    if (!c?.n) { await syncRokovi(db(), { from, to, firmIds: ids }); res = await rokRows(u, { from, to, fid: sp.fid, uid: sp.uid, t: sp.t, st }); }
  }
  const { rows, firms } = res;
  const [users, lastRun] = await Promise.all([rokColleagues(u), rokoviLastRun(db()).catch(() => null)]);
  const qs = (o: Partial<SP>) => '?' + new URLSearchParams(Object.entries({ ...sp, ...o }).filter(([, v]) => v) as [string, string][]).toString();
  const icsQs = new URLSearchParams(Object.entries({ from, to, fid: sp.fid ?? '', uid: sp.uid ?? '', t: sp.t ?? '', st: st === 'all' ? 'open' : st }).filter(([, v]) => v)).toString();
  const stOf = (r: RokView) => rokState(td, r.due, r.done, days);
  const nOpen = rows.filter((r) => !r.done).length, nLate = rows.filter((r) => stOf(r) === 'late').length, nCheck = rows.filter((r) => !r.verified).length;

  const item = (r: RokView, compact: boolean) => {
    const [lbl, cls] = ROK_STATE_LBL[stOf(r)];
    const tip = `${r.firm}: ${r.title}${r.note ? ' · ' + r.note : ''}${r.verified ? '' : ' · ⚠ датумот е за проверка'}${ROK_SRC[r.type as RokType] ? ' · ' + ROK_SRC[r.type as RokType] : ''}`;
    if (compact) {
      return (
        <div key={r.id} className={`pill ${cls}`} title={tip} style={{ display: 'block', margin: '2px 0', whiteSpace: 'normal', fontSize: 11, textAlign: 'left', textDecoration: r.done ? 'line-through' : undefined }}>
          <FirmGo inline fid={r.firmId} current={firm?.id ?? null} to={`/${r.link}`}>{r.firm.slice(0, 18)}: {r.title}</FirmGo>{!r.verified && ' ⚠'}
        </div>
      );
    }
    return (
      <tr key={r.id} style={r.done ? { opacity: 0.6 } : undefined}>
        <td style={{ whiteSpace: 'nowrap' }}><b>{dmy(r.due)}</b> <span className="mini">{wd(r.due)}</span>{r.due !== r.legalDue && <div className="mini" title="Рокот паѓа во неработен ден – се поместува на првиот нареден работен ден">(законски {dmy(r.legalDue)})</div>}</td>
        <td>{r.firm}</td>
        <td title={tip}>{r.title}{!r.verified && <> <span className="pill warn" title={ROK_SRC[r.type as RokType] ?? ''}>за проверка</span></>}{r.note && <div className="mini">{r.note}</div>}</td>
        <td className="mini">{ROK_TYPES[r.type as RokType]?.n ?? r.type}</td>
        <td><span className={`pill ${cls}`}>{lbl}</span>{r.done && r.auto && <div className="mini">автоматски</div>}{r.done && r.doneAt && <div className="mini">{dmy(r.doneAt.toISOString().slice(0, 10))}</div>}</td>
        <td className="noprint" style={{ whiteSpace: 'nowrap' }}>
          <FirmGo className="btn sm" fid={r.firmId} current={firm?.id ?? null} to={`/${r.link}`} title="Отвори ја фирмата на екранот за оваа обврска">Отвори</FirmGo>{' '}
          {r.done
            ? <RowAction action={markRokAction.bind(null, r.id, false)} label="↺" title="Врати како отворено" />
            : <RowAction action={markRokAction.bind(null, r.id, true)} label="✓ Направено" className="btn sm" />}
        </td>
      </tr>
    );
  };

  const byDay = new Map<string, RokView[]>();
  for (const r of rows) byDay.set(r.due, [...(byDay.get(r.due) ?? []), r]);

  return (
    <>
      {await hubTabs('rokovi', 'rokovi')}
      <Hd t="📅 Календар на рокови" sub={`${firms.length} фирми · ${rows.length} рокови · отворени ${nOpen}${nLate ? ` · поминати ${nLate}` : ''}`}>
        {/* P42: the deadlines are refreshed every day at 07:10 — a status line; the small ↻ only for the owner / administrator */}
        <AutoStatus label="Освежено автоматски" at={lastRun} when="секој ден во 07:10"
          refresh={u.role === 'admin' ? <RowAction className="btn sm ghost" action={syncRokAction.bind(null, ym)} label="↻" title="Освежи сега: повторно ги пресметува роковите од поставките на фирмите" showOk /> : null} />
        <a className="btn" href={`/api/rokovi/ics?${icsQs}`} title="Календар (ICS) за Outlook / Google / телефон">📥 ICS</a>
        <Link className={`btn ${list ? '' : 'pri'}`} href={qs({ v: '' })}>Месец</Link>
        <Link className={`btn ${list ? 'pri' : ''}`} href={qs({ v: 'lista' })}>Листа</Link>
      </Hd>

      <form className="card">
        <div className="row" style={{ gap: '6px 12px', flexWrap: 'wrap', alignItems: 'center' }}>
          {list && <input type="hidden" name="v" value="lista" />}
          <Link className="btn sm" href={qs({ m: rokYmAdd(ym, -1) })}>◀</Link>
          <input type="month" name="m" defaultValue={sp.m ?? (list ? '' : ym)} style={{ width: 'auto' }} aria-label="Месец" />
          <Link className="btn sm" href={qs({ m: rokYmAdd(ym, 1) })}>▶</Link>
          <select name="uid" defaultValue={sp.uid ?? ''} style={{ width: 'auto' }} aria-label="Колега"><option value="">Сите колеги</option>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <select name="fid" defaultValue={sp.fid ?? ''} style={{ width: 'auto' }} aria-label="Фирма"><option value="">Сите фирми</option>{firms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
          <select name="t" defaultValue={sp.t ?? ''} style={{ width: 'auto' }} aria-label="Вид"><option value="">Сите видови</option>{ROK_TYPE_IDS.filter((t) => t !== 'kdog' || res.owner).map((t) => <option key={t} value={t}>{ROK_TYPES[t].n}</option>)}</select>
          <select name="st" defaultValue={st} style={{ width: 'auto' }} aria-label="Состојба"><option value="all">Сите</option><option value="open">Не се направени</option><option value="done">Направени</option></select>
          <button className="btn sm">Прикажи</button>
        </div>
        {nCheck > 0 && <div className="mini" style={{ marginTop: 6 }}>⚠ „за проверка“ – датумот не е потврден од службен извор (УЈП / ЦРМ / АВРМ); проверете го пред да се потпрете на него.</div>}
      </form>

      {list ? (
        <div className="tw" id="rok_list"><table>
          <thead><tr><th>Рок</th><th>Фирма</th><th>Обврска</th><th>Вид</th><th>Состојба</th><th /></tr></thead>
          <tbody>{rows.length ? rows.map((r) => item(r, false)) : <tr><td colSpan={6} className="empty">Нема рокови за избраните услови.</td></tr>}</tbody>
        </table></div>
      ) : (
        <div className="card"><h2>{rokMonthName(ym)}</h2>
          <div className="tw"><table className="dense" style={{ tableLayout: 'fixed' }}>
            <thead><tr>{WD.map((d) => <th key={d}>{d}</th>)}</tr></thead>
            <tbody>{rokMonthGrid(ym).map((w, i) => (
              <tr key={i}>{w.map((d, j) => (
                <td key={j} style={{ verticalAlign: 'top', height: 90, background: d === td ? 'var(--accent-bg, #eef4ff)' : j >= 5 ? 'var(--bg2, #f7f7f7)' : undefined }}>
                  {d && <><div className="mini"><b>{Number(d.slice(8))}</b></div>{(byDay.get(d) ?? []).map((r) => item(r, true))}</>}
                </td>
              ))}</tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      {/* 🎭 no reminder settings in the demo (the e-mails / client reminders are off there) */}
      {!demo && (
        <details className="card">
          <summary><b>⚙ Потсетници</b> <span className="mini">— {days} дена пред рокот{S.mail !== false ? ' · е-пошта до колегата' : ''}{S.client?.on ? ` · клиенти на ${rokClientDay(S)}-ти` : ''}</span></summary>
          <ActionForm action={saveRokSettings} className="" reset={false}>
            <div className="row" style={{ gap: '8px 16px', flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
              <label>Потсети <input type="number" name="days" min={0} max={60} defaultValue={days} style={{ width: 70 }} /> дена пред рокот</label>
              <label className="chk"><input type="checkbox" name="mail" defaultChecked={S.mail !== false} /> е-пошта до одговорниот колега (кога е подесена е-поштата / SMTP)</label>
            </div>
            <div className="mini" style={{ margin: '4px 0 8px' }}>Во програмата: 📅 бројот горе десно ги покажува отворените рокови во овие денови (и поминатите). Одговорен колега = корисникот доделен на фирмата во „Корисници“.</div>
            <div className="row" style={{ gap: '8px 16px', flexWrap: 'wrap', alignItems: 'center' }}>
              <label className="chk"><input type="checkbox" name="clOn" defaultChecked={!!S.client?.on} /> Потсетник до клиентите „Ве молиме доставете ги изводите / фактурите за месец …“</label>
              <label>на <input type="number" name="clDay" min={1} max={28} defaultValue={rokClientDay(S)} style={{ width: 60 }} />-ти во месецот</label>
              <label className="chk"><input type="checkbox" name="clPortal" defaultChecked={S.client?.portal !== false} /> порака во порталот</label>
              <label className="chk"><input type="checkbox" name="clMail" defaultChecked={S.client?.mail !== false} /> е-пошта до фирмата</label>
              <button className="btn pri">Зачувај</button>
            </div>
          </ActionForm>
        </details>
      )}
    </>
  );
}
