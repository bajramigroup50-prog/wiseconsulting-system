/**
 * „🧾 Документи“ of a disputed inspection case (office only, never rendered for a client): the external document
 * (забелешки на записник / приговор / жалба / тужба) and the internal analysis — print / PDF / Word / edit, the
 * document type, the optional „💲 AI правна анализа“ with accept / discard, and the stored versions.
 */
import { daysLeftText, docText, RECOMMEND_LBL, SUBMISSION_LBL, VERIFY_TAG, type CaseDoc, type KontrolaVersion, type SubmissionType } from '@wise/core/compliance';
import { kontrolaSubType, type KontrolaAiState, type Kontrola } from '@wise/db';
import { ActionForm } from '@/components/action-form';
import { AiBadge } from '@/components/ai-badge';
import { dmy, dmyHm } from '@/components/hd';
import { PdfButton } from '@/components/pdf-button';
import { RowAction } from '@/components/row-action';
import { AskPoll } from '../zakoni/ask-poll';
import { kAddTasks, kAiStart, kDraft, kSubType, kVersionAccept, kVersionDiscard } from './actions';

const PAPER: React.CSSProperties = { border: '1px solid var(--line, #ddd)', padding: 16, background: '#fff', color: '#000', fontFamily: 'serif', lineHeight: 1.45 };
const V_KIND: Record<KontrolaVersion['kind'], string> = { auto: 'автоматски', edit: 'уредено', ai: '💲 AI' };
const RIGHT_LBL = { yes: 'да', no: 'не', partly: 'делумно', unclear: 'нејасно' } as const;
const isHeading = (l: string) => !!l.trim() && l === l.toUpperCase() && /[А-ЯЀ-Џ]/.test(l);

/** The generated document (sections) or a saved text (plain lines; an all-capitals line is a heading). */
function DocView({ id, doc, text }: { id: string; doc: CaseDoc; text?: string }) {
  return (
    <div id={id} style={PAPER}>
      {text ? text.split(/\r?\n/).map((l, i) => (isHeading(l) ? <p key={i} style={{ margin: '8px 0 2px' }}><b>{l}</b></p> : <p key={i} style={{ margin: '0 0 4px', minHeight: 8 }}>{l}</p>)) : <>
        {doc.sections.map((s, i) => <div key={i} style={{ marginBottom: 8 }}>
          {s.h && <b>{s.h.toUpperCase()}</b>}
          {s.p.map((p, j) => (s.center ? <h3 key={j} style={{ textAlign: 'center', margin: '14px 0' }}>{p}</h3> : <p key={j} style={{ margin: '2px 0' }}>{p}</p>))}
        </div>)}
        {doc.verify.length > 0 && <div style={{ marginTop: 8, color: '#93370d' }}><b>ЗА ПРОВЕРКА:</b>{doc.verify.map((v, i) => <p key={i} style={{ margin: '2px 0' }}>{v}</p>)}</div>}
      </>}
    </div>
  );
}

