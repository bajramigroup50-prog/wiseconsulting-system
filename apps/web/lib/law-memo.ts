/**
 * ⚖ Правен асистент — a saved case as an internal memo (the print / PDF view and the Word export use the same HTML).
 * Pure: the case row and names in, escaped HTML out.
 */
import { citeLabel, factLines, LAW_CASE_KIND, lawAbbr, type DiffSeg, type LawAnswer, type LawChangeCtx, type LawFacts, type LawTable } from '@wise/core/law';

export interface CaseArticle { id: string; textId: string; law: string; no: string; heading: string | null; body: string; asOf: string | null; effectiveFrom?: string | null; sourceUrl: string | null; title: string; via?: string }
export interface CaseResult {
  date?: string;
  articles?: CaseArticle[];
  facts?: LawFacts;
  table?: LawTable;
  diff?: DiffSeg[];
  versions?: { textId: string; title: string; asOf: string | null; effectiveFrom: string | null; sourceUrl: string | null }[];
  applies?: string | null;
  single?: boolean;
  missing?: string[];
  changes?: LawChangeCtx[];
  ai?: LawAnswer;
  guard?: { removed: string[]; fixed: string[]; stray: string[] };
  aiError?: string;
}

export interface MemoCase {
  id: string; kind: string; question: string; periodFrom: string | null; periodTo: string | null; byName: string | null; model: string | null; costUsd: string;
  createdAt: Date; result: Record<string, unknown>; params: Record<string, unknown>;
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const d = (s: string | null | undefined) => (s ? s.slice(0, 10).split('-').reverse().join('.') : '—');
const br = (s: string) => esc(s).replace(/\n/g, '<br>');

/** Article label with its version („ЗДДВ чл. 14 (верзија 30.12.2025)“). */
export const artTitle = (a: Pick<CaseArticle, 'law' | 'no' | 'heading' | 'asOf' | 'effectiveFrom'>) =>
  `${lawAbbr(a.law)} чл. ${a.no}${a.heading ? ' – ' + a.heading : ''} (верзија ${d(a.asOf)}${a.effectiveFrom ? ', важи од ' + d(a.effectiveFrom) : ''})`;

function tableHtml(T: LawTable, word: boolean): string {
  if (word) return T.rows.map((r) => `<p>${r.map((c, i) => `<b>${esc(T.cols[i] ?? '')}:</b> ${esc(c)}`).join(' · ')}</p>`).join('');
  return `<table class="dense" style="width:100%"><thead><tr>${T.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${T.rows.map((r) => `<tr>${r.map((c) => `<td style="vertical-align:top;white-space:pre-wrap">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

/**
 * The memo: header (office, firm, date, who asked, model, cost), the question, the answer with the citations quoted
 * from the store, the comparison table, verification items, the articles used with their versions and sources, the
 * firm's facts, and the disclaimer.
 */
export function lawMemoHtml(c: MemoCase, o: { office: string; firm: string | null; word?: boolean }): string {
  const R = c.result as CaseResult;
  const A = R.ai;
  const sq = A?.lang === 'sq';
  const h = (t: string) => `<h3 style="font-size:13px;margin:12px 0 4px">${esc(t)}</h3>`;
  const out: string[] = [];
  out.push(`<p style="text-align:center"><b>${esc(o.office || 'Сметководствена канцеларија')}</b></p>`);
  out.push(`<h2 style="text-align:center;font-size:16px;margin:6px 0">ИНТЕРНА БЕЛЕШКА – ПРАВНА АНАЛИЗА</h2>`);
  out.push(`<p style="text-align:center">${esc(LAW_CASE_KIND[c.kind as keyof typeof LAW_CASE_KIND] ?? c.kind)} · бр. ${esc(c.id.slice(0, 8))}</p>`);
  out.push(`<p>Фирма: <b>${esc(o.firm ?? '— (општо прашање)')}</b>${c.periodFrom ? ` · Период: ${d(c.periodFrom)} – ${d(c.periodTo)}` : ''}${R.date ? ` · Закон во верзија на ден: ${d(R.date)}` : ''}</p>`);
  out.push(`<p>Датум: ${d(c.createdAt.toISOString())} · Прашал: ${esc(c.byName ?? '—')}${c.model ? ` · Модел: ${esc(c.model)}` : ' · без AI'}${Number(c.costUsd) > 0 ? ` · Трошок: $${Number(c.costUsd).toFixed(4)}` : ''}</p>`);
  out.push(h('Прашање'), `<p>${br(c.question)}</p>`);
  if (A) {
    out.push(h(sq ? 'Përgjigje e shkurtër' : 'Краток одговор'), `<p>${br(A.short)}</p>`);
    if (A.reasoning.length) {
      out.push(h(sq ? 'Arsyetimi ligjor' : 'Правно образложение'));
      for (const r of A.reasoning) {
        out.push(`<p>${br(r.text)}</p>`);
        for (const x of r.cites) out.push(`<p style="margin-left:18px"><b>${esc(citeLabel(x))}:</b> „${esc(x.quote ?? '')}“</p>`);
      }
    }
    if (A.exceptions.length) out.push(h(sq ? 'Përjashtime' : 'Исклучоци'), ...A.exceptions.map((x) => `<p>• ${br(x)}</p>`));
    if (A.evidence.length) out.push(h(sq ? 'Dokumente / dëshmi të nevojshme' : 'Потребни документи / докази'), ...A.evidence.map((x) => `<p>• ${br(x)}</p>`));
  }
  if (R.versions?.length) {
    out.push(h('Верзии на членот'));
    R.versions.forEach((v, i) => out.push(`<p>${i ? 'Б' : 'А'}) ${esc(v.title)} – верзија ${d(v.asOf)}${v.effectiveFrom ? `, важи од ${d(v.effectiveFrom)}` : ''}${R.applies === v.textId ? ' <b>← се применува на ' + d(R.date) + '</b>' : ''}${v.sourceUrl ? ` · ${esc(v.sourceUrl)}` : ''}</p>`));
    if (R.single) out.push('<p>Во базата има само една верзија на овој член – нема со што да се спореди.</p>');
    if (!R.applies) out.push(`<p><b>Треба да се провери:</b> во базата нема верзија што важи на ${d(R.date)}.</p>`);
  }
  const T = A?.table ?? R.table;
  if (T && T.rows.length) out.push(h(A?.table ? (sq ? 'Krahasim' : 'Споредба') : 'Споредба (без AI)'), tableHtml(T, !!o.word));
  if (A?.table && R.table?.rows.length) out.push(h('Споредба од книгите / базата (без AI)'), tableHtml(R.table, !!o.word));
  if (A?.conclusion) out.push(h(sq ? 'Përfundim' : 'Заклучок'), `<p>${br(A.conclusion)}</p>`);
  const verify = [...(A?.verify ?? []), ...(R.missing ?? []).map((l) => `треба да се провери: ${lawAbbr(l)} – нема зачуван текст во базата.`)];
  if (!A && !(R.articles ?? []).length) verify.push('треба да се провери: во базата нема пронајдени членови за ова прашање.');
  if (verify.length) out.push(h(sq ? 'Duhet të verifikohet' : 'Треба да се провери'), ...verify.map((x) => `<p>• ${br(x)}</p>`));
  if (R.aiError) out.push(`<p><i>AI: ${esc(R.aiError)}</i></p>`);
  if (R.guard && (R.guard.removed.length || R.guard.fixed.length)) out.push(`<p><i>Проверка на цитати: отстранети ${R.guard.removed.length} (ги нема во базата), поправени цитати ${R.guard.fixed.length} (заменети со зачуваниот текст).</i></p>`);
  if (R.facts) out.push(h('Факти од книгите (збирно)'), ...factLines(R.facts).map((x) => `<p>${br(x)}</p>`));
  if (R.articles?.length) {
    out.push(h('Користени членови (од базата на синхронизирани закони)'));
    for (const a of R.articles) out.push(`<p><b>${esc(artTitle(a))}</b>${a.sourceUrl ? ` · извор: ${esc(a.sourceUrl)}` : ''}</p>`, `<p style="margin-left:18px;font-size:11px">${br(a.body.length > 1500 ? a.body.slice(0, 1500) + ' …' : a.body)}</p>`);
  }
  if (R.changes?.length) out.push(h('Поврзани законски промени (робот)'), ...R.changes.map((x) => `<p>• ${d(x.date)} ${esc(x.title)}${x.from ? ` · важи од ${d(x.from)}` : ''}${x.to ? ` до ${d(x.to)}` : ''}${x.urls[0] ? ` · ${esc(x.urls[0])}` : ''}</p>`));
  out.push(`<p style="margin-top:14px;font-size:11px"><i>Интерна белешка на канцеларијата. Цитатите се преземени од зачуваните текстови на законите (наведена е верзијата и изворот). Ова не е правен совет – пред одлука проверете го важечкиот текст во Службен весник.</i></p>`);
  return out.join('\n');
}
