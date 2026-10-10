/**
 * Legacy `VIEWS.zakoni` 14323 (+ v465 robot hero 14394, fuel note) — ⚖️ Законски промени: what the daily robot found at
 * УЈП and Службен весник, filters by institution and text, „НОВО“ since the user's last „прочитано“, the AI assistant
 * („🤖 Прашај“, worker `law.ask`), removal (administrator) and the robot's last run. Office only (not klient / teren).
 */
import { desc, eq } from 'drizzle-orm';
import { can } from '@wise/core';
import { fuelRate, LAW_IMP, LAW_INST, lawFilter, lawFirms, lawNew } from '@wise/core/law';
import { lawAsks, lawRuns, lawSources } from '@wise/db';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { loadLaw, lawSeenOf } from '@/lib/law';
import { allowedFirms, officePage, today } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { Hd, dmyHm } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { lawAskStart, lawDelete, lawRunNow, lawSeenAll } from './actions';
import { AskPoll } from './ask-poll';
import { Robot, RobotCss } from './robot';

const linkify = (s: string) => s.split(/(https?:\/\/[^\s<]+)/g).map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noopener">{p}</a> : p));

export default async function ZakoniPage({ searchParams }: { searchParams: Promise<{ inst?: string; q?: string }> }) {
  const sp = await searchParams;
  const { u } = await officePage('zakoni');
  const td = today();
  const [L, seen, F, [ask], [run], S] = await Promise.all([
    loadLaw(), lawSeenOf(u.id), allowedFirms(u),
    db().select().from(lawAsks).where(eq(lawAsks.userId, u.id)).orderBy(desc(lawAsks.createdAt)).limit(1),
    db().select().from(lawRuns).orderBy(desc(lawRuns.startedAt)).limit(1),
    db().select({ name: lawSources.name, error: lawSources.error, checkedAt: lawSources.checkedAt }).from(lawSources),
  ]);
  const inst = sp.inst && LAW_INST[sp.inst] ? sp.inst : '';
  const R = lawFilter(L, inst, sp.q ?? '');
  const cnt = (k: string) => L.filter((x) => x.inst === k).length;
  const ins = Object.keys(LAW_INST).filter((k) => cnt(k));
  const N = lawNew(L, seen).length;
  const last = L.map((x) => x.at).sort().pop();
  const fr = fuelRate(L, td);
  const firms = F.filter((f) => !(f.settings as { example?: boolean; officeFirm?: boolean }).example).map((f) => ({ vat: f.vatRegistered }));
  const del = can(u.principal, 'del');
  const qs = (o: Record<string, string>) => '?' + new URLSearchParams(Object.entries({ inst, q: sp.q ?? '', ...o }).filter(([, v]) => v)).toString();
  const errs = S.filter((s) => s.error);

  return (
    <>
      <RobotCss />
      <Hd t="⚖️ Законски промени" sub="УЈП, УФР, ЦРМ, ДПИ, ДИТ, АВРМ, ПИОМ, ФЗОМ, Царина, МФ, Мин. економија и труд, Мин. дигитална трансформација, Мин. транспорт, МВР (странци), Службен весник, ИСОС, НБРМ">
        <RowAction className="btn" action={lawSeenAll} label="✓ Означи ги сите како прочитани" />
        {can(u.principal, 'settings') && <RowAction className="btn" action={lawRunNow} label="▶ Провери сега" />}
      </Hd>
      <div className="lawbot-hero">
        <Robot size={110} alert={N > 0} id="rbz" />
        <div className="lawbot-say">
          <b>Здраво! Јас сум роботот за законски промени.</b><br />
          Секој ден во 06:52 ги проверувам УЈП (соопштенија и даночна регулатива) и Службен весник.
          {N ? <><br />Имам <b>{N} нови</b> известувања за вас.</> : <><br />Нема нови известувања од последното читање.</>}
          {fr && fr.inR && fr.R.to && <><br />⛽ Внимание: ДДВ за гориво е {fr.rate}% до <b>{dmy(fr.R.to)}</b>.</>}
          {last && <><br /><span className="note">Последен внес: {dmy(last.slice(0, 10))}</span></>}
          {run && <><br /><span className="note">Последна проверка: {dmyHm(run.finishedAt ?? run.startedAt)} · {run.sources} извори · нови {run.added}{run.errors.length ? ` · ${run.errors.length} извори не се достапни` : ''}</span></>}
        </div>
      </div>
      <div className="callout">Роботот секој ден ги проверува институциите и ги внесува промените тука. Кога има нови промени, стигнува и е-пошта до канцеларијата. <b>Ова не е правен совет</b> – секогаш проверете го изворот (линкот).</div>
      {errs.length > 0 && <details className="note"><summary>Извори што не беа достапни при последната проверка ({errs.length})</summary>{errs.map((s) => <div key={s.name}>{s.error}</div>)}</details>}
      <div className="card">
        <AskPoll pending={ask?.status === 'queued'} />
        <ActionForm action={lawAskStart} reset={false} className="row" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <textarea name="q" rows={2} style={{ flex: 1, minWidth: 280 }} defaultValue={ask?.question ?? ''} placeholder="Прашајте нешто, пр. „До кога важи ДДВ 10% за горива?“ или „Кои се стапките на придонеси за плата октомври 2026?“" />
          <button className="btn pri">🤖 Прашај</button>
        </ActionForm>
        {ask && (ask.status === 'queued'
          ? <div className="callout" style={{ marginTop: 8 }}>⏳ Се бара одговор…</div>
          : ask.status === 'error' ? <div className="callout warn" style={{ marginTop: 8 }}>Не успеа одговорот: {ask.error}</div>
            : <div className="callout" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{linkify(ask.answer ?? '')}</div>)}
      </div>
      <form className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '10px 0' }}>
        {inst && <input type="hidden" name="inst" value={inst} />}
        <input name="q" placeholder="Барај…" defaultValue={sp.q ?? ''} style={{ maxWidth: 240 }} />
        <div className="fp2-chips row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <a className={`btn sm ${!inst ? 'pri' : ''}`} href={qs({ inst: '' })}>Сите ({L.length})</a>
          {ins.map((k) => <a key={k} className={`btn sm ${inst === k ? 'pri' : ''}`} href={qs({ inst: k })}>{LAW_INST[k]} ({cnt(k)})</a>)}
        </div>
      </form>
      {R.length ? R.map((x) => {
        const nw = x.at > (seen ?? '');
        const nf = lawFirms(x, firms);
        return (
          <div key={x.id} className="card" style={{ marginBottom: 8, ...(nw ? { borderLeft: '4px solid var(--accent)' } : {}) }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="pill info">{LAW_INST[x.inst] ?? x.inst}</span>
                {nw && <span className="pill good">НОВО</span>}
                {x.to && (x.to >= td ? <span className="pill warn">важи до {dmy(x.to)}</span> : <span className="pill">истечено {dmy(x.to)}</span>)}
                {!x.verified && <span className="pill" title="Изворот е секундарен – потврдете на официјалната страница">⚠ да се потврди</span>}
              </div>
              <span className="note">{x.date ? 'објавено ' + dmy(x.date) : ''}</span>
            </div>
            <h3 style={{ margin: '6px 0 4px', fontSize: 16 }}>{x.title}</h3>
            {x.what && <p style={{ margin: '0 0 6px', whiteSpace: 'pre-wrap' }}>{x.what}</p>}
            <div className="note">
              {x.from && <>Важи од: <b>{dmy(x.from)}</b>{x.to && <> до <b>{dmy(x.to)}</b></>} · </>}
              {x.who ? 'Засега: ' + x.who : x.impact.map((k) => LAW_IMP[k] ?? k).join(', ')}
              {nf > 0 && <> · <b>{nf}</b> ваши фирми</>}
            </div>
            {x.prog && <div className="note" style={{ marginTop: 4 }}>🖥 Во програмата: {x.prog}</div>}
            <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              {x.urls.filter(Boolean).map((url, i) => <a key={url} className="btn sm" href={url} target="_blank" rel="noopener">🔗 Извор{x.urls.length > 1 ? ' ' + (i + 1) : ''}</a>)}
              {del && <RowAction className="btn sm ghost" style={{ color: 'var(--bad,#b42318)' }} action={lawDelete.bind(null, x.id)} label="🗑" title="Отстрани" confirm="Да се отстрани записот?" />}
            </div>
          </div>
        );
      }) : <div className="card empty">{L.length ? 'Нема запис за филтерот.' : 'Сè уште нема записи – роботот ќе ги внесе при првата проверка.'}</div>}
    </>
  );
}