export function CaseDocs({ k, ext, int, texts, versions, ai, edit }: {
  k: Kontrola; ext: CaseDoc; int: CaseDoc; texts: { draft?: string; internalDraft?: string }; versions: KontrolaVersion[]; ai: KontrolaAiState | null; edit: boolean;
}) {
  const ch = ext.choice;
  const sub = kontrolaSubType(k);
  const aiNew = [...versions].reverse().find((v) => v.kind === 'ai' && v.state === 'new' && v.ai);
  const queued = ai?.status === 'queued';
  const urgent = ch.daysLeft != null && ch.daysLeft <= 3;
  return (
    <div id="kDocs">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>🧾 {SUBMISSION_LBL[ch.type]} {ch.deadline ? <span className={`pill ${urgent ? 'bad' : 'warn'}`}>рок {dmy(ch.deadline)} · {daysLeftText(ch.daysLeft)}</span> : null}
            {ch.verify ? <span className="pill info" title="Проверете ги правното средство, органот и рокот во правната поука на актот"> за проверка</span> : null}</h2>
          {edit && <ActionForm action={kSubType.bind(null, k.id)} reset={false} className="" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <label className="mini">Вид на документ <select name="subType" defaultValue={sub ?? ''}>
              <option value="">автоматски (според актот)</option>
              {(Object.entries(SUBMISSION_LBL) as [SubmissionType, string][]).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
            </select></label>
            <button className="btn sm">Примени</button>
          </ActionForm>}
        </div>
        <div className="row" style={{ gap: 6, margin: '6px 0', flexWrap: 'wrap', alignItems: 'center' }}>
          <PdfButton selector="#kExtDoc" title={`${SUBMISSION_LBL[ch.type]}_${k.docNo ?? ''}`} className="btn sm" />
          <a className="btn sm" href={`/kontroli/word?id=${k.id}&doc=draft`}>⬇ Word</a>
          <span className="mini">{texts.draft ? 'Прикажан е зачуваниот (уреден / прифатен) текст.' : 'Генериран од податоците на предметот: се образложуваат само наодите означени „оспори“ / „делумно“; прифатените се само наведени.'} Проверете, дополнете и потпишете – програмата ништо не поднесува.</span>
        </div>
        <DocView id="kExtDoc" doc={ext} text={texts.draft} />
        {edit && <details style={{ marginTop: 6 }}><summary>✎ Уреди го текстот</summary>
          <ActionForm action={kDraft.bind(null, k.id)} reset={false} className="">
            <input type="hidden" name="which" value="external" />
            <textarea name="draft" rows={18} style={{ width: '100%', font: 'inherit' }} defaultValue={texts.draft ?? docText(ext)} />
            <div className="row" style={{ gap: 6 }}><button className="btn sm pri">Зачувај текст</button><span className="mini">Се чува како нова верзија. Празно = повторно генериран текст од наодите.</span></div>
          </ActionForm>
        </details>}
      </div>

      <div className="card" style={{ borderLeft: '4px solid var(--bad, #b42318)' }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>🔒 Внатрешна анализа <span className="mini">(само за канцеларијата – не се прикажува во порталот на клиентот)</span></h2>
          <div className="row" style={{ gap: 6 }}>
            <PdfButton selector="#kIntDoc" title={`Vnatreshna_analiza_${k.docNo ?? ''}`} className="btn sm" />
            <a className="btn sm" href={`/kontroli/word?id=${k.id}&doc=analiza`}>⬇ Word</a>
            {edit && <RowAction action={kAddTasks.bind(null, k.id)} label="+ Задачите во корективни мерки" className="btn sm" showOk />}
          </div>
        </div>
        <details style={{ marginTop: 6 }}><summary>Прикажи ја анализата (ризик, кој / кога, препораки, задачи)</summary>
          <DocView id="kIntDoc" doc={int} text={texts.internalDraft} />
          {edit && <details style={{ marginTop: 6 }}><summary>✎ Уреди</summary>
            <ActionForm action={kDraft.bind(null, k.id)} reset={false} className="">
              <input type="hidden" name="which" value="internal" />
              <textarea name="draft" rows={16} style={{ width: '100%', font: 'inherit' }} defaultValue={texts.internalDraft ?? docText(int)} />
              <button className="btn sm pri">Зачувај</button>
            </ActionForm>
          </details>}
        </details>
      </div>

      {edit && <div className="card">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>💲 AI правна анализа <span className="mini">(по избор – документите погоре се бесплатни)</span></h2>
        <div className="mini" style={{ marginBottom: 6 }}>До AI се испраќа само предметот (наодите, нашите износи, доказите, членовите) и текстовите од базата на закони на програмата – без ЕДБ, адреса и имиња на вработени. Секој член што го нема во базата се означува „{VERIFY_TAG}“. Резултатот е нова верзија – прифатете ја или отфрлете ја; ништо не се испраќа автоматски.</div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <RowAction action={kAiStart.bind(null, k.id, false)} label={<>🤖 AI правна анализа<AiBadge /></>} title="Sonnet" className="btn sm" showOk />
          <RowAction action={kAiStart.bind(null, k.id, true)} label={<>🔍 Детално (Opus)<AiBadge /></>} title="Посилен и поскап модел" className="btn sm" showOk confirm="Деталната анализа го користи најскапиот модел (Opus). Продолжи?" />
          {queued && <span className="pill info">⏳ се изработува…</span>}
          {ai?.status === 'error' && <span className="pill bad">✗ {ai.error}</span>}
        </div>
        <AskPoll pending={queued} />
        {aiNew?.ai && <div style={{ marginTop: 8 }}>
          <div className="mini">Верзија од {dmyHm(new Date(aiNew.at))} · модел {aiNew.model} · трошок {aiNew.costUsd != null ? `$${aiNew.costUsd.toFixed(4)}` : '—'}</div>
          {(aiNew.ai.unverified.length > 0 || aiNew.ai.missing.length > 0) && <div className="callout warn">⚠ Треба да се проверат (ги нема во базата на закони): {[...new Set([...aiNew.ai.unverified, ...aiNew.ai.missing])].join(', ')}</div>}
          <div className="tw"><table className="dense"><thead><tr><th>Наод</th><th>Инспекторот е во право?</th><th className="n">Шанса</th><th>Препорака</th><th>Оценка и аргументи</th></tr></thead>
            <tbody>{aiNew.ai.findings.map((f) => <tr key={f.no}>
              <td>{f.no}</td><td>{RIGHT_LBL[f.inspectorRight]}</td><td className="n">{f.chance}%</td><td>{RECOMMEND_LBL[f.recommendation]}</td>
              <td className="mini">{f.assessment}
                {f.support.map((c, i) => <div key={`s${i}`}>✅ За нас: <b>{c.ref}</b>{c.verified ? null : <span className="pill warn"> треба да се провери</span>} – {c.why}</div>)}
                {f.against.map((c, i) => <div key={`a${i}`}>⚠ Против нас: <b>{c.ref}</b>{c.verified ? null : <span className="pill warn"> треба да се провери</span>} – {c.why}</div>)}
                {f.counter.map((c, i) => <div key={`c${i}`}>↔ {c}</div>)}
                {f.procedural.map((c, i) => <div key={`p${i}`}>§ {c}</div>)}
              </td></tr>)}</tbody></table></div>
          {aiNew.ai.procedural.length > 0 && <div className="mini" style={{ marginTop: 4 }}><b>Процесни аргументи:</b> {aiNew.ai.procedural.join(' · ')}</div>}
          <details style={{ marginTop: 6 }}><summary>Подобрен надворешен документ (AI)</summary><DocView id="kAiExt" doc={ext} text={aiNew.external} /></details>
          <details><summary>Подобрена внатрешна анализа (AI)</summary><DocView id="kAiInt" doc={int} text={aiNew.internal} /></details>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <RowAction action={kVersionAccept.bind(null, k.id, aiNew.id)} label="✓ Прифати ги AI текстовите" className="btn sm pri" showOk confirm="Двата AI текста стануваат текст на предметот (потоа можете да ги уредите). Продолжи?" />
            <RowAction action={kVersionDiscard.bind(null, k.id, aiNew.id)} label="✕ Отфрли" className="btn sm ghost" />
          </div>
        </div>}
      </div>}

      {versions.length > 0 && <details className="card"><summary><b>🗂 Верзии</b> ({versions.length})</summary>
        <div className="tw"><table className="dense"><thead><tr><th>Време</th><th>Вид</th><th>Документ</th><th>Модел / трошок</th><th>Статус</th><th /></tr></thead>
          <tbody>{[...versions].reverse().map((v) => <tr key={v.id}>
            <td className="num">{dmyHm(new Date(v.at))}</td><td>{V_KIND[v.kind]}</td><td>{SUBMISSION_LBL[v.type]}</td>
            <td className="mini">{v.model ? `${v.model} · $${(v.costUsd ?? 0).toFixed(4)}` : '—'}</td>
            <td>{v.state === 'accepted' ? <span className="pill good">прифатена</span> : v.state === 'discarded' ? <span className="pill">отфрлена</span> : v.state === 'new' ? <span className="pill info">нова</span> : null}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              <a className="btn sm ghost" href={`/kontroli/word?id=${k.id}&doc=draft&v=${v.id}`}>⬇ Word</a>
              <a className="btn sm ghost" href={`/kontroli/word?id=${k.id}&doc=analiza&v=${v.id}`}>⬇ Анализа</a>
              {edit && <RowAction action={kVersionAccept.bind(null, k.id, v.id)} label="↺ Врати" confirm="Оваа верзија да стане текст на предметот?" />}
            </td></tr>)}</tbody></table></div>
      </details>}
    </div>
  );
}
