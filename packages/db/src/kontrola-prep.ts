/**
 * „🤖 Подготви приговор со AI“ and „📦 Пакет за приговор“ of an inspection case (services; the worker jobs
 * `kontrola.prepare` / `kontrola.pkg` and the web actions call them):
 *
 *  - `kontrolaLawTexts`   the stored article texts for the AI context (`law_texts` / `law_articles`): the articles cited
 *                         in the act and the findings, the full-text matches of the disputed findings and the procedural
 *                         articles of the remedy — each in the version valid on the date of the audited period (substantive
 *                         law) or of the act (procedure); plus which procedural laws have no stored text;
 *  - `proposeKontrolaMarks` the program's оспори / делумно / прифати proposal for the unmarked findings (the person
 *                         changes it with the usual buttons);
 *  - `attachmentPrint`    the data of an attachment print (VAT books, kartica, ДДВ-04, payroll) for the server PDF;
 *  - the state of both background steps in `kontroli.data` (`prep`, `pkg`).
 * Free: no model call here.
 */
import { and, asc, between, eq, inArray, sql } from 'drizzle-orm';
import {
  docHtml, fmtCents, isFindingArea, kontrolaLawPlan, LAW_CODE_KEY, LAW_KEY_CODE, recommendFinding, textHash, textHtml, toCents,
  type AttachmentPrint, type CaseInput, type KontrolaLawText, type SubmissionType,
} from '@wise/core/compliance';
import { versionAt, versionFrom } from '@wise/core/law';
import { randomUUID } from 'node:crypto';
import { audit, type Tx } from './audit';
import { findingEvidence, kontrolaDocs, kontrolaTexts, queueKontrolaAi, type AttachmentRender, type KontrolaCase } from './compliance';
import { lawArticleVersions, lawVersions, searchLawArticles, type LawVersion } from './law-search';
import { OfficeError } from './office';
import {
  invoices, journalLines, journals, kontrolaFindings, kontroli, lawTexts, partners, payrollRuns, purchases, vatPeriods, type Kontrola,
} from './schema/index';

const dmy = (d: string) => d.slice(0, 10).split('-').reverse().join('.');

/* ====================================================================================================== */
/* Law texts for the AI context                                                                            */
/* ====================================================================================================== */

const MAX_TEXTS = 30;
const vLite = (v: LawVersion) => ({ ...v, fetchedAt: v.fetchedAt.toISOString() });

/**
 * The stored article texts a case needs, each in the version valid on its date (`lawArticleVersions` + `versionAt`);
 * when no stored version applied on that date, the oldest stored version is used and marked `later` („да се провери“).
 */
