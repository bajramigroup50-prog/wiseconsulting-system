/**
 * ⚖ Правен асистент (AI) — server addition (owner priority: laws). When there is a problem (an inspection, a client
 * question, a disputed treatment) the office asks a legal question or compares, and the answer cites the ARTICLES of
 * the stored law texts (`law_texts` / `law_articles`, synchronised weekly by the law robot or imported from an official
 * link / pasted), with the version and the source, plus the firm's summary facts when a firm and period are chosen.
 *
 * Tabs: ❓ Прашај (AI, Sonnet; „🔍 Детално“ → Opus) · ⚖ Спореди (law ↔ law, version ↔ version, our treatment ↔ the
 * law: free tables, „🤖 AI заклучок“ optional) · 🔎 Членови (free search) · 🗂 Историја (saved cases per firm) ·
 * 📚 Корпус (stored laws, versions, sync / import). A case opens as an internal memo: Word / PDF, „📎 Додај во контрола“.
 * Office staff only (never the client portal); the owner also sees the cases of all firms.
 */
import Link from 'next/link';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { can } from '@wise/core';
import { citeLabel, LAW_CASE_KIND, LAW_CORPUS, lawAbbr, type LawCaseKind } from '@wise/core/law';
import { firms, kontroli, lawCases, lawCorpusStatus, lawTextSync, lawVersions, searchLawArticles } from '@wise/db';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { artTitle, type CaseResult } from '@/lib/law-memo';
import { isOfficeOwner } from '@/lib/office-owner';
import { isUuid, officePage, today } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { AiBadge } from '@/components/ai-badge';
import { Hd, dmyHm } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { AskPoll } from '../zakoni/ask-poll';
import { lawCaseAttach, lawCaseDelete, lawCaseStart, lawTextFromUrl, lawTextPaste, lawTextsSyncNow } from './actions';
import { AttachKontrola } from './attach';

type Sp = { t?: string; case?: string; q?: string; law?: string; date?: string; art?: string; all?: string };
const TABS: [string, string][] = [['ask', '❓ Прашај'], ['cmp', '⚖ Спореди'], ['art', '🔎 Членови (бесплатно)'], ['hist', '🗂 Историја'], ['corpus', '📚 Корпус на закони']];

const LawSelect = ({ name, multiple, def, required }: { name: string; multiple?: boolean; def?: string | string[]; required?: boolean }) => (
  <select name={name} multiple={multiple} defaultValue={def} required={required} size={multiple ? 5 : undefined} style={{ minWidth: 220 }}>
    {!multiple && <option value="">— закон —</option>}
    {LAW_CORPUS.map((l) => <option key={l.k} value={l.k}>{l.abbr} – {l.n}</option>)}
  </select>
);

export default async function LawAiPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const { u, firm } = await officePage('lawAi');
  const td = today();
  const y0 = `${td.slice(0, 4)}-01-01`;
  const office = can(u.principal, 'office', firm?.id ?? null);
  const settings = can(u.principal, 'settings');
  const owner = await isOfficeOwner(u);
  const corpus = await lawCorpusStatus(db());
  const have = corpus.filter((c) => c.versions > 0).length;
  const tab = sp.case ? 'case' : TABS.some(([k]) => k === sp.t) ? sp.t! : 'ask';
  const href = (o: Record<string, string>) => '/lawAi?' + new URLSearchParams(o).toString();

  return (
    <>
      <Hd t="⚖ Правен асистент (AI)" sub={`${have} од ${corpus.length} закони во базата${firm ? ' · ' + firm.name : ''}`}>
        <Link className="btn" href="/zakoni">⚖️ Законски промени</Link>
        <Link className="btn" href="/ujpZakoni">📚 Закони на УЈП</Link>
      </Hd>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '0 0 10px' }}>
        {TABS.map(([k, t]) => <Link key={k} className={`btn sm ${tab === k ? 'pri' : ''}`} href={href({ t: k })}>{t}</Link>)}
      </div>
      {have < corpus.length && tab !== 'corpus' && (
        <div className="callout warn" style={{ fontSize: 12.5 }}>Базата на законски текстови е непотполна ({have} од {corpus.length}). Каде што текстот го нема, асистентот пишува „треба да се провери“ наместо да измислува членови. <Link href={href({ t: 'corpus' })}>📚 Корпус → синхронизирај / внеси текст</Link></div>
      )}
      {tab === 'ask' && <AskTab firm={firm?.name ?? null} y0={y0} td={td} office={office} />}
      {tab === 'cmp' && <CmpTab firm={firm?.name ?? null} y0={y0} td={td} office={office} sp={sp} />}
      {tab === 'art' && <ArtTab sp={sp} td={td} />}
      {tab === 'hist' && <HistTab firmId={firm?.id ?? null} all={owner && sp.all === '1'} owner={owner} href={href} />}
      {tab === 'corpus' && <CorpusTab corpus={corpus} settings={settings} />}
      {tab === 'case' && <CaseView id={sp.case!} uPrincipal={u.principal} firmId={firm?.id ?? null} owner={owner} />}
    </>
  );
}

