/**
 * Journal import from the old program (Excel / CSV / „Финансов налог“ PDF → `@wise/core/journal-import` rows):
 * preview, commit and removal of one import batch. Runs in the caller's transaction; the commit posts every journal
 * of the batch in that one transaction (all or nothing) with one audit row for the batch.
 *
 * - Partners: by code, then ЕДБ (or ЕМБС), then the exact name, then the normalised name. Lines on partner kontos
 *   (12x / 22x, `needsPartner`) whose partner is not found are listed; with `createPartners` they are created from
 *   the file (name, code, ЕДБ) — never imported without a partner.
 * - Kontos: not in the firm's chart, or a synthetic (1–3 digits with analytics under it) → listed, nothing imported.
 * - Periods: the firm's locked period and dates outside the working year are refused.
 * - The original nalog number and type are kept (`jiNumber`, „06/9“; a number WISE already uses gets „У“); every
 *   journal has `sourceType 'import'`, `sourceId '<batch>:<n>'` and `meta.imp` (batch, file, hash, rows of the file,
 *   original type / number), so a batch is found and removed together („🗑 Избриши го увозот“).
 * - Duplicates: a journal with the same type + number + date + total already imported is skipped; the same file
 *   (hash) is reported. Re-running the same file adds nothing.
 * - Preview: per month (nalozi, lines, Σ debit, Σ credit), problems, and the trial balance (existing books of the year
 *   up to the last date of the file + the import) to compare with the old program before confirming.
 */
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { normalizeName } from '@wise/core';
import { obBankRows } from '@wise/core/finpar-ob';
import { jiGroup, jiInvoices, jiIsOpening, jiMonths, jiNumber, jiRows, jiSynthetic, needsPartner, type JiIn, type JiInvoice, type JiJournal, type JiMonth, type JiRow } from '@wise/core/journal-import';
import { findPartnerMatch, type MatchablePartnerRow } from '@wise/core/partners/match';
import { audit, type Tx } from './audit';
import { missingAccounts, PostingError, postJournal, removeJournals } from './posting';
import { saveBankAccount } from './bank/lines';
import { bankAccounts, invoices } from './schema/index';
import { saveInvoice } from './sales/invoices';
import { nextNumericCode } from './sales/partners-auto';
import { accounts, firms, journalLines, journals, partners } from './schema/index';

export class JournalImportError extends Error {}

export interface JiInput {
  file: string;
  /** SHA-256 of the file (hex), computed by the screen */
  hash: string;
  /** working year: dates outside it are refused */
  year: number;
  rows: readonly JiIn[];
  /** create the partners of the file that are not found (name, code, ЕДБ from the file) */
  createPartners?: boolean;
  /** leave the opening-balance rows (01.01, „ПОЧЕТНА СОСТОЈБА“ / nalog 0) out even when the firm has no opening yet */
  skipOpening?: boolean;
  /**
   * `journal` (default): the lines as they are („Увези како налог“); `invoices`: every clean invoice group (120 = 2300 + 7)
   * becomes an outgoing invoice of WISE („Увези како излезни фактури“), the rest stays journal lines
   */
  mode?: 'journal' | 'invoices';
  /** nalog type / number for the rows without one (a file that is one nalog: default from the file name) */
  nalog?: { type?: string; no?: string };
}

export type JiMatchBy = 'code' | 'edb' | 'name' | 'norm' | 'translit';

export type JiProblemKind = 'row' | 'konto' | 'synthetic' | 'partner' | 'nopartner' | 'period' | 'year' | 'unbalanced';
export interface JiProblem { kind: JiProblemKind; msg: string; rows: number[] }
/**
 * Does the problem block the import? A synthetic konto is only listed (the old program booked on it, the books must
 * equal its trial balance); missing partners do not block when they are created from the file.
 */