export async function kontrolaLawTexts(tx: Tx, x: CaseInput): Promise<{ texts: KontrolaLawText[]; proc: { code: string; present: boolean }[] }> {
  const plan = kontrolaLawPlan(x);
  const out = new Map<string, KontrolaLawText>();
  const LV = new Map<string, LawVersion[]>();
  const versionsOf = async (key: string) => LV.get(key) ?? LV.set(key, await lawVersions(tx, key)).get(key)!;

  for (const r of plan.refs.slice(0, 25)) {
    const key = LAW_CODE_KEY[r.law];
    if (!key || out.has(`${r.law}:${r.art}`)) continue;
    const H = await lawArticleVersions(tx, key, r.art);
    if (!H.length) continue;
    const V = await versionsOf(key);
    const at = versionAt(V.map(vLite), r.date);
    const hit = (at && H.find((h) => h.textId === at.id)) ?? null;
    const use = hit ?? H[0]!;
    const v = V.find((x) => x.id === use.textId)!;
    out.set(`${r.law}:${r.art}`, {
      law: r.law, no: use.no, para: r.para ?? null, heading: use.heading, body: use.body, from: versionFrom(vLite(v)), at: r.date, later: !hit,
      sourceUrl: use.sourceUrl, via: plan.proc.includes(r.law) ? 'proc' : 'cited',
    });
  }
  for (const q of plan.queries) {
    if (out.size >= MAX_TEXTS) break;
    const keys = q.laws.map((c) => LAW_CODE_KEY[c]!).filter(Boolean);
    let H = await searchLawArticles(tx, q.q, { laws: keys, date: q.date, limit: q.proc ? 6 : 4 });
    let later = false;
    if (!H.length) { H = await searchLawArticles(tx, q.q, { laws: keys, limit: q.proc ? 6 : 4 }); later = true; }
    for (const h of H) {
      const code = LAW_KEY_CODE[h.law];
      if (!code || out.has(`${code}:${h.no}`) || out.size >= MAX_TEXTS) continue;
      const from = h.effectiveFrom ?? h.asOf ?? '';
      out.set(`${code}:${h.no}`, { law: code, no: h.no, heading: h.heading, body: h.body, from, at: q.date, later: later && (!from || from > q.date), sourceUrl: h.sourceUrl, via: q.proc ? 'proc' : 'search' });
    }
  }
  const pk = plan.proc.map((c) => LAW_CODE_KEY[c]).filter((k): k is string => !!k);
  const stored = pk.length ? new Set((await tx.selectDistinct({ law: lawTexts.law }).from(lawTexts).where(inArray(lawTexts.law, pk))).map((r) => r.law)) : new Set<string>();
  return { texts: [...out.values()], proc: plan.proc.map((code) => ({ code, present: !!LAW_CODE_KEY[code] && stored.has(LAW_CODE_KEY[code]!) })) };
}

/* ====================================================================================================== */
/* Proposed marks                                                                                          */
/* ====================================================================================================== */

export interface ProposedMark { no: number; rec: 'object' | 'partial' | 'accept'; why: string }

/**
 * For every finding the office has not marked: the amount from the books (when the program can compute it and none is
 * entered) and the program's recommendation as the mark; a finding without enough facts is proposed „оспори“ (the
 * person asked for the objection — the mark stays „за проверка“ in the internal analysis). Marked findings are kept.
 */
export async function proposeKontrolaMarks(tx: Tx, firmId: string, kid: string, userId: string | null): Promise<ProposedMark[]> {
  const [k] = await tx.select().from(kontroli).where(and(eq(kontroli.id, kid), eq(kontroli.firmId, firmId))).limit(1);
  if (!k) throw new OfficeError('Контролата не е пронајдена.');
  const F = await tx.select().from(kontrolaFindings).where(eq(kontrolaFindings.kontrolaId, kid)).orderBy(asc(kontrolaFindings.no));
  const out: ProposedMark[] = [];
  for (const f of F) {
    if (f.recommendation) continue;
    let ours = f.ours, src = f.oursSource;
    if (ours == null) {
      const ev = await findingEvidence(tx, firmId, k, f);
      if (ev.recalc) { ours = (ev.recalc.cents / 100).toFixed(2); src = ev.recalc.source; }
    }
    const r = recommendFinding({
      no: f.no, area: isFindingArea(f.area) ? f.area : 'other', text: f.text, claimed: toCents(f.claimed), interest: toCents(f.interest), fine: toCents(f.fine),
      ours: ours == null ? null : toCents(ours), verdict: (f.verdict as never) ?? null, officeOk: f.officeOk, systemError: f.systemError,
    });
    const rec = r === 'review' ? 'object' : r;
    const why = r === 'review' ? 'нема доволно факти – предлог за оспорување, проверете' : ours != null && ours !== f.ours ? `износ од книгите ${fmtCents(toCents(ours))} ден.` : 'препорака на програмата';
    await tx.update(kontrolaFindings).set({ recommendation: rec, ...(ours !== f.ours ? { ours, oursSource: src } : {}) }).where(eq(kontrolaFindings.id, f.id));
    out.push({ no: f.no, rec, why });
  }
  if (out.length) await audit(tx, { userId, firmId, action: 'kontrolaAutoMark', entityType: 'kontrola', entityId: kid, data: { marks: out } });
  return out;
}