function FirmPeriod({ firm, y0, td, forced }: { firm: string | null; y0: string; td: string; forced?: boolean }) {
  return (
    <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {forced ? <input type="hidden" name="firm" value="1" /> : (
        <label className="row" style={{ gap: 4, alignItems: 'center' }}><input type="checkbox" name="firm" value="1" defaultChecked={!!firm} disabled={!firm} />
          за фирмата {firm ? <b>{firm}</b> : <span className="note">(изберете фирма горе)</span>}</label>
      )}
      {forced && <span>Фирма: {firm ? <b>{firm}</b> : <span className="pill bad">изберете фирма горе</span>}</span>}
      <label>од <input type="date" name="from" defaultValue={y0} /></label>
      <label>до <input type="date" name="to" defaultValue={td} /></label>
    </div>
  );
}

function AskTab({ firm, y0, td, office }: { firm: string | null; y0: string; td: string; office: boolean }) {
  if (!office) return <div className="card empty">Само канцеларијата (улога со право „office“) може да поставува прашања.</div>;
  return (
    <ActionForm action={lawCaseStart} reset={false}>
      <input type="hidden" name="kind" value="ask" />
      <textarea name="q" rows={3} style={{ width: '100%' }} required
        placeholder="Прашање на македонски или албански, пр. „Дали оваа фирма требаше да пресмета ДДВ на авансот?“ / „A duhej firma të llogariste TVSH në avans?“" />
      <FirmPeriod firm={firm} y0={y0} td={td} />
      <div className="row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 8 }}>
        <label>Ограничи на закони (по избор, Ctrl+клик):<br /><LawSelect name="laws" multiple /></label>
        <div style={{ display: 'grid', gap: 6 }}>
          <label>Закон во верзија на ден (по избор): <input type="date" name="date" /></label>
          <label title="Opus – подолг контекст и подетално образложение, повеќе трошок"><input type="checkbox" name="deep" value="1" /> 🔍 Детално (Opus)</label>
          <button className="btn pri">⚖ Прашај<AiBadge /></button>
        </div>
      </div>
      <p className="note" style={{ marginTop: 8 }}>Асистентот ги пребарува членовите во зачуваните текстови на законите и цитира само нив (закон, член, став, верзија). Што го нема во базата → „треба да се провери“. Од книгите се праќаат само збирни податоци. Ова не е правен совет.</p>
    </ActionForm>
  );
}