export const jiBlocks = (p: Pick<JiProblem, 'kind'>, createPartners?: boolean): boolean => p.kind !== 'synthetic' && !(p.kind === 'partner' && createPartners);
export interface JiMissingPartner {
  key: string; name: string; code: string; edb: string; rows: number[]; kontos: string[];
  /** similar partners of WISE that were not taken automatically (check before creating a new one) */
  maybe?: string[];
}
export interface JiTbRow { k: string; name: string; d: number; p: number; s: number }
export interface JiPreview {
  file: string;
  rows: number; skipped: number;
  nalogs: number; journals: number; lines: number; D: number; P: number;
  months: (Omit<JiMonth, 'D' | 'P'> & { D: number; P: number; problems: number })[];
  problems: JiProblem[];
  missingPartners: JiMissingPartner[];
  /** journals already imported (type + number + date + total): skipped */
  duplicates: { label: string; date: string; total: number; file: string }[];
  /** the same file was already imported */
  sameFile: { batch: string; file: string; at: string } | null;
  warnings: string[];
  /** trial balance after the import, from the start of the year up to `tbTo` */
  tb: JiTbRow[]; tbTo: string | null; tbTotal: { d: number; p: number };
  /** first nalozi of the file (for the preview table) */
  list: { label: string; number: string | null; date: string; lines: number; total: number; dup: boolean }[];
  /**
   * the old program's opening balance in the file (01.01, „ПОЧЕТНА СОСТОЈБА“ / nalog 0): `exists` = the firm already has
   * one → skipped; otherwise it is imported as WISE's „Почетна состојба“ (nalog 0) unless `skipOpening`
   */
  opening: { rows: number; D: number; P: number; exists: boolean; skip: boolean } | null;
  /** partners found, per method (distinct partners) */
  matchedBy: Record<JiMatchBy, number>;
  /** mode `invoices`: clean invoice groups, their total, the groups that do not reproduce exactly, the ones already in WISE */
  invoices: { n: number; total: number; /** with the VAT rounded by the old program (the file's VAT is kept) */ rounded: number; refused: { no: string; rows: number[]; why: string }[]; dups: string[] } | null;
  /** nothing blocks the import (missing partners count only without `createPartners`) */
  ok: boolean;
}

type AJ = JiJournal & { dupOf?: string; invoice?: JiInvoice };
interface Analysis {
  P: JiPreview; J: AJ[]; partnerOf: Map<JiRow, string | null>; missing: JiMissingPartner[];
  /** duplicate key → file, numbers used by WISE's own journals of the year */
  dupOf: Map<string, string>; used: Set<string>;
}

const mk = (c: number) => Math.round(c) / 100;
const dmy = (d: string) => d.split('-').reverse().join('.');

type PRow = MatchablePartnerRow & { code: string | null };
const CYR = /[Ѐ-ӿ]/, LAT = /[A-Za-z]/;

/**
 * Partner matcher: the old program's partner code (Ком.ш.) first, then the shared matching of documents read from
 * outside (`@wise/core/partners/match` `findPartnerMatch`: ЕДБ → ЕМБС → learned name → same name, Latin ↔ Cyrillic and
 * YUSCII included → one clear similar name). `by` for the preview: `name` = the same spelling, `translit` = the same
 * name in the other script, `norm` = a similar name (legal forms, abbreviations, cut-off names).
 */
function partnerMatcher(P: readonly PRow[]) {
  const byCode = new Map<string, string>(), byNum = new Map<string, string>();
  for (const p of P) {
    const c = (p.code ?? '').trim();
    if (c) { byCode.set(c, p.id); if (/^\d+$/.test(c)) byNum.set(String(+c), p.id); }
  }
  return (r: Pick<JiRow, 'pcode' | 'pedb' | 'pname'>): { id: string; by: JiMatchBy } | null => {
    if (r.pcode) {
      const x = byCode.get(r.pcode) ?? (/^\d+$/.test(r.pcode) ? byNum.get(String(+r.pcode)) : undefined);
      if (x) return { id: x, by: 'code' };
    }
    const m = findPartnerMatch(P, { name: r.pname || null, id: r.pedb || null });
    if (!m.partner) return null;
    if (m.by === 'edb' || m.by === 'embs' || m.by === 'bank') return { id: m.partner.id, by: 'edb' };
    if (m.by === 'name') return { id: m.partner.id, by: 'norm' };
    const same = m.partner.name.trim().toLowerCase() === r.pname.trim().toLowerCase();
    const other = (CYR.test(r.pname) && !CYR.test(m.partner.name) && LAT.test(m.partner.name)) || (LAT.test(r.pname) && !CYR.test(r.pname) && CYR.test(m.partner.name));
    return { id: m.partner.id, by: same ? 'name' : other ? 'translit' : 'norm' };
  };
}

/** Up to 3 uncertain candidates for a partner that was not found (shown next to the missing partner). */
const partnerCandidates = (P: readonly PRow[], r: Pick<JiRow, 'pname' | 'pedb'>): string[] =>
  r.pname ? findPartnerMatch(P, { name: r.pname, id: r.pedb || null }).candidates.map((c) => c.name) : [];

const partnerKey = (r: JiRow) => (r.pedb.length >= 7 ? 'e:' + r.pedb : r.pcode ? 'c:' + r.pcode : r.pname ? 'n:' + normalizeName(r.pname) : '');

async function importJournals(tx: Tx, firmId: string, y: number) {
  return tx.select({ id: journals.id, date: journals.date, number: journals.number, meta: journals.meta, sourceId: journals.sourceId, createdAt: journals.createdAt })
    .from(journals).where(and(eq(journals.firmId, firmId), eq(journals.sourceType, 'import'), sql`${journals.date} between ${y + '-01-01'} and ${y + '-12-31'}`));
}