/* ====================================================================================================== */
/* Background steps: „🤖 Подготви приговор со AI“ (`data.prep`) and „📦 Пакет за приговор“ (`data.pkg`)       */
/* ====================================================================================================== */

export interface KontrolaPrepStep { t: string; ok: boolean; at: string }
export interface KontrolaPrepState {
  status: 'queued' | 'running' | 'done' | 'error';
  reqId: string; at: string; deep?: boolean; by?: string | null;
  steps: KontrolaPrepStep[];
  marks?: ProposedMark[];
  versionId?: string; model?: string; costUsd?: number; error?: string;
}
export const kontrolaPrepState = (k: Pick<Kontrola, 'data'>): KontrolaPrepState | null => ((k.data ?? {}) as { prep?: KontrolaPrepState }).prep ?? null;

export interface KontrolaPkgState {
  status: 'queued' | 'done' | 'error';
  reqId: string; at: string; by?: string | null; error?: string;
  /** PDF of the submission and the hash of the text it was rendered from (a changed text → the PDF is stale). */
  doc?: string | null; hash?: string | null; type?: string | null;
  /** Rendered prints per attachment key (`files.id`). */
  rendered?: Record<string, string[]>;
}
export const kontrolaPkgState = (k: Pick<Kontrola, 'data'>): KontrolaPkgState | null => ((k.data ?? {}) as { pkg?: KontrolaPkgState }).pkg ?? null;

async function patch(tx: Tx, firmId: string, kid: string, fn: (d: Record<string, unknown>) => Record<string, unknown> | null): Promise<boolean> {
  const [k] = await tx.select({ data: kontroli.data }).from(kontroli).where(and(eq(kontroli.id, kid), eq(kontroli.firmId, firmId))).for('update').limit(1);
  if (!k) throw new OfficeError('Контролата не е пронајдена.');
  const next = fn({ ...(k.data ?? {}) });
  if (!next) return false;
  await tx.update(kontroli).set({ data: next }).where(eq(kontroli.id, kid));
  return true;
}

/**
 * Start „🤖 Подготви приговор со AI“: the case's AI state is queued with the same request id (the analysis step of the
 * job is the „💲 AI правна анализа“). The caller checks the owner and the AI budget, then enqueues `kontrola.prepare`.
 */
export async function queueKontrolaPrep(tx: Tx, firmId: string, kid: string, deep: boolean, userId: string | null): Promise<string> {
  const reqId = await queueKontrolaAi(tx, firmId, kid, deep, userId);
  const at = new Date().toISOString();
  await patch(tx, firmId, kid, (d) => ({ ...d, prep: { status: 'queued', reqId, at, deep, by: userId, steps: [] } satisfies KontrolaPrepState }));
  await audit(tx, { userId, firmId, action: 'kontrolaPrepStart', entityType: 'kontrola', entityId: kid, data: { reqId, deep } });
  return reqId;
}

/** Progress of the job (`step` appended; `fin` sets the final state). Ignored when a newer request replaced this one. */
export async function updateKontrolaPrep(tx: Tx, firmId: string, kid: string, reqId: string, p: { step?: string; ok?: boolean; fin?: Partial<KontrolaPrepState> }): Promise<boolean> {
  return patch(tx, firmId, kid, (d) => {
    const cur = (d.prep ?? null) as KontrolaPrepState | null;
    if (!cur || cur.reqId !== reqId) return null;
    const at = new Date().toISOString();
    const steps = p.step ? [...cur.steps, { t: p.step, ok: p.ok !== false, at }] : cur.steps;
    return { ...d, prep: { ...cur, status: 'running', ...p.fin, steps } satisfies KontrolaPrepState };
  });
}