function CmpTab({ firm, y0, td, office, sp }: { firm: string | null; y0: string; td: string; office: boolean; sp: Sp }) {
  if (!office) return <div className="card empty">Само канцеларијата може да прави споредби.</div>;
  const ai = <label title="Моделот дава заклучок врз табелата (троши AI-кредит)"><input type="checkbox" name="ai" value="1" /> 🤖 AI заклучок<AiBadge /></label>;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <ActionForm action={lawCaseStart} reset={false}>
        <h3 style={{ margin: '0 0 6px' }}>⚖ Закон наспроти закон</h3>
        <input type="hidden" name="kind" value="law" />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <LawSelect name="laws" required /> <span>наспроти</span> <LawSelect name="laws" required />
          <input name="q" placeholder="Тема, пр. „рокови за жалба“, „застареност“" style={{ minWidth: 240 }} required />
          <label>на ден <input type="date" name="date" /></label>
        </div>
        <div className="row" style={{ gap: 12, alignItems: 'center', marginTop: 6 }}>{ai}<button className="btn pri">Спореди</button></div>
        <p className="note">Без AI: најблиските членови од двата прописа една до друга. Пример: ЗДДВ наспроти Правилник; ЗДП наспроти ЗИН за роковите.</p>
      </ActionForm>
      <ActionForm action={lawCaseStart} reset={false}>
        <h3 style={{ margin: '0 0 6px' }}>🕓 Верзија наспроти верзија (ист член пред и по измена)</h3>
        <input type="hidden" name="kind" value="ver" />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <LawSelect name="law" def={sp.law} required />
          <input name="art" placeholder="член, пр. 14 или 12-а" defaultValue={sp.art ?? ''} style={{ width: 150 }} required />
          <label>кој важи на ден <input type="date" name="date" defaultValue={td} /></label>
          <input name="q" placeholder="Белешка / прашање (по избор)" style={{ minWidth: 200 }} />
        </div>
        <div className="row" style={{ gap: 12, alignItems: 'center', marginTop: 6 }}>{ai}<button className="btn pri">Спореди верзии</button></div>
        <p className="note">Бесплатно: разлика збор по збор меѓу последните две зачувани верзии, со датумите и која верзија се применува.</p>
      </ActionForm>
      <ActionForm action={lawCaseStart} reset={false}>
        <h3 style={{ margin: '0 0 6px' }}>📒 Нашиот третман наспроти законот</h3>
        <input type="hidden" name="kind" value="treat" />
        <FirmPeriod firm={firm} y0={y0} td={td} forced />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-start', marginTop: 6 }}>
          <input name="q" placeholder="Што се споредува, пр. „ДДВ стапки и аванси“, „готовински плаќања“, „плати“" style={{ minWidth: 300 }} required />
          <label>Закони (по избор):<br /><LawSelect name="laws" multiple /></label>
        </div>
        <div className="row" style={{ gap: 12, alignItems: 'center', marginTop: 6 }}>{ai}<button className="btn pri" disabled={!firm}>Спореди</button></div>
        <p className="note">Бесплатно: правилата на даночниот преглед (член → правило → книжења) и збирните податоци од книгите за периодот, со отстапувањата.</p>
      </ActionForm>
    </div>
  );
}

async function ArtTab({ sp, td }: { sp: Sp; td: string }) {
  const q = (sp.q ?? '').trim();
  const law = sp.law && LAW_CORPUS.some((l) => l.k === sp.law) ? sp.law : '';
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : '';
  const H = q ? await searchLawArticles(db(), q, { laws: law ? [law] : null, date: date || null, limit: 25 }) : [];
  return (
    <>
      <form className="card row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="hidden" name="t" value="art" />
        <input name="q" defaultValue={q} placeholder="Збор или „чл. 14 ЗДДВ“" style={{ minWidth: 260 }} />
        <LawSelect name="law" def={law} />
        <label>верзија на ден <input type="date" name="date" defaultValue={date} max={td} /></label>
        <button className="btn pri">🔎 Барај</button>
        <span className="note">Бесплатно – без AI.</span>
      </form>
      {q && !H.length && <div className="card empty">Нема член во базата за „{q}“{date ? ` во верзијата на ${dmy(date)}` : ''}.</div>}
      {H.map((a) => (
        <div key={a.id} className="card" style={{ marginBottom: 8 }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <b>{artTitle(a)}</b>
            <span className="row" style={{ gap: 6 }}>
              <Link className="btn sm" href={`/lawAi?t=cmp&law=${a.law}&art=${encodeURIComponent(a.no)}`}>🕓 Верзии</Link>
              {a.sourceUrl && <a className="btn sm" href={a.sourceUrl} target="_blank" rel="noopener">🔗 Извор</a>}
            </span>
          </div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, marginTop: 6 }}>{a.body}</div>
        </div>
      ))}
    </>
  );
}