async function analyze(tx: Tx, firmId: string, input: JiInput): Promise<Analysis> {
  const [firm] = await tx.select({ lockDate: firms.lockDate }).from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!firm) throw new JournalImportError('Фирмата не постои.');
  const R0 = jiRows(input.rows, input.nalog);
  const { bad, skipped } = R0;
  const y = String(input.year);
  // the opening balance of the old program: WISE's „Почетна состојба“, never a journal of the year
  const opAll = R0.rows.filter(jiIsOpening);
  let opening: JiPreview['opening'] = null;
  if (opAll.length) {
    const [ex] = await tx.select({ id: journals.id }).from(journals).where(and(eq(journals.firmId, firmId),
      or(eq(journals.sourceType, 'opening'), eq(journals.kind, 'open')), sql`${journals.date} between ${y + '-01-01'} and ${y + '-12-31'}`)).limit(1);
    opening = { rows: opAll.length, D: mk(opAll.reduce((s, r) => s + r.d, 0)), P: mk(opAll.reduce((s, r) => s + r.p, 0)), exists: !!ex, skip: !!ex || !!input.skipOpening };
  }
  const rows = opening?.skip ? R0.rows.filter((r) => !jiIsOpening(r)) : R0.rows;
  const problems: JiProblem[] = [];
  const warnings: string[] = [];
  const add = (kind: JiProblemKind, msg: string, r: number[]) => problems.push({ kind, msg, rows: r });
  for (const b of bad) add('row', `ред ${b.r}: ${b.msg}`, [b.r]);
  if (opening?.exists) warnings.push(`Почетната состојба веќе постои – прескокнато (за промена користете Почетна состојба): ${opening.rows} ставки, должи ${opening.D.toFixed(2)} / побарува ${opening.P.toFixed(2)}.`);
  else if (opening?.skip) warnings.push(`Почетната состојба од датотеката (${opening.rows} ставки) е изоставена.`);
  else if (opening) warnings.push(`${opening.rows} ставки на 01.01 се почетна состојба – ќе се внесат како „Почетна состојба“ (налог 0), не како налог на годината.`);

  // kontos: in the chart, analytic where the chart has analytics
  const codes = [...new Set(rows.map((r) => r.k))];
  const miss = new Set(await missingAccounts(tx, firmId, codes));
  const chart = await tx.select({ code: accounts.code, firmId: accounts.firmId, hidden: accounts.hidden, name: accounts.name })
    .from(accounts).where(or(isNull(accounts.firmId), eq(accounts.firmId, firmId)));
  const nameOf = new Map<string, string>();
  for (const a of chart) if (!a.hidden && (a.firmId || !nameOf.has(a.code))) nameOf.set(a.code, a.name);
  const chartSet = new Set(nameOf.keys());
  for (const k of codes) {
    const R = rows.filter((r) => r.k === k).map((r) => r.r);
    if (miss.has(k)) add('konto', `Контото ${k} не постои во контниот план (${R.length} ставки, ред ${R.slice(0, 5).join(', ')}${R.length > 5 ? '…' : ''}) – додајте го во Контен план или поправете ја датотеката.`, R);
    else if (jiSynthetic(k, chartSet)) add('synthetic', `Контото ${k} е синтетичко (во контниот план има аналитички конта под него) – проверете дали треба аналитичко; се книжи како во датотеката (${R.length} ставки, ред ${R.slice(0, 5).join(', ')}${R.length > 5 ? '…' : ''}).`, R);
  }

  // partners
  const P = await tx.select({ id: partners.id, code: partners.code, name: partners.name, edb: partners.edb, embs: partners.embs, bankAccount: partners.bankAccount, data: partners.data }).from(partners).where(eq(partners.firmId, firmId));
  const match = partnerMatcher(P);
  const partnerOf = new Map<JiRow, string | null>();
  const by: Record<JiMatchBy, Set<string>> = { code: new Set(), edb: new Set(), name: new Set(), norm: new Set(), translit: new Set() };
  const missing = new Map<string, JiMissingPartner>();
  const noPartner: number[] = [];
  for (const r of rows) {
    const m0 = r.pcode || r.pedb || r.pname ? match(r) : null;
    const id = m0?.id ?? null;
    if (m0) by[m0.by].add(m0.id);
    partnerOf.set(r, id);
    if (id || !needsPartner(r.k)) continue;
    const key = partnerKey(r);
    if (!key) { if (!jiIsOpening(r)) noPartner.push(r.r); continue; } // the opening may keep 12x / 22x without a partner
    const m = missing.get(key) ?? { key, name: r.pname, code: r.pcode, edb: r.pedb, rows: [], kontos: [], maybe: partnerCandidates(P, r) };
    m.rows.push(r.r);
    if (!m.name && r.pname) m.name = r.pname;
    if (!m.code && r.pcode) m.code = r.pcode;
    if (!m.edb && r.pedb) m.edb = r.pedb;
    if (!m.kontos.includes(r.k)) m.kontos.push(r.k);
    missing.set(key, m);
  }
  if (noPartner.length) add('nopartner', `${noPartner.length} ставки на конто за комитенти (12x / 22x) немаат комитент во датотеката (ред ${noPartner.slice(0, 8).join(', ')}${noPartner.length > 8 ? '…' : ''}) – дополнете шифра, ЕДБ или назив.`, noPartner);
  const M = [...missing.values()];
  if (M.length && !input.createPartners) {
    for (const m of M) add('partner', `Комитентот „${m.name || '—'}“${m.code ? ` (шифра ${m.code})` : ''}${m.edb ? ` (ЕДБ ${m.edb})` : ''} не е најден – ${m.rows.length} ставки на ${m.kontos.join(', ')} (ред ${m.rows.slice(0, 5).join(', ')}${m.rows.length > 5 ? '…' : ''}).`, m.rows);
  }

  // nalozi
  const body = rows.filter((r) => !jiIsOpening(r));
  let invs: JiInvoice[] = [], invRefused: { no: string; rows: number[]; why: string }[] = [], jRows = body;
  if (input.mode === 'invoices') {
    const X = jiInvoices(body); invs = X.inv; invRefused = X.refused; jRows = X.rest;
    if (invs.length) warnings.push(`${invs.length} групи ќе станат излезни фактури (ДДВ книги, отворени ставки). WISE на фактурите книжи и статистичка евиденција на основицата за ДДВ (994… / 999…, должи = побарува) – ја нема во овој налог од старата програма; ако ја увезувате и посебно, ќе биде двојна.`);
    if (invRefused.length) warnings.push(`${invRefused.length} групи не може точно да се добијат како фактури – се увезуваат како ставки на налогот (види ја листата).`);
  }
  const G = jiGroup(jRows);
  const opRows = rows.filter(jiIsOpening);
  let opJ: (JiJournal & { dupOf?: string }) | null = null;
  if (opRows.length) {
    const D = opRows.reduce((s, r) => s + r.d, 0), P = opRows.reduce((s, r) => s + r.p, 0);
    if (D !== P) add('unbalanced', `Почетната состојба не е во рамнотежа: должи ${mk(D).toFixed(2)} ≠ побарува ${mk(P).toFixed(2)}.`, opRows.map((r) => r.r));
    else opJ = { key: 'opening', label: 'Почетна состојба', type: opRows[0]!.type, no: opRows[0]!.no, number: null, date: opRows[0]!.date, rows: opRows, D, P, dup: 'opening', opening: true };
  }
  for (const u of G.unbalanced) add('unbalanced', `Налогот ${u.label} не е во рамнотежа: должи ${mk(u.D).toFixed(2)} ≠ побарува ${mk(u.P).toFixed(2)} (ред ${u.rows.slice(0, 5).join(', ')}${u.rows.length > 5 ? '…' : ''}).`, u.rows);
  for (const j of G.journals) if (j.warn) warnings.push(j.warn);

  // duplicates and the numbers WISE already uses
  const prev = await importJournals(tx, firmId, input.year);
  const dupOf = new Map<string, string>();
  let sameFile: JiPreview['sameFile'] = null;
  for (const j of prev) {
    const imp = (j.meta as { imp?: { dup?: string; file?: string; hash?: string; batch?: string } }).imp ?? {};
    if (imp.dup) dupOf.set(imp.dup, imp.file ?? '');
    if (input.hash && imp.hash === input.hash && !sameFile) sameFile = { batch: imp.batch ?? '', file: imp.file ?? '', at: j.createdAt.toISOString() };
  }
  if (sameFile) warnings.push(`Истата датотека е веќе увезена („${sameFile.file}“) – налозите што се веќе внесени се прескокнуваат.`);
  const used = new Set((await tx.select({ n: journals.number }).from(journals)
    .where(and(eq(journals.firmId, firmId), sql`coalesce(${journals.sourceType}, '') <> 'import'`, sql`${journals.date} between ${y + '-01-01'} and ${y + '-12-31'}`))).map((r) => r.n));
  const J: Analysis['J'] = G.journals.map((j) => {
    const number = j.number && used.has(j.number) ? 'У' + j.number : j.number;
    return { ...j, number, ...(dupOf.has(j.dup) ? { dupOf: dupOf.get(j.dup)! } : {}) };
  });
  const renum = [...new Set(J.filter((j, i) => j.number !== G.journals[i]!.number).map((j) => j.label))];
  if (opJ) J.unshift(opJ);
  // invoices: one entry per invoice (in the nalog of its lines); a number WISE already has → skipped
  const invNos = invs.length ? new Set((await tx.select({ n: invoices.number }).from(invoices)
    .where(and(eq(invoices.firmId, firmId), eq(invoices.kind, 'invoice'), sql`${invoices.date} between ${y + '-01-01'} and ${y + '-12-31'}`))).map((x) => x.n)) : new Set<string>();
  for (const v of invs) {
    const r0 = v.rows[0]!;
    J.push({ key: r0.no ? `${r0.type}|${r0.no}` : `${r0.type}|@${r0.date}`, label: `Фактура ${v.no}`, type: r0.type, no: r0.no, number: null, date: v.date, rows: v.rows,
      D: v.total, P: v.total, dup: 'inv|' + v.no, invoice: v, ...(invNos.has(v.no) ? { dupOf: 'постоечка излезна фактура' } : {}) });
  }
  if (renum.length) warnings.push(`Бројот на налогот веќе се користи во WISE – добива „У“ пред бројот: ${renum.slice(0, 8).join(', ')}${renum.length > 8 ? '…' : ''}.`);
  const fresh = J.filter((j) => !j.dupOf);

  // periods (journals not yet imported): the working year, the locked period
  const dupRows = new Set(J.filter((j) => j.dupOf != null).flatMap((j) => j.rows));
  const live = rows.filter((r) => !dupRows.has(r));
  const outYear = live.filter((r) => !r.date.startsWith(y + '-'));
  if (outYear.length) add('year', `${outYear.length} ставки се надвор од работната ${y} година (на пр. ${dmy(outYear[0]!.date)}, ред ${outYear[0]!.r}) – изберете ја таа година или поправете ги датумите.`, outYear.map((r) => r.r));
  const locked = firm.lockDate ? live.filter((r) => r.date <= firm.lockDate!) : [];
  if (locked.length) add('period', `Периодот до ${dmy(firm.lockDate!)} е заклучен – ${locked.length} ставки (на пр. ред ${locked[0]!.r}, ${dmy(locked[0]!.date)}) не може да се книжат.`, locked.map((r) => r.r));

  // trial balance: the books of the year up to the last date of the file + the import
  const tbTo = rows.reduce((m, r) => (r.date > m ? r.date : m), '') || null;
  const T = new Map<string, { d: number; p: number }>();
  if (tbTo && tbTo.startsWith(y)) {
    const ex = await tx.select({ k: journalLines.account, d: sql<string>`sum(${journalLines.debit})`, p: sql<string>`sum(${journalLines.credit})` })
      .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
      .where(and(eq(journalLines.firmId, firmId), sql`${journals.date} between ${y + '-01-01'} and ${tbTo}`)).groupBy(journalLines.account);
    for (const e of ex) T.set(e.k, { d: Math.round(Number(e.d) * 100), p: Math.round(Number(e.p) * 100) });
  }
  for (const j of fresh) for (const r of j.rows) {
    const t = T.get(r.k) ?? { d: 0, p: 0 };
    t.d += r.d; t.p += r.p;
    T.set(r.k, t);
  }
  const tb = [...T].sort((a, b) => a[0].localeCompare(b[0])).filter(([, t]) => t.d || t.p)
    .map(([k, t]) => ({ k, name: nameOf.get(k) ?? '', d: mk(t.d), p: mk(t.p), s: mk(t.d - t.p) }));
  const tbTotal = { d: mk([...T.values()].reduce((s, t) => s + t.d, 0)), p: mk([...T.values()].reduce((s, t) => s + t.p, 0)) };

  // per month
  const bad0 = new Set(problems.flatMap((p) => (jiBlocks(p, input.createPartners) ? p.rows : [])));
  const rowMonth = new Map(rows.map((r) => [r.r, r.date.slice(0, 7)]));
  const months = jiMonths(J).map((m) => ({ ...m, D: mk(m.D), P: mk(m.P), problems: [...bad0].filter((r) => rowMonth.get(r) === m.m).length }));
  const blocking = problems.filter((p) => jiBlocks(p, input.createPartners));
  const D = J.reduce((s, j) => s + j.D, 0), Pp = J.reduce((s, j) => s + j.P, 0);
  const preview: JiPreview = {
    file: input.file, rows: R0.rows.length + bad.length, skipped,
    nalogs: new Set(J.map((j) => j.key)).size, journals: J.length, lines: J.reduce((s, j) => s + j.rows.length, 0), D: mk(D), P: mk(Pp),
    months, problems, missingPartners: M,
    duplicates: J.filter((j) => j.dupOf != null).map((j) => ({ label: j.label, date: j.date, total: mk(j.D), file: j.dupOf! })),
    sameFile, warnings, tb, tbTo, tbTotal, opening,
    matchedBy: { code: by.code.size, edb: by.edb.size, name: by.name.size, norm: by.norm.size, translit: by.translit.size },
    invoices: input.mode === 'invoices' ? { n: invs.length, total: mk(invs.reduce((s, v) => s + v.total, 0)), rounded: invs.filter((v) => v.vatRound).length, refused: invRefused, dups: invs.filter((v) => invNos.has(v.no)).map((v) => v.no) } : null,
    list: J.slice(0, 400).map((j) => ({ label: j.label, number: j.number, date: j.date, lines: j.rows.length, total: mk(j.D), dup: j.dupOf != null })),
    ok: !blocking.length && R0.rows.length > 0,
  };
  return { P: preview, J, partnerOf, missing: M, dupOf, used };
}