/** Start „📦 Пакет за приговор“ (the caller enqueues `kontrola.pkg`). */
export async function queueKontrolaPkg(tx: Tx, firmId: string, kid: string, userId: string | null): Promise<string> {
  const reqId = randomUUID();
  await patch(tx, firmId, kid, (d) => {
    const cur = (d.pkg ?? null) as KontrolaPkgState | null;
    if (cur?.status === 'queued' && Date.now() - Date.parse(cur.at) < 10 * 60_000) throw new OfficeError('Пакетот веќе се подготвува – почекајте.');
    return { ...d, pkg: { status: 'queued', reqId, at: new Date().toISOString(), by: userId } satisfies KontrolaPkgState };
  });
  await audit(tx, { userId, firmId, action: 'kontrolaPkgStart', entityType: 'kontrola', entityId: kid, data: { reqId } });
  return reqId;
}

export async function finishKontrolaPkg(tx: Tx, firmId: string, kid: string, reqId: string, p: Partial<KontrolaPkgState>): Promise<boolean> {
  return patch(tx, firmId, kid, (d) => {
    const cur = (d.pkg ?? null) as KontrolaPkgState | null;
    if (!cur || cur.reqId !== reqId) return null;
    return { ...d, pkg: { ...cur, ...p, at: new Date().toISOString() } };
  });
}

/**
 * The submission's current text as HTML (the office's saved / accepted text, else the generated one), its type and a
 * hash — the package PDF is rendered from it; the ZIP route compares the hash (a changed text → the PDF is stale).
 */
export function kontrolaSubmissionHtml(c: KontrolaCase): { html: string; hash: string; type: SubmissionType } {
  const saved = kontrolaTexts(c.k).draft;
  const D = kontrolaDocs(c);
  const html = saved ? textHtml(saved) : docHtml(D.external);
  return { html, hash: textHash(html), type: D.external.choice.type };
}

/* ====================================================================================================== */
/* Attachment prints                                                                                       */
/* ====================================================================================================== */

const n2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;