async function HistTab({ firmId, all, owner, href }: { firmId: string | null; all: boolean; owner: boolean; href: (o: Record<string, string>) => string }) {
  const where = all ? undefined : firmId ? or(eq(lawCases.firmId, firmId), isNull(lawCases.firmId)) : isNull(lawCases.firmId);
  const C = await db().select({ c: lawCases, firm: firms.name }).from(lawCases).leftJoin(firms, eq(firms.id, lawCases.firmId)).where(where).orderBy(desc(lawCases.createdAt)).limit(200);
  const total = C.reduce((s, x) => s + Number(x.c.costUsd), 0);
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span className="note">{all ? 'Сите фирми' : 'Избраната фирма и општите прашања'} · {C.length} случаи · AI трошок ${total.toFixed(4)}</span>
        {owner && <Link className="btn sm" href={href(all ? { t: 'hist' } : { t: 'hist', all: '1' })}>{all ? 'Само избраната фирма' : 'Сите фирми (сопственик)'}</Link>}
      </div>
      {C.length ? (
        <table className="dense" style={{ width: '100%', marginTop: 6 }}>
          <thead><tr><th>Датум</th><th>Вид</th><th>Прашање</th><th>Фирма</th><th>Прашал</th><th>Модел</th><th className="num">$</th><th>Статус</th></tr></thead>
          <tbody>{C.map(({ c, firm }) => (
            <tr key={c.id}>
              <td>{dmyHm(c.createdAt)}</td>
              <td>{LAW_CASE_KIND[c.kind as LawCaseKind] ?? c.kind}</td>
              <td><Link href={`/lawAi?case=${c.id}`}>{c.question.slice(0, 110)}</Link>{c.kontrolaId && <span className="pill info" style={{ marginLeft: 4 }}>📎 контрола</span>}</td>
              <td>{firm ?? '—'}</td>
              <td>{c.byName ?? '—'}</td>
              <td>{c.model ?? 'без AI'}</td>
              <td className="num">{Number(c.costUsd) ? Number(c.costUsd).toFixed(4) : '—'}</td>
              <td>{c.status === 'queued' ? '⏳' : c.status === 'error' ? <span className="pill bad">грешка</span> : '✓'}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : <div className="empty">Сè уште нема зачувани случаи.</div>}
    </div>
  );
}

async function CorpusTab({ corpus, settings }: { corpus: Awaited<ReturnType<typeof lawCorpusStatus>>; settings: boolean }) {
  const S = await db().select().from(lawTextSync);
  const sync = new Map(S.map((s) => [s.law, s]));
  const V = await Promise.all(corpus.filter((c) => c.versions > 1).map(async (c) => [c.law, await lawVersions(db(), c.law)] as const));
  const vers = new Map(V);
  return (
    <>
      <div className="callout" style={{ fontSize: 12.5 }}>Роботот за закони еднаш неделно ги презема пречистените текстови од официјалните страници (ujp.gov.mk) и ги дели на членови; нова верзија се зачувува само кога текстот ќе се промени (со датумот на верзијата, изворот и датумот на преземање). За законите без автоматски извор внесете го официјалниот линк или залепете го текстот. Бесплатно – без AI.</div>
      {settings && <div className="row" style={{ gap: 8, margin: '8px 0' }}><RowAction className="btn" action={lawTextsSyncNow} label="🔄 Синхронизирај од официјалните извори" inline /></div>}
      <div className="card">
        <table className="dense" style={{ width: '100%' }}>
          <thead><tr><th>Закон</th><th>Верзии</th><th>Последна верзија</th><th>Членови</th><th>Извор</th><th>Робот</th></tr></thead>
          <tbody>{corpus.map((c) => {
            const s = sync.get(c.law);
            return (
              <tr key={c.law}>
                <td><b>{c.abbr}</b> – {c.name}</td>
                <td className="num">{c.versions || <span className="pill warn">нема</span>}</td>
                <td>{c.latest ? <>{dmy(c.latest.asOf)}{c.latest.effectiveFrom ? ` (важи од ${dmy(c.latest.effectiveFrom)})` : ''}<div className="note">преземено {dmyHm(c.latest.fetchedAt)} · {c.latest.source === 'robot' ? 'робот' : c.latest.source === 'link' ? 'линк' : 'рачно'}</div>{(vers.get(c.law) ?? []).length > 1 && <div className="note">претходни: {vers.get(c.law)!.slice(0, -1).map((v) => dmy(v.asOf)).join(', ')}</div>}</> : '—'}</td>
                <td className="num">{c.latest?.articles ?? '—'}</td>
                <td>{c.latest?.sourceUrl ? <a href={c.latest.sourceUrl} target="_blank" rel="noopener">🔗 текст</a> : <a href={c.home} target="_blank" rel="noopener">официјална страница</a>}</td>
                <td>{c.auto ? (s ? (s.error ? <span className="pill bad" title={s.error}>грешка</span> : <span className="note">{dmyHm(s.checkedAt)}</span>) : <span className="note">чека</span>) : <span className="note">рачно / линк</span>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      {settings && (
        <div className="row" style={{ gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <ActionForm action={lawTextFromUrl} style={{ flex: 1, minWidth: 300 }}>
            <h3 style={{ margin: '0 0 6px' }}>📥 Преземи од официјален линк</h3>
            <LawSelect name="law" required />
            <input name="url" type="url" placeholder="https://… (gov.mk, slvesnik.com.mk, sobranie.mk)" style={{ width: '100%', marginTop: 6 }} required />
            <input name="title" placeholder="Наслов (пр. „пречистен текст 30.12.2025“) – датумот станува датум на верзијата" style={{ width: '100%', marginTop: 6 }} />
            <button className="btn pri" style={{ marginTop: 6 }}>📥 Преземи</button>
          </ActionForm>
          <ActionForm action={lawTextPaste} style={{ flex: 1, minWidth: 300 }}>
            <h3 style={{ margin: '0 0 6px' }}>📋 Внеси текст (копиран од официјален извор)</h3>
            <LawSelect name="law" required />
            <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <label>верзија од <input type="date" name="asOf" /></label>
              <label>важи од <input type="date" name="effectiveFrom" /></label>
            </div>
            <input name="title" placeholder="Наслов" style={{ width: '100%', marginTop: 6 }} />
            <input name="url" type="url" placeholder="Извор (линк, по избор)" style={{ width: '100%', marginTop: 6 }} />
            <textarea name="text" rows={6} placeholder={'Член 1\n…\nЧлен 2\n…'} style={{ width: '100%', marginTop: 6 }} required />
            <button className="btn pri" style={{ marginTop: 6 }}>💾 Зачувај верзија</button>
          </ActionForm>
        </div>
      )}
    </>
  );
}

const Tbl = ({ T }: { T: { cols: string[]; rows: string[][] } }) => (
  <div style={{ overflowX: 'auto' }}>
    <table className="dense" style={{ width: '100%' }}>
      <thead><tr>{T.cols.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
      <tbody>{T.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={{ verticalAlign: 'top', whiteSpace: 'pre-wrap' }}>{c}</td>)}</tr>)}</tbody>
    </table>
  </div>
);

async function CaseView({ id, uPrincipal, firmId, owner }: { id: string; uPrincipal: Parameters<typeof can>[0]; firmId: string | null; owner: boolean }) {
  if (!isUuid(id)) return <div className="card empty">Непознат случај.</div>;
  const [row] = await db().select({ c: lawCases, firm: firms.name }).from(lawCases).leftJoin(firms, eq(firms.id, lawCases.firmId)).where(eq(lawCases.id, id)).limit(1);
  // another firm's case: only for the owner or a user allowed on that firm
  if (!row || (row.c.firmId && row.c.firmId !== firmId && !owner && !can(uPrincipal, 'office', row.c.firmId))) return <div className="card empty">Случајот не е најден.</div>;
  const { c } = row;
  const R = c.result as CaseResult;
  const A = R.ai;
  const K = c.firmId ? await db().select({ id: kontroli.id, docNo: kontroli.docNo, docDate: kontroli.docDate, subject: kontroli.subject }).from(kontroli).where(and(eq(kontroli.firmId, c.firmId))).orderBy(desc(kontroli.docDate)).limit(50) : [];
  const office = can(uPrincipal, 'office', c.firmId);
  return (
    <>
      <AskPoll pending={c.status === 'queued'} />
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="pill info">{LAW_CASE_KIND[c.kind as LawCaseKind] ?? c.kind}</span>
          <span className="note">{dmyHm(c.createdAt)} · {c.byName ?? '—'} · {row.firm ?? 'општо прашање'}{c.periodFrom ? ` · ${dmy(c.periodFrom)} – ${dmy(c.periodTo)}` : ''} · {c.model ?? 'без AI'}{Number(c.costUsd) > 0 ? ` · $${Number(c.costUsd).toFixed(4)}` : ''}</span>
        </div>
        <h2 style={{ margin: '8px 0', fontSize: 16, whiteSpace: 'pre-wrap' }}>{c.question}</h2>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <a className="btn sm" href={`/lawAi/word?id=${c.id}`}>⬇ Word</a>
          <Link className="btn sm" href={`/lawMemo?id=${c.id}`} target="_blank">🖨 Белешка / PDF</Link>
          {office && c.firmId && <AttachKontrola action={lawCaseAttach.bind(null, c.id)} current={c.kontrolaId} options={K.map((k) => ({ id: k.id, label: `${k.docNo ?? 'без број'} · ${dmy(k.docDate)}${k.subject ? ' · ' + k.subject.slice(0, 50) : ''}` }))} />}
          {can(uPrincipal, 'del') && <RowAction className="btn sm ghost" style={{ color: 'var(--bad,#b42318)' }} action={lawCaseDelete.bind(null, c.id)} label="🗑" title="Избриши го случајот" confirm="Да се избрише случајот?" inline okHref="/lawAi?t=hist" okLink="🗂 Историја" />}
        </div>
      </div>
      {c.status === 'queued' && <div className="callout">⏳ Се бараат членовите и се подготвува одговорот…</div>}
      {c.status === 'error' && <div className="callout bad">Не успеа: {c.error}</div>}
      {R.aiError && c.status === 'done' && <div className="callout warn">AI: {R.aiError}</div>}
      {A && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{A.lang === 'sq' ? 'Përgjigje e shkurtër' : 'Краток одговор'}</h3>
          <p style={{ whiteSpace: 'pre-wrap', fontSize: 15 }}>{A.short}</p>
          {A.reasoning.length > 0 && <h3>{A.lang === 'sq' ? 'Arsyetimi ligjor' : 'Правно образложение'}</h3>}
          {A.reasoning.map((r, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <p style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>{r.text}</p>
              {r.cites.map((x, j) => {
                const a = R.articles?.find((y) => y.law === x.law && y.no === x.art);
                return <blockquote key={j} style={{ margin: '4px 0 4px 14px', paddingLeft: 8, borderLeft: '3px solid var(--accent)', fontSize: 13 }}><b>{citeLabel(x)}</b>{a ? <span className="note"> · верзија {dmy(a.asOf)}{a.sourceUrl && <> · <a href={a.sourceUrl} target="_blank" rel="noopener">извор</a></>}</span> : null}<br />„{x.quote}“</blockquote>;
              })}
            </div>
          ))}
          {A.exceptions.length > 0 && <><h3>{A.lang === 'sq' ? 'Përjashtime' : 'Исклучоци'}</h3><ul>{A.exceptions.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
          {A.evidence.length > 0 && <><h3>{A.lang === 'sq' ? 'Dokumente të nevojshme' : 'Потребни документи / докази'}</h3><ul>{A.evidence.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
          {A.table && A.table.rows.length > 0 && <><h3>{A.lang === 'sq' ? 'Krahasim' : 'Споредба'}</h3><Tbl T={A.table} /></>}
          {A.conclusion && <><h3>{A.lang === 'sq' ? 'Përfundim' : 'Заклучок'}</h3><p style={{ whiteSpace: 'pre-wrap' }}>{A.conclusion}</p></>}
          {A.verify.length > 0 && <div className="callout warn"><b>{A.lang === 'sq' ? 'Duhet të verifikohet' : 'Треба да се провери'}:</b><ul style={{ margin: '4px 0' }}>{A.verify.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          {R.guard && (R.guard.removed.length > 0 || R.guard.fixed.length > 0) && <p className="note">🛡 Проверка на цитати: отстранети {R.guard.removed.length} (ги нема во базата){R.guard.removed.length ? ': ' + R.guard.removed.join(', ') : ''}; поправени цитати {R.guard.fixed.length}.</p>}
        </div>
      )}
      {R.versions && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>🕓 Верзии</h3>
          {R.versions.map((v, i) => <div key={v.textId + i}>{i ? 'Б' : 'А'}) {v.title} – верзија <b>{dmy(v.asOf)}</b>{v.effectiveFrom ? `, важи од ${dmy(v.effectiveFrom)}` : ''}{R.applies === v.textId && <span className="pill good" style={{ marginLeft: 6 }}>се применува на {dmy(R.date)}</span>}{v.sourceUrl && <> · <a href={v.sourceUrl} target="_blank" rel="noopener">извор</a></>}</div>)}
          {R.single && <p className="note">Во базата има само една верзија на членот.</p>}
          {!R.applies && <div className="callout warn">Треба да се провери: нема зачувана верзија што важи на {dmy(R.date)}.</div>}
          {R.diff && <p style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6 }}>{R.diff.map((d, i) => d.t === 'eq' ? <span key={i}>{d.s}</span> : d.t === 'del' ? <del key={i} style={{ background: '#fee4e2' }}>{d.s}</del> : <ins key={i} style={{ background: '#d1fadf' }}>{d.s}</ins>)}</p>}
        </div>
      )}
      {R.table && R.table.rows.length > 0 && <div className="card"><h3 style={{ marginTop: 0 }}>{A?.table ? 'Споредба од базата / книгите (без AI)' : 'Споредба (без AI)'}</h3><Tbl T={R.table} /></div>}
      {(R.missing ?? []).length > 0 && <div className="callout warn">Треба да се провери: нема зачуван текст за {R.missing!.map(lawAbbr).join(', ')} – <Link href="/lawAi?t=corpus">📚 Корпус</Link>.</div>}
      {c.status === 'done' && !(R.articles ?? []).length && <div className="callout warn">Во базата не се најдени членови за ова прашање – треба да се провери на официјален извор.</div>}
      {(R.articles ?? []).length > 0 && (
        <details className="card" open={!A}>
          <summary><b>📚 Користени членови ({R.articles!.length})</b> <span className="note">– од зачуваните текстови, во верзијата што важи на {dmy(R.date)}</span></summary>
          {R.articles!.map((a) => (
            <div key={a.id} style={{ marginTop: 8 }}>
              <b>{artTitle(a)}</b>{a.sourceUrl && <> · <a href={a.sourceUrl} target="_blank" rel="noopener">извор</a></>}
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 12.5 }}>{a.body}</div>
            </div>
          ))}
        </details>
      )}
      {R.changes && R.changes.length > 0 && <div className="card"><b>Поврзани законски промени:</b>{R.changes.map((x, i) => <div key={i} className="note">{dmy(x.date)} · {x.title}{x.from ? ` · важи од ${dmy(x.from)}` : ''}{x.to ? ` до ${dmy(x.to)}` : ''}</div>)}</div>}
      <p className="note">Ова не е правен совет – цитатите се од зачуваните текстови; пред одлука проверете го важечкиот текст во Службен весник.</p>
    </>
  );
}