/** Preview of an import (nothing is written). */
export async function previewJournalImport(tx: Tx, firmId: string, input: JiInput): Promise<JiPreview> {
  return (await analyze(tx, firmId, input)).P;
}

export interface JiResult {
  batch: string; journals: number; lines: number; D: number; duplicates: number; newPartners: number;
  /** mode `invoices`: outgoing invoices saved, and the ones WISE would book differently (imported as journal lines) */
  invoices?: number; invoicesRefused?: { no: string; why: string }[];
  /** WISE's statistical VAT-base lines (994… / 999…) the invoices added beyond the file's lines */
  statLines?: number;
  /** invoices saved with the file's VAT (the old program rounded it to whole denars; audited `impVatRound`) */
  vatRounded?: number;
  /** the opening balance of the file: posted as „Почетна состојба“, left out, or already in WISE (skipped) */
  opening?: 'posted' | 'skipped' | 'exists';
}

/**
 * Import the batch: every check of the preview again, then (with `createPartners`) the missing partners and every
 * journal that is not a duplicate, all in the caller's transaction. Throws {@link JournalImportError} when something
 * blocks (the message lists the first problems).
 */
export async function commitJournalImport(tx: Tx, a: { firmId: string; userId: string | null; role?: string }, input: JiInput): Promise<JiResult> {
  let A = await analyze(tx, a.firmId, input);
  if (!A.P.ok) {
    const blocking = A.P.problems.filter((p) => jiBlocks(p, input.createPartners));
    throw new JournalImportError(blocking.length ? 'Увозот не е направен: ' + blocking.slice(0, 5).map((p) => p.msg).join(' · ') + (blocking.length > 5 ? ` … (вкупно ${blocking.length} проблеми)` : '') : 'Датотеката нема ставки за книжење.');
  }
  let newPartners = 0;
  if (input.createPartners && A.missing.length) {
    const taken = (await tx.select({ c: partners.code }).from(partners).where(eq(partners.firmId, a.firmId))).map((x) => x.c);
    const T = new Set(taken.map((c) => String(c ?? '').trim()).filter(Boolean));
    for (const m of A.missing) {
      const code = m.code && !T.has(m.code) ? m.code : nextNumericCode([...T]);
      T.add(code);
      await tx.insert(partners).values({ firmId: a.firmId, code, name: m.name || (m.code ? 'Комитент ' + m.code : 'ЕДБ ' + m.edb), edb: m.edb || null, vatRegistered: true });
      newPartners++;
    }
    A = await analyze(tx, a.firmId, { ...input, createPartners: false });
    if (!A.P.ok) throw new JournalImportError('Увозот не е направен: ' + A.P.problems.filter((p) => jiBlocks(p)).slice(0, 5).map((p) => p.msg).join(' · '));
  }
  const batch = crypto.randomUUID();
  let n = 0, lines = 0, D = 0;
  let nInv = 0, statLines = 0, vatRounded = 0;
  const fallback: JiRow[] = [];
  const invRefused: { no: string; why: string }[] = [];
  const key = (k: string, d: number, p: number, pid: string | null) => `${k}|${d}|${p}|${needsPartner(k) ? pid ?? '' : ''}`;
  for (const j of A.J) {
    if (j.dupOf != null) continue;
    if (j.invoice) {
      const v = j.invoice;
      // the existing invoice save path; the printed number stays and WISE must book exactly the lines of the file
      const r = await tx.transaction(async () => {
        const sv = await saveInvoice(tx, a.firmId, {
          kind: 'invoice', number: v.no, date: v.date, due: v.date, partnerId: A.partnerOf.get(v.ar) ?? null,
          lines: v.lines.map((l) => ({ name: `Увезено од старата програма (${v.no})`, unit: 'ком', qty: 1, price: l.base / 100, rate: l.rate, account: l.account, ...(l.vat != null ? { vatFix: l.vat / 100 } : {}) })),
          note: `Увезено од ${input.file}`,
          // an invoice without VAT: its exemption kind and basis (1200009 in the old program = чл. 24, field 08)
          // (its revenue stays on the file's konto: no zero-rate revenue konto)
          ...(v.vatExempt ? { data: { vatExempt: v.vatExempt, vatNote: v.vatNote ?? '', keepKonto: '1' } } : {}),
        }, { userId: a.userId, role: a.role ?? 'admin' });
        if (sv.renumbered || sv.number !== v.no) throw new JournalImportError(`бројот ${v.no} е зафатен`);
        const L = await tx.select({ k: journalLines.account, d: journalLines.debit, p: journalLines.credit, pid: journalLines.partnerId })
          .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
          .where(and(eq(journals.firmId, a.firmId), eq(journals.sourceType, 'invoice'), eq(journals.sourceId, sv.id)));
        // WISE's own statistical VAT-base lines (994… debit = 999… credit, the posting scheme's `vbout*`) are not in a
        // sales nalog of the old program: compared without them, counted apart (their D = P, they do not move a saldo
        // outside class 99)
        const stat = (k: string) => /^99[49]/.test(k) && !v.rows.some((x) => /^99[49]/.test(x.k));
        const got = L.filter((l) => !stat(l.k)).map((l) => key(l.k, Math.round(Number(l.d) * 100), Math.round(Number(l.p) * 100), l.pid)).sort();
        const want = v.rows.map((x) => key(x.k, x.d, x.p, A.partnerOf.get(x) ?? null)).sort();
        if (got.join(';') !== want.join(';')) throw new JournalImportError(`WISE би книжел поинаку (${L.map((l) => `${l.k} ${Number(l.d) || -Number(l.p)}`).join(', ')})`);
        statLines += L.filter((l) => stat(l.k)).length;
        // the file's VAT instead of base × rate (rounded to whole denars by the old program): one audit row per invoice
        if (v.vatRound) {
          vatRounded++;
          await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'impVatRound', entityType: 'invoice', entityId: sv.id,
            data: { number: v.no, rate: v.vatRound.rate, computed: mk(v.vatRound.calc), fileVat: mk(v.vatRound.file), diff: mk(v.vatRound.file - v.vatRound.calc), batch, file: input.file } });
        }
        return true;
      }).catch((e: unknown) => {
        if (e instanceof JournalImportError || e instanceof PostingError) { invRefused.push({ no: v.no, why: e.message }); fallback.push(...v.rows); return false; }
        throw e;
      });
      if (r) { nInv++; n++; lines += v.rows.length; D += v.total; }
      continue;
    }
    n++;
    if (j.opening) {
      // the opening-balance save path (`pocetna` saveOpening): kind open, source opening / open-<Y>, nalog 0
      await postJournal(tx, {
        firmId: a.firmId, date: j.date, kind: 'open', sourceType: 'opening', sourceId: `open-${input.year}`, description: `Почетна состојба ${input.year}`,
        lines: j.rows.map((r) => ({ account: r.k, debit: mk(r.d), credit: mk(r.p), partnerId: A.partnerOf.get(r) ?? null, note: r.desc || null, doc: r.doc || null })),
        meta: { imp: { batch, file: input.file, hash: input.hash, rows: j.rows.map((r) => r.r) } },
        userId: a.userId, requirePartner: false, auditAction: 'saveOpen',
      });
      const have = await tx.select({ konto: bankAccounts.konto }).from(bankAccounts).where(eq(bankAccounts.firmId, a.firmId));
      for (const r of obBankRows(j.rows.map((x) => ({ account: x.k, name: x.kname ?? '' })), have.map((h) => h.konto ?? ''))) {
        await saveBankAccount(tx, { firmId: a.firmId, userId: a.userId, input: { name: r.name || 'Сметка ' + r.account, cur: /^103/.test(r.account) ? 'EUR' : 'MKD', konto: r.account } });
      }
      lines += j.rows.length; D += j.D;
      continue;
    }
    await postJournal(tx, {
      firmId: a.firmId, date: j.date, kind: 'manual', number: j.number, description: `Увезен налог ${j.label}`,
      sourceType: 'import', sourceId: `${batch}:${n}`,
      lines: j.rows.map((r) => ({
        account: r.k, debit: mk(r.d), credit: mk(r.p), partnerId: A.partnerOf.get(r) ?? null, note: r.desc || null, doc: (r.doc || r.desc).slice(0, 100) || null,
        currency: r.curAmt != null && r.cur && r.cur !== 'MKD' ? r.cur : null, amountCur: r.curAmt != null && r.cur && r.cur !== 'MKD' ? mk(r.curAmt) : null,
      })),
      meta: { imp: { batch, file: input.file, hash: input.hash, dup: j.dup, type: j.type, no: j.no, rows: j.rows.map((r) => r.r) } },
      userId: a.userId, auditAction: 'postImportJournal', requirePartner: true,
    });
    lines += j.rows.length; D += j.D;
  }
  // invoices WISE would book differently: their lines as journal lines of the nalog (unless already imported so)
  if (fallback.length) {
    for (const j of jiGroup(fallback).journals) {
      if (A.dupOf.has(j.dup)) continue;
      const nb = jiNumber(j.type, j.no);
      n++;
      await postJournal(tx, {
        firmId: a.firmId, date: j.date, kind: 'manual', number: nb && A.used.has(nb) ? 'У' + nb : nb, description: `Увезен налог ${j.label}`,
        sourceType: 'import', sourceId: `${batch}:${n}`,
        lines: j.rows.map((r) => ({ account: r.k, debit: mk(r.d), credit: mk(r.p), partnerId: A.partnerOf.get(r) ?? null, note: r.desc || null, doc: (r.doc || r.desc).slice(0, 100) || null })),
        meta: { imp: { batch, file: input.file, hash: input.hash, dup: j.dup, type: j.type, no: j.no, rows: j.rows.map((r) => r.r) } },
        userId: a.userId, auditAction: 'postImportJournal', requirePartner: true,
      });
      lines += j.rows.length; D += j.D;
    }
  }
  const res: JiResult = {
    batch, journals: n, lines, D: mk(D), duplicates: A.J.filter((j) => j.dupOf != null).length, newPartners,
    ...(A.P.opening ? { opening: A.P.opening.exists ? 'exists' as const : A.P.opening.skip ? 'skipped' as const : 'posted' as const } : {}),
    ...(input.mode === 'invoices' ? { invoices: nInv, invoicesRefused: invRefused, statLines, vatRounded } : {}),
  };
  if (n) await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'impJournalBatch', entityType: 'journal_import', entityId: batch,
    data: { file: input.file, hash: input.hash, year: input.year, ...res } });
  return res;
}