/** The data of a print attachment (null when the source is gone). Invoices are printed with the invoice template, not here. */
export async function attachmentPrint(tx: Tx, firmId: string, r: AttachmentRender): Promise<AttachmentPrint | null> {
  if (r.t === 'vatBook' && r.book === 'out') {
    const I = await tx.select({ number: invoices.number, date: invoices.date, kind: invoices.kind, base: invoices.base, vat: invoices.vat, total: invoices.total, fx: invoices.fx, pn: partners.name })
      .from(invoices).leftJoin(partners, eq(partners.id, invoices.partnerId))
      .where(and(eq(invoices.firmId, firmId), eq(invoices.status, 'posted'), inArray(invoices.kind, ['invoice', 'credit']), between(invoices.date, r.from, r.to)))
      .orderBy(asc(invoices.date), asc(invoices.number));
    const rows = I.map((i, k) => { const x = Number(i.fx) || 1; return [k + 1, i.number, dmy(i.date), i.kind === 'credit' ? 'Одобрение' : 'Фактура', i.pn ?? '', n2(Number(i.base) * x), n2(Number(i.vat) * x), n2(Number(i.total) * x)]; });
    const s = (c: number) => n2(rows.reduce((a, x) => a + Number(x[c]), 0));
    return { title: 'Книга на излезни фактури (ДДВ)', sub: `Период ${dmy(r.from)} – ${dmy(r.to)}`, head: ['Р.бр.', 'Број', 'Датум', 'Вид', 'Купувач', 'Основица', 'ДДВ', 'Вкупно'], rows, num: [5, 6, 7], foot: ['', '', '', '', 'Вкупно', s(5), s(6), s(7)], note: 'Извод од програмата WISE (прокнижени документи).' };
  }
  if (r.t === 'vatBook') {
    const P = await tx.select({ number: purchases.number, date: purchases.date, base: purchases.base, vat: purchases.vat, total: purchases.total, cash: purchases.cash, art32: purchases.art32, noDed: purchases.noDed, imp: purchases.imp, pn: partners.name })
      .from(purchases).leftJoin(partners, eq(partners.id, purchases.partnerId))
      .where(and(eq(purchases.firmId, firmId), eq(purchases.status, 'posted'), between(purchases.date, r.from, r.to))).orderBy(asc(purchases.date), asc(purchases.number));
    const rows = P.map((p, k) => [k + 1, p.number, dmy(p.date), p.pn ?? '', n2(p.base), n2(p.vat), n2(p.total), [p.cash ? 'готовина' : '', p.art32 ? 'чл. 32-а' : '', p.noDed ? 'без одбивка' : '', p.imp ? 'увоз' : ''].filter(Boolean).join(', ')]);
    const s = (c: number) => n2(rows.reduce((a, x) => a + Number(x[c]), 0));
    return { title: 'Книга на влезни фактури (ДДВ)', sub: `Период ${dmy(r.from)} – ${dmy(r.to)}`, head: ['Р.бр.', 'Број', 'Датум', 'Добавувач', 'Основица', 'ДДВ', 'Вкупно', 'Напомена'], rows, num: [4, 5, 6], foot: ['', '', '', 'Вкупно', s(4), s(5), s(6), ''], note: 'Извод од програмата WISE (прокнижени документи).' };
  }
  if (r.t === 'kartica') {
    const L = await tx.select({ date: journals.date, number: journals.number, kind: journals.kind, desc: journals.description, note: journalLines.note, account: journalLines.account, d: journalLines.debit, c: journalLines.credit })
      .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
      .where(and(eq(journalLines.firmId, firmId), sql`${journalLines.account} like ${`${r.account}%`}`, between(journals.date, r.from, r.to)))
      .orderBy(asc(journals.date), asc(journals.number), asc(journalLines.lineNo));
    let s = 0;
    const rows = L.map((l) => { s = n2(s + Number(l.d) - Number(l.c)); return [dmy(l.date), l.number, l.account, l.note || l.desc || '', n2(l.d), n2(l.c), s]; });
    const D = n2(L.reduce((a, l) => a + Number(l.d), 0)), C = n2(L.reduce((a, l) => a + Number(l.c), 0));
    return { title: `Картица на конто ${r.account}`, sub: `Период ${dmy(r.from)} – ${dmy(r.to)}`, head: ['Датум', 'Налог', 'Конто', 'Опис', 'Должи', 'Побарува', 'Салдо'], rows, num: [4, 5, 6], foot: ['', '', '', 'Вкупно', D, C, n2(D - C)], note: 'Извод од главната книга (програма WISE).' };
  }
  if (r.t === 'ddv04') {
    const [v] = await tx.select().from(vatPeriods).where(and(eq(vatPeriods.id, r.id), eq(vatPeriods.firmId, firmId))).limit(1);
    if (!v?.ddv04) return null;
    const rows = Object.entries(v.ddv04.fields).sort(([a], [b]) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b)).map(([k, x]) => [k, n2(x)]);
    return {
      title: `ДДВ-04 за ${v.period}`, sub: `Период ${dmy(v.dateFrom)} – ${dmy(v.dateTo)}${v.submittedAt ? ` · поднесена ${dmy(v.submittedAt.toISOString())}` : ''}`,
      head: ['Поле', 'Износ'], rows, num: [1], foot: ['Обврска (+) / побарување (−)', n2(v.ddv04.closeDiff)], note: `Пресметка од програмата (${v.ddv04.origin}).`,
    };
  }
  if (r.t === 'payroll') {
    const [p] = await tx.select().from(payrollRuns).where(and(eq(payrollRuns.id, r.id), eq(payrollRuns.firmId, firmId))).limit(1);
    if (!p) return null;
    const t = p.totals ?? {};
    return {
      title: `Пресметка на плата за ${p.month.slice(5, 7)}/${p.month.slice(0, 4)}`, sub: `Датум на книжење ${dmy(p.date)} · ${p.status === 'posted' ? 'прокнижена' : 'непрокнижена'}`,
      head: ['Ставка', 'Износ'], num: [1],
      rows: [['Број на вработени', String(t.emps ?? 0)], ['Бруто плати', n2(t.gross)], ['Придонеси', n2(t.contr)], ['Персонален данок', n2(t.tax)], ['Нето плати', n2(t.net)]],
      note: 'Збирни износи од пресметката (без лични податоци на вработените).',
    };
  }
  return null;
}