export interface JiBatch { batch: string; file: string; at: string; journals: number; lines: number; D: number; from: string; to: string; locked: boolean }

/** The import batches of the year (newest first). */
export async function listJournalImports(tx: Tx, firmId: string, year: number): Promise<JiBatch[]> {
  const [firm] = await tx.select({ lockDate: firms.lockDate }).from(firms).where(eq(firms.id, firmId)).limit(1);
  const R = await tx.select({
    batch: sql<string>`${journals.meta}->'imp'->>'batch'`, file: sql<string>`max(${journals.meta}->'imp'->>'file')`,
    at: sql<string>`min(${journals.createdAt})`, journals: sql<number>`count(distinct ${journals.id})`, lines: sql<number>`count(${journalLines.id})`,
    D: sql<string>`coalesce(sum(${journalLines.debit}), 0)`, from: sql<string>`min(${journals.date})`, to: sql<string>`max(${journals.date})`,
    locked: sql<boolean>`bool_or(${journals.locked})`,
  }).from(journals).leftJoin(journalLines, eq(journalLines.journalId, journals.id))
    .where(and(eq(journals.firmId, firmId), eq(journals.sourceType, 'import'), sql`${journals.date} between ${year + '-01-01'} and ${year + '-12-31'}`))
    .groupBy(sql`${journals.meta}->'imp'->>'batch'`);
  return R.filter((r) => r.batch).map((r) => ({
    batch: r.batch, file: r.file ?? '', at: new Date(r.at).toISOString(), journals: Number(r.journals), lines: Number(r.lines), D: Math.round(Number(r.D) * 100) / 100,
    from: String(r.from), to: String(r.to), locked: !!r.locked || (!!firm?.lockDate && String(r.from) <= firm.lockDate),
  })).sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** „🗑 Избриши го увозот“: every journal of one batch, only when all of them are in open periods. */
export async function deleteJournalImport(tx: Tx, a: { firmId: string; userId: string | null }, batch: string): Promise<number> {
  if (!/^[0-9a-f-]{36}$/.test(batch)) throw new JournalImportError('Непознат увоз.');
  const rows = await tx.select().from(journals)
    .where(and(eq(journals.firmId, a.firmId), eq(journals.sourceType, 'import'), sql`${journals.sourceId} like ${batch + ':%'}`)).for('update');
  if (!rows.length) throw new JournalImportError('Увозот не постои (или е веќе избришан).');
  const n = await removeJournals(tx, a.firmId, rows, a.userId, 'unpostImportJournal');
  const file = (rows[0]!.meta as { imp?: { file?: string } }).imp?.file ?? '';
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'impJournalUndo', entityType: 'journal_import', entityId: batch, data: { file, journals: n } });
  return n;
}
