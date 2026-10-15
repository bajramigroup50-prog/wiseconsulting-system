/**
 * „🗂 Целосен извештај за фирма“ (office OWNER only) — the read side: one firm, one year up to a date, every section
 * from the EXISTING domain functions (no amount is computed here that a module already computes):
 *
 *  1 Основни податоци     firm row, responsible colleague, the accounting-service contract (`kdNormalize` / `kdAmt`),
 *                         unpaid fee invoices (`feeRows`), dossier documents with `expiry`
 *  2 Приходи и расходи    `ledgerTotals` per month over `loadLedgerLines` (this year and the same period last year),
 *                         largest customers / suppliers (the control dashboard's turnover without VAT)
 *  3 Финансиска состојба  `trialBalance` 10x, `cashDays`, open items from `documentPayments` with the dashboard's `AGE`
 *                         buckets, loans `loanStateOf`
 *  4 ДДВ                  `computeVatPeriod` per period with the period's corrections + `vat_periods` (as `vat_summary`)
 *  5 Плати и МПИН         `payroll_runs.totals`, `mpin_acks`, active employees
 *  6 Залихи и ОС          `lagerRows` / `lagerSummary`, `depreciationFor` + `depreciation_runs`
 *  7 Рокови               `loadRokFirms` + `rokGenerate` + the stored done / auto state, inspection remedy deadlines
 *  8 Законска усогл.      `alCompute` (autopilot), `lawReview` (LR_RULES), `complianceRows`, `bookChecks`, AML file,
 *                         open `kontroli` (`kontrolaDeadlines`), year-end control (`yearFindings`), program errors;
 *                         the cited articles from the stored law texts (`getLawArticle`)
 *  9 Документи            counts per month, inbox, `pendingClientCount`, who worked on the firm (`audit_log`)
 * 10 AI трошок            `ai_usage`
 *
 * The sections run in parallel on the POOL (no transaction — a caller must not pass one); each catches its own error,
 * so one failing section never fails the report. Reads only.
 */
import { and, asc, between, desc, eq, gte, inArray, isNull, lte, ne, notInArray, sql } from 'drizzle-orm';
import { periodOf, trialBalance, type LedgerLine } from '@wise/core';
import {
  complianceRows, kontrolaDeadlines, isKontrolaAuth, isKontrolaDoc, KONTROLA_AUTH, KONTROLA_DOC, LAW_ALIASES, lawRefsOf, MPIN_DAY, VAT_FILING_DAYS,
} from '@wise/core/compliance';
import { AGE, daysBetween } from '@wise/core/firms/dash';
import { kdAmt, kdNormalize, kdStatus, type KdContract } from '@wise/core/firms/kdog';
import { LAW_CORPUS, LR_LAWS } from '@wise/core/law';
import { addDays, alCompute, AML_LAW, cashDays, expiry, ledgerTotals, type FirmSnapshot } from '@wise/core/office';
import {
  firmReportAiKey, frAiPayload, frPct, frStatus, type FirmReport, type FrAiCost, type FrAiView, type FrBasic, type FrDeadlines, type FrDl, type FrDocs, type FrFinance,
  type FrFinding, type FrIncome, type FrKey, type FrLawText, type FrLegal, type FrLink, type FrOpen, type FrPayroll, type FrSection, type FrStock, type FrVat, type FrVatPeriod,
} from '@wise/core/office/firm-report';
import { rokGenerate, ROK_SRC } from '@wise/core/office/rokovi';
import { lagerRows, lagerSummary } from '@wise/core/stock-books';
import { yeLegalFormName } from '@wise/core/yearend/entity';
import type { Tx } from './audit';
import { documentPayments } from './bank/open-items';
import { complianceFacts, kontrolaDue } from './compliance';
import { feeContext, feeRows } from './fee-invoices';
import { getLawArticle } from './law-search';
import { lawReview, loanStateOf } from './lawrep';
import { effectiveChart, loadLedgerLines } from './ledger-queries';
import { buildFirmSnapshot, pendingClientCount } from './office';
import { bookChecks } from './robot/tools';
import { loadRokFirms } from './rokovi';
import {
  aiUsage, amlRecords, amlReports, appErrors, appSettings, auditLog, bankStatements, depreciationRuns, dossierDocs, employees, firms, inboxItems,
  invoices, journals, kontroli, mpinAcks, partners, payrollRuns, purchases, rokovi, serviceContracts, userFirms, users, vatPeriods, type Firm,
} from './schema/index';
import { loadStockContext } from './stock-service';
import { computeVatPeriod, firmVatPeriodKind } from './vat-service';
import { defaultVatSource } from './vat-source';
import { depreciationFor, loadYear, yearFindings } from './yearend';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const mEnd = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
const sameDayLastYear = (d: string) => { const y = Number(d.slice(0, 4)) - 1; const md = d.slice(5); return md === '02-29' ? `${y}-02-28` : `${y}-${md}`; };
const LR_SHORT: Record<string, string> = { zddv: 'ЗДДВ', zdd: 'ЗДД', zdld: 'ЗПДД', zdp: 'ЗДП' };

export interface FirmReportOpts {
  firmId: string;
  year: number;
  /** Report date inside the year (default: today in the current year, else 31.12). */
  to?: string | null;
  /** Today (Skopje). */
  today: string;
  /** The office owner (accounting contract, fees, owner-only deadlines). */
  owner: boolean;
  /** The current user (for `bookChecks` context only). */
  userId?: string | null;
}

/** The report window: [year-01-01, to] and the same period last year. */
export function firmReportWindow(year: number, to: string | null | undefined, today: string) {
  const y0 = `${year}-01-01`, y1 = `${year}-12-31`;
  const d = to && ISO.test(to) && to >= y0 && to <= y1 ? to : today.startsWith(String(year)) ? today : today < y0 ? y0 : y1;
  return { from: y0, to: d, prevFrom: `${year - 1}-01-01`, prevTo: sameDayLastYear(d) };
}

/** One section: computed, its status from its findings; an error becomes the section's message (never the report's). */
async function section<T>(key: FrKey, f: () => Promise<{ data: T; issues?: FrFinding[]; links?: FrLink[]; note?: string; empty?: boolean }>): Promise<FrSection<T>> {
  try {
    const r = await f();
    const issues = r.issues ?? [];
    return { key, status: frStatus(issues, r.empty), note: r.note, issues, links: r.links ?? [], data: r.data };
  } catch (e) {
    return { key, status: 'bad', issues: [], links: [], data: null, error: (e as Error)?.message || String(e) };
  }
}

/* ---------------- law texts of the findings ---------------- */

const CODE_TO_KEY = new Map(LAW_ALIASES.map(([code, label]) => [code, LAW_CORPUS.find((l) => l.abbr === label)?.k ?? null] as const));

/** The stored article texts a finding's law reference points to (version valid on `date`), cached per article. */
function lawTexts(db: Tx, date: string) {
  const cache = new Map<string, Promise<FrLawText | null>>();
  let budget = 60;
  return async (law: string | null | undefined): Promise<FrLawText[]> => {
    if (!law) return [];
    const out: FrLawText[] = [];
    for (const r of lawRefsOf(law).slice(0, 2)) {
      const key = r.law ? CODE_TO_KEY.get(r.law) : null;
      if (!key) continue;
      const ck = `${key}:${r.art}`;
      if (!cache.has(ck)) {
        if (budget-- <= 0) break;
        cache.set(ck, getLawArticle(db, key, r.art, date).then((a) => (a ? {
          ref: `${LAW_CORPUS.find((l) => l.k === key)?.abbr ?? key} чл. ${a.no}`, heading: a.heading, body: a.body, asOf: a.asOf, sourceUrl: a.sourceUrl,
        } : null)).catch(() => null));
      }
      const a = await cache.get(ck)!;
      if (a) out.push(a);
    }
    return out;
  };
}

/* ---------------- the report ---------------- */

export async function computeFirmReport(db: Tx, o: FirmReportOpts): Promise<FirmReport | null> {
  const [firm] = await db.select().from(firms).where(eq(firms.id, o.firmId)).limit(1);
  if (!firm) return null;
  const W = firmReportWindow(o.year, o.to, o.today);
  const { from, to, prevFrom, prevTo } = W;
  const Y = o.year;
  // shared loads (each once): the year's ledger up to the report date, last year's same period, the chart
  const ledger = loadLedgerLines(db, firm.id, from, to);
  const prevLedger = loadLedgerLines(db, firm.id, prevFrom, prevTo);
  const chart = effectiveChart(db, firm.id).then((C) => new Map(C.map((a) => [a.code, a.name])));
  // the share loads may fail: each section that awaits them reports the error itself
  for (const p of [ledger, prevLedger, chart]) p.catch(() => undefined);

  const [osnovni, prihodi, finansii, ddv, plati, zalihi, rok, zakon, dokumenti, ai] = await Promise.all([
    section<FrBasic>('osnovni', () => basicSection(db, firm, o, to)),
    section<FrIncome>('prihodi', () => incomeSection(db, firm, W, ledger, prevLedger)),
    section<FrFinance>('finansii', () => financeSection(db, firm, Y, to, ledger, chart)),
    section<FrVat>('ddv', () => vatSection(db, firm, Y, to, o.today)),
    section<FrPayroll>('plati', () => payrollSection(db, firm, Y, to, o.today)),
    section<FrStock>('zalihi', () => stockSection(db, firm, Y, to)),
    section<FrDeadlines>('rokovi', () => deadlineSection(db, firm, Y, o.today, o.owner)),
    section<FrLegal>('zakon', () => legalSection(db, firm, Y, from, to, o.today)),
    section<FrDocs>('dokumenti', () => docsSection(db, firm, from, to)),
    section<FrAiCost>('ai', () => aiSection(db, firm, from, to)),
  ]);
  // the cited articles from the stored law texts (the version valid on the report date), for every section's findings
  const LT = lawTexts(db, to);
  for (const s of [osnovni, prihodi, finansii, ddv, plati, zalihi, rok, zakon, dokumenti, ai] as FrSection[]) {
    for (const x of s.issues) if (x.law && !x.lawText) { const t = await LT(x.law); if (t.length) x.lawText = t; }
  }
  return {
    firm: { id: firm.id, name: firm.name }, year: Y, from, to, prevFrom, prevTo, today: o.today, generatedAt: new Date().toISOString(),
    sections: { osnovni, prihodi, finansii, ddv, plati, zalihi, rokovi: rok, zakon, dokumenti, ai },
  };
}

/* ---------------- 1. basic data ---------------- */

async function basicSection(db: Tx, f: Firm, o: FirmReportOpts, to: string) {
  const st = (f.settings ?? {}) as Record<string, unknown>;
  const [resp] = f.ownerId ? await db.select({ name: users.name }).from(users).where(eq(users.id, f.ownerId)).limit(1) : [];
  const A = await db.select({ name: users.name }).from(userFirms).innerJoin(users, eq(users.id, userFirms.userId))
    .where(and(eq(userFirms.firmId, f.id), eq(users.active, true), notInArray(users.role, ['klient'] as never[])));
  const issues: FrFinding[] = [];
  let contract: FrBasic['contract'] = null, fees: FrBasic['fees'] = null;
  if (o.owner) {
    const [c] = await db.select().from(serviceContracts).where(eq(serviceContracts.firmId, f.id)).orderBy(desc(serviceContracts.date), desc(serviceContracts.createdAt)).limit(1);
    const X = await feeContext(db).catch(() => null);
    if (c) {
      const k: KdContract = kdNormalize({ ...((c.data ?? {}) as Record<string, unknown>), id: c.id, number: c.number, date: c.date, start: c.start ?? undefined, end: c.end ?? undefined, fee: (c.data as { fee?: unknown } | null)?.fee ?? c.fee } as Partial<KdContract> & Record<string, unknown>, o.today);
      const amt = kdAmt(k.feeMode, k.fee, X?.rate ?? 18);
      const ended = !!c.end && c.end < o.today;
      contract = { number: c.number, date: c.date, start: c.start, end: c.end, status: kdStatus(k)[0] + (ended ? ' · истечен' : ''), fee: Number(k.fee) || 0, feeMode: k.feeMode, feeNet: amt.net, feeGross: amt.gross };
      if (!k.cliSig && !k.arch) issues.push({ sev: 'warn', src: 'osnovni', area: 'Договор', txt: `Договорот ${c.number} не е потпишан од клиентот.`, go: '/kdogovori' });
      if (ended) issues.push({ sev: 'warn', src: 'osnovni', area: 'Договор', txt: `Договорот ${c.number} истекол на ${c.end!.split('-').reverse().join('.')}.`, go: '/kdogovori' });
      if (!amt.net) issues.push({ sev: 'info', src: 'osnovni', area: 'Договор', txt: 'Во договорот нема месечен надомест.', go: '/kdogovori' });
    } else issues.push({ sev: 'warn', src: 'osnovni', area: 'Договор', txt: 'Нема договор за сметководствени услуги со фирмата.', go: '/kdogovori' });
    if (X) {
      const R = (await feeRows(db, { offId: X.off.id, limit: 2000 })).filter((r) => r.clientFirmId === f.id && r.remaining > 0);
      const tot = r2(R.reduce((s, r) => s + r.remaining, 0) / 100);
      fees = { unpaid: R.length, unpaidTotal: tot };
      const late = R.filter((r) => r.due && r.due < o.today);
      if (late.length) issues.push({ sev: 'warn', src: 'osnovni', area: 'Надомест', txt: `${late.length} доспеани неплатени фактури за сметководствен надомест (${r2(late.reduce((s, r) => s + r.remaining, 0) / 100).toLocaleString('de-DE')} ден.).`, go: '/kdfakturi' });
    }
  }
  const D = await db.select({ category: dossierDocs.category, title: dossierDocs.title, validTo: dossierDocs.validTo, date: dossierDocs.date }).from(dossierDocs).where(eq(dossierDocs.firmId, f.id));
  const dossier = D.map((d) => { const e = expiry(d, to); return { category: d.category, title: d.title, validTo: d.validTo, days: e?.days ?? null, lvl: e?.lvl ?? null }; })
    .sort((a, b) => (a.validTo ? 0 : 1) - (b.validTo ? 0 : 1) || String(a.validTo ?? '').localeCompare(String(b.validTo ?? '')) || a.category.localeCompare(b.category)).slice(0, 60);
  const exp = dossier.filter((d) => d.lvl === 'bad'), soon = dossier.filter((d) => d.lvl === 'warn');
  if (exp.length) issues.push({ sev: 'warn', src: 'osnovni', area: 'Досие', txt: `${exp.length} документи во досието се истечени (${exp.slice(0, 4).map((d) => d.title || d.category).join(', ')}${exp.length > 4 ? '…' : ''}).`, go: '/dosie' });
  if (soon.length) issues.push({ sev: 'info', src: 'osnovni', area: 'Досие', txt: `${soon.length} документи истекуваат во наредните 30 дена.`, go: '/dosie' });
  if (!f.edb) issues.push({ sev: 'bad', src: 'osnovni', area: 'Податоци', txt: 'Фирмата нема ЕДБ.', go: '/firmi' });
  if (!f.address && !f.city) issues.push({ sev: 'warn', src: 'osnovni', area: 'Податоци', txt: 'Фирмата нема адреса.', go: '/firmi' });
  if (!f.ownerId) issues.push({ sev: 'info', src: 'osnovni', area: 'Податоци', txt: 'Нема одговорен колега за фирмата.', go: '/firmi' });
  const data: FrBasic = {
    name: f.name, edb: f.edb, embs: f.embs, address: f.address, city: f.city, legalForm: f.legalForm, legalFormName: yeLegalFormName(f.legalForm),
    vat: f.vatRegistered ? (f.vatPeriod === 'month' ? 'month' : 'quarter') : 'none', activity: [st.nkd, f.activity].filter(Boolean).join(' – ') || null, active: f.active,
    phone: f.phone, email: f.email, responsible: resp?.name ?? null, assigned: [...new Set(A.map((a) => a.name))], contract, fees, dossier, dossierCount: D.length,
  };
  return { data, issues, links: [{ label: 'Фирми', href: '/firmi' }, { label: 'Досие', href: '/dosie' }, ...(o.owner ? [{ label: 'Договор', href: '/kdogovori' }] : [])] };
}

/* ---------------- 2. revenue and expenses ---------------- */

async function incomeSection(db: Tx, f: Firm, W: ReturnType<typeof firmReportWindow>, ledger: Promise<LedgerLine[]>, prevLedger: Promise<LedgerLine[]>) {
  const [L, LP] = await Promise.all([ledger, prevLedger]);
  const y = Number(W.from.slice(0, 4)), M = Number(W.to.slice(5, 7));
  const months: FrIncome['months'] = [];
  let cr = 0, ce = 0;
  for (let m = 1; m <= M; m++) {
    const a = `${y}-${String(m).padStart(2, '0')}-01`, b = m === M ? W.to : mEnd(y, m);
    const T = ledgerTotals(L, a, b);
    const P = ledgerTotals(LP, sameDayLastYear(a), m === M ? W.prevTo : mEnd(y - 1, m));
    cr = r2(cr + T.rev); ce = r2(ce + T.exp);
    months.push({ m: a.slice(0, 7), rev: T.rev, exp: T.exp, res: r2(T.rev - T.exp), cumRev: cr, cumExp: ce, cumRes: r2(cr - ce), prevRev: P.rev, prevExp: P.exp, prevRes: r2(P.rev - P.exp) });
  }
  const T = ledgerTotals(L, W.from, W.to), P = ledgerTotals(LP, W.prevFrom, W.prevTo);
  const tot = { rev: T.rev, exp: T.exp, res: r2(T.rev - T.exp) }, prev = { rev: P.rev, exp: P.exp, res: r2(P.rev - P.exp) };
  // largest customers / suppliers: turnover without VAT in denars (the control dashboard's query)
  const [TC, TS] = await Promise.all([
    db.select({ p: invoices.partnerId, v: sql<string>`sum(case when ${invoices.kind} = 'credit' then -1 else 1 end * ${invoices.base} * ${invoices.fx})` }).from(invoices)
      .where(and(eq(invoices.firmId, f.id), inArray(invoices.kind, ['invoice', 'credit']), ne(invoices.status, 'draft'), between(invoices.date, W.from, W.to))).groupBy(invoices.partnerId),
    db.select({ p: purchases.partnerId, v: sql<string>`sum(${purchases.base} * ${purchases.fx})` }).from(purchases)
      .where(and(eq(purchases.firmId, f.id), ne(purchases.status, 'draft'), between(purchases.date, W.from, W.to))).groupBy(purchases.partnerId),
  ]);
  const PN = await partnerNameMap(db, f.id, [...TC.map((x) => x.p), ...TS.map((x) => x.p)]);
  const top = (X: { p: string | null; v: string }[]) => X.map((x) => ({ name: (x.p && PN.get(x.p)) || '— без комитент', v: r2(Number(x.v)) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 10);
  const issues: FrFinding[] = [];
  if (tot.res < 0) issues.push({ sev: 'warn', src: 'prihodi', area: 'Резултат', txt: `Загуба од ${tot.res.toLocaleString('de-DE')} ден. за периодот.`, go: '/bilanc' });
  const empty = !L.length;
  return {
    data: { months, tot, prev, chg: { rev: frPct(tot.rev, prev.rev), exp: frPct(tot.exp, prev.exp), res: frPct(tot.res, prev.res) }, topCustomers: top(TC), topSuppliers: top(TS) },
    issues, empty, note: empty ? 'нема книжења во периодот' : undefined,
    links: [{ label: 'Бруто биланс', href: `/bilanc?from=${W.from}&to=${W.to}` }, { label: 'Анализи', href: '/analizi' }],
  };
}

async function partnerNameMap(db: Tx, firmId: string, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const R = await db.select({ id: partners.id, name: partners.name }).from(partners).where(and(eq(partners.firmId, firmId), inArray(partners.id, want)));
  return new Map(R.map((r) => [r.id, r.name]));
}

/* ---------------- 3. financial position ---------------- */

async function openItems(db: Tx, firmId: string, to: string, kind: 'inv' | 'pur'): Promise<{ partnerId: string | null; date: string; due: string | null; remaining: number }[]> {
  const D = kind === 'inv'
    ? await db.select({ id: invoices.id, date: invoices.date, due: invoices.due, partnerId: invoices.partnerId }).from(invoices)
      .where(and(eq(invoices.firmId, firmId), eq(invoices.kind, 'invoice'), notInArray(invoices.status, ['draft', 'pending']), lte(invoices.date, to)))
    : await db.select({ id: purchases.id, date: purchases.date, due: purchases.due, partnerId: purchases.partnerId }).from(purchases)
      .where(and(eq(purchases.firmId, firmId), notInArray(purchases.status, ['draft', 'pending']), lte(purchases.date, to)));
  if (!D.length) return [];
  const P = await documentPayments(db, firmId, kind === 'inv' ? { invoiceIds: D.map((x) => x.id) } : { purchaseIds: D.map((x) => x.id) });
  return D.flatMap((x) => { const p = P.get(x.id); return p && p.remaining > 0.005 ? [{ partnerId: x.partnerId, date: x.date, due: x.due, remaining: p.remaining }] : []; });
}

function ageOpen(D: Awaited<ReturnType<typeof openItems>>, asOf: string, names: Map<string, string>): FrOpen {
  const od = (x: { due: string | null; date: string }) => daysBetween(asOf, x.due || x.date);
  const buckets = AGE.map(([label, fn]) => { const X = D.filter((x) => fn(od(x))); return { label, v: r2(X.reduce((s, x) => s + x.remaining, 0)), n: X.length }; });
  const by = new Map<string, { name: string; v: number; n: number; overdue: number }>();
  for (const x of D) {
    const k = x.partnerId ?? '-';
    const e = by.get(k) ?? { name: (x.partnerId && names.get(x.partnerId)) || '— без комитент', v: 0, n: 0, overdue: 0 };
    e.v = r2(e.v + x.remaining); e.n++;
    if (od(x) < 0) e.overdue = r2(e.overdue + x.remaining);
    by.set(k, e);
  }
  return {
    total: r2(D.reduce((s, x) => s + x.remaining, 0)), overdue: r2(D.filter((x) => od(x) < 0).reduce((s, x) => s + x.remaining, 0)),
    buckets, top: [...by.values()].sort((a, b) => b.v - a.v).slice(0, 10),
  };
}

async function financeSection(db: Tx, f: Firm, Y: number, to: string, ledger: Promise<LedgerLine[]>, chart: Promise<Map<string, string>>) {
  const [L, names] = await Promise.all([ledger, chart]);
  const T = trialBalance(L, { level: 'a', from: `${Y}-01-01`, to, accountName: (x) => names.get(x) });
  const accounts = T.rows.filter((r) => r.k.startsWith('10')).map((r) => ({ konto: r.k, name: r.name ?? '', saldo: r2(r.s) }));
  const bank = r2(accounts.filter((r) => r.konto.startsWith('100')).reduce((a, r) => a + r.saldo, 0));
  const cash = r2(accounts.filter((r) => r.konto.startsWith('102')).reduce((a, r) => a + r.saldo, 0));
  const st = (f.settings ?? {}) as { kasaCash?: string };
  const cd = cashDays({ ledger: L, cashAccounts: [...new Set(['1020', st.kasaCash ?? '1020'])], today: to } as unknown as FirmSnapshot, String(Y));
  // days in the red: the balance after a day's movements holds until the next day with movements (or the report date)
  let negDays = 0;
  cd.days.forEach(([d, b], i) => { if (b < -1) negDays += Math.max(1, daysBetween(d, cd.days[i + 1]?.[0] ?? addDays(to, 1))); });
  const [I, P] = await Promise.all([openItems(db, f.id, to, 'inv'), openItems(db, f.id, to, 'pur')]);
  const loans = await loanStateOf(db, f, L, Object.fromEntries(names), to).catch(() => null);
  const PN = await partnerNameMap(db, f.id, [...I.map((x) => x.partnerId), ...P.map((x) => x.partnerId), ...(loans?.rows ?? []).map((r) => r.l.partnerId ?? null)]);
  const recv = ageOpen(I, to, PN), pay = ageOpen(P, to, PN);
  const LR = (loans?.rows ?? []).map((r) => ({ dir: r.l.dir, partner: (r.l.partnerId && PN.get(r.l.partnerId)) || (r.l as { partnerName?: string | null }).partnerName || '—', amount: r2(Number(r.l.amount)), bal: r2(r.bal), over: !!r.over, noSig: !!r.noSig, date: r.l.date }));
  const issues: FrFinding[] = [];
  if (cd.firstNeg) issues.push({ sev: 'bad', src: 'finansii', area: 'Благајна', txt: `Благајната била во минус ${negDays} дена (прв ден ${cd.firstNeg.split('-').reverse().join('.')}, најниско ${cd.minB.toLocaleString('de-DE')} ден.).`, go: '/blagajna' });
  const r90 = recv.buckets.find((b) => /над 90/.test(b.label));
  if (r90?.v) issues.push({ sev: 'warn', src: 'finansii', area: 'Побарувања', txt: `${r90.n} фактури доспеани пред повеќе од 90 дена: ${r90.v.toLocaleString('de-DE')} ден.`, go: '/opomeni' });
  if (pay.overdue > 0) issues.push({ sev: 'info', src: 'finansii', area: 'Обврски', txt: `Доспеани неплатени обврски кон добавувачи: ${pay.overdue.toLocaleString('de-DE')} ден.`, go: '/analitika' });
  if (LR.some((l) => l.over && l.bal > 0)) issues.push({ sev: 'warn', src: 'finansii', area: 'Позајмици', txt: 'Има позајмици со истечен рок за враќање.', go: '/pozajmici' });
  if (LR.some((l) => l.noSig)) issues.push({ sev: 'warn', src: 'finansii', area: 'Позајмици', txt: 'Има позајмици без потпишан договор.', go: '/pozajmici' });
  return {
    data: {
      asOf: to, bank, cash, accounts, cashNeg: { firstNeg: cd.firstNeg, minB: cd.minB, minD: cd.minD, negDays }, recv, pay,
      loans: { rows: LR, given: r2(LR.filter((l) => l.dir === 'given').reduce((s, l) => s + l.bal, 0)), received: r2(LR.filter((l) => l.dir === 'received').reduce((s, l) => s + l.bal, 0)), unlinked: loans?.unlinked.length ?? 0 },
    },
    issues,
    links: [{ label: 'Благајна', href: '/blagajna' }, { label: 'Изводи', href: '/banka' }, { label: 'Аналитика на партнери', href: '/analitika' }, { label: 'Опомени', href: '/opomeni' }, { label: 'Позајмици', href: '/pozajmici' }],
  };
}

/* ---------------- 4. VAT ---------------- */

async function vatSection(db: Tx, f: Firm, Y: number, to: string, today: string) {
  if (!f.vatRegistered) return { data: { registered: false, kind: null, periods: [] } as FrVat, links: [{ label: 'Фирми', href: '/firmi' }] };
  const kind = firmVatPeriodKind(f);
  const last = periodOf(to, kind);
  const P: string[] = [];
  if (kind === 'month') for (let m = 1; m <= 12; m++) { const p = `${Y}-${String(m).padStart(2, '0')}`; if (p <= last) P.push(p); }
  else for (let q = 1; q <= 4; q++) { const p = `${Y}-Т${q}`; if (p <= last) P.push(p); }
  const rows = new Map((await db.select().from(vatPeriods).where(and(eq(vatPeriods.firmId, f.id), inArray(vatPeriods.period, P.length ? P : ['-'])))).map((r) => [r.period, r]));
  const periods: FrVatPeriod[] = [];
  const issues: FrFinding[] = [];
  const byRate = (o: Record<number, { b: number; v: number }>) => Object.entries(o).filter(([, x]) => x.b || x.v).map(([r, x]) => ({ rate: Number(r), base: r2(x.b), vat: r2(x.v) }));
  // sequential: each period loads its documents (no burst of parallel heavy reads for one firm)
  for (const p of P) {
    const row = rows.get(p);
    const V = await computeVatPeriod(db, f, p, defaultVatSource, row?.corrections ?? {});
    const R = V.result;
    const closed = row?.status === 'closed';
    const diff = r2(V.close.diff - R.net);
    const late = !closed && V.due < today;
    periods.push({ period: p, from: V.from, to: V.to, due: V.due, outV: r2(R.outV), inV: r2(R.inV), net: r2(R.net), out: byRate(R.out), in: byRate(R.in), closed, filed: closed || !!row?.submittedAt, ledgerNet: r2(V.close.diff), match: Math.abs(diff) < 0.01, diff, late });
    if (late) issues.push({ sev: 'bad', src: 'ddv', area: 'ДДВ', txt: `ДДВ-04 за ${p} не е затворена/поднесена, а рокот (${V.due.split('-').reverse().join('.')}) помина.`, law: VAT_FILING_DAYS.law, go: `/ddv?p=${encodeURIComponent(p)}` });
    if (Math.abs(diff) >= 0.01) issues.push({ sev: 'warn', src: 'ddv', area: 'ДДВ', txt: `${p}: книгите за ДДВ (${R.net.toLocaleString('de-DE')}) не се совпаѓаат со ДДВ контата во главната книга (${V.close.diff.toLocaleString('de-DE')}), разлика ${diff.toLocaleString('de-DE')} ден.`, go: '/ddvKnigi' });
  }
  return { data: { registered: true, kind, periods } as FrVat, issues, links: [{ label: 'ДДВ-04', href: '/ddv' }, { label: 'Книги за ДДВ', href: '/ddvKnigi' }] };
}

/* ---------------- 5. payroll and МПИН ---------------- */

async function payrollSection(db: Tx, f: Firm, Y: number, to: string, today: string) {
  const [R, A, E] = await Promise.all([
    db.select().from(payrollRuns).where(and(eq(payrollRuns.firmId, f.id), sql`${payrollRuns.month} like ${Y + '-%'}`)).orderBy(asc(payrollRuns.month)),
    db.select({ month: mpinAcks.month, no: mpinAcks.no, status: mpinAcks.status, gross: mpinAcks.gross, net: mpinAcks.net }).from(mpinAcks).where(and(eq(mpinAcks.firmId, f.id), sql`${mpinAcks.month} like ${Y + '-%'}`)),
    db.select({ n: sql<number>`count(*)::int` }).from(employees).where(and(eq(employees.firmId, f.id), eq(employees.active, true))),
  ]);
  const emps = E[0]?.n ?? 0;
  const runs = new Map(R.map((r) => [r.month, r]));
  const acks = new Map(A.map((a) => [a.month, a]));
  const last = to.slice(0, 7);
  const months: FrPayroll['months'] = [];
  const issues: FrFinding[] = [];
  for (let m = 1; m <= 12; m++) {
    const ym = `${Y}-${String(m).padStart(2, '0')}`;
    if (ym > last) break;
    const r = runs.get(ym), a = acks.get(ym);
    const t = (r?.totals ?? {}) as Record<string, number>;
    const n = (k: string) => r2(Number(t[k] ?? 0));
    // МПИН for month M is due on the 10th of M+1
    const due = m === 12 ? `${Y + 1}-01-10` : `${Y}-${String(m + 1).padStart(2, '0')}-10`;
    const accepted = !!a && /ПРИФАТ/i.test(a.status ?? '');
    const late = emps > 0 && !r && !a && due < today;
    if (!r && !a && !emps) continue;
    months.push({
      month: ym, status: r?.status ?? null, locked: !!r?.locked, gross: r ? n('gross') : r2(Number(a?.gross ?? 0)), net: r ? n('net') : r2(Number(a?.net ?? 0)), contr: n('contr'), tax: n('tax'), emps: n('emps'),
      mpin: a ? { no: a.no, status: a.status, accepted } : null, due, late,
    });
    if (late) issues.push({ sev: 'bad', src: 'plati', area: 'Плата', txt: `За ${ym} нема пресметана плата ниту МПИН, а рокот (${due.split('-').reverse().join('.')}) помина.`, law: MPIN_DAY.law, go: '/plati' });
    else if (r && r.status !== 'posted' && due < today) issues.push({ sev: 'warn', src: 'plati', area: 'Плата', txt: `Платата за ${ym} е само нацрт (не е книжена).`, go: '/plati' });
    if (r && !accepted && due < today) issues.push({ sev: 'warn', src: 'plati', area: 'МПИН', txt: `За ${ym} нема прифатен МПИН во програмата.`, go: '/mpinIn' });
  }
  const sum = (k: 'gross' | 'net' | 'contr' | 'tax') => r2(months.reduce((s, m) => s + m[k], 0));
  return {
    data: { months, employees: emps, gross: sum('gross'), net: sum('net'), contr: sum('contr'), tax: sum('tax') } as FrPayroll,
    issues, empty: !months.length && !emps, note: !months.length && !emps ? 'фирмата нема вработени' : undefined,
    links: [{ label: 'Пресметка на плата', href: '/plati' }, { label: 'МПИН од УЈП', href: '/mpinIn' }, { label: 'Вработени', href: '/vraboteni' }],
  };
}

/* ---------------- 6. stock and fixed assets ---------------- */

async function stockSection(db: Tx, f: Firm, Y: number, to: string) {
  const S = await loadStockContext(db, f.id);
  const rows = lagerRows(S.ctx, { date: to, zero: false });
  const sum = rows.length ? lagerSummary(rows) : null;
  const negative = rows.filter((r) => r.s.qty < -1e-9).map((r) => ({ code: r.item.code ?? '', name: r.item.name ?? '', qty: r.s.qty })).slice(0, 40);
  const D = await depreciationFor(db, f.id, Y);
  const [run] = await db.select({ total: depreciationRuns.total, journalId: depreciationRuns.journalId }).from(depreciationRuns).where(and(eq(depreciationRuns.firmId, f.id), eq(depreciationRuns.year, Y))).limit(1);
  const active = D.assets.filter((a) => !a.disposed || a.disposed > to);
  const issues: FrFinding[] = [];
  if (negative.length) issues.push({ sev: 'bad', src: 'zalihi', area: 'Залихи', txt: `${negative.length} артикли со минус залиха на ${to.split('-').reverse().join('.')} (${negative.slice(0, 5).map((x) => x.name).join(', ')}${negative.length > 5 ? '…' : ''}).`, go: `/g_lager?d=${to}` });
  const yearOver = to >= `${Y}-12-31`;
  if (D.total > 0.005 && !run) issues.push({ sev: yearOver ? 'warn' : 'info', src: 'zalihi', area: 'Амортизација', txt: `Амортизацијата за ${Y} (${r2(D.total).toLocaleString('de-DE')} ден.) не е книжена.`, go: '/os' });
  return {
    data: {
      stock: { date: to, items: rows.length, value: sum ? r2(Number(sum.fin.st)) : 0, negative },
      assets: { count: D.assets.length, active: active.length, cost: r2(active.reduce((s, a) => s + Number(a.cost), 0)), depYear: r2(D.total), depRun: !!run, runTotal: r2(Number(run?.total ?? 0)) },
    } as FrStock,
    issues, empty: !rows.length && !D.assets.length,
    links: [{ label: 'Лагер листа', href: `/g_lager?d=${to}` }, { label: 'Основни средства', href: '/os' }],
  };
}

/* ---------------- 7. deadlines ---------------- */

async function deadlineSection(db: Tx, f: Firm, Y: number, today: string, owner: boolean) {
  const from = `${Y}-01-01`;
  const to = today.startsWith(String(Y)) || today < from ? addDays(today, 90) : `${Y + 1}-03-31`;
  const F = await loadRokFirms(db, { from, to, firmIds: [f.id] });
  const gen = F.filter((x) => x.id === f.id).flatMap((x) => rokGenerate(x, from, to));
  const stored = new Map((await db.select({ key: rokovi.key, done: rokovi.done, auto: rokovi.auto }).from(rokovi)
    .where(and(eq(rokovi.firmId, f.id), between(rokovi.due, from, to), eq(rokovi.gone, false)))).map((r) => [r.key, r]));
  const all: FrDl[] = [];
  for (const r of gen) {
    if (r.type === 'kdog' && !owner) continue;
    const s = stored.get(r.key);
    const done = s ? s.done : !!r.done;
    all.push({ date: r.due, what: r.title, law: ROK_SRC[r.type] ?? null, href: '/' + r.link, done, auto: !!s?.auto, overdue: r.due < today && !done, verified: r.verified });
  }
  const K = await db.select().from(kontroli).where(and(eq(kontroli.firmId, f.id), ne(kontroli.status, 'closed'), isNull(kontroli.filedOn))).limit(30);
  for (const k of K) {
    const due = kontrolaDue(k);
    if (due) all.push({ date: due, what: `Рок за правен лек по контрола (${k.auth.toUpperCase()} ${k.docNo ?? ''})`.trim(), href: '/kontroli', done: false, auto: false, overdue: due < today });
  }
  all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const overdue = all.filter((x) => x.overdue), done = all.filter((x) => x.done), upcoming = all.filter((x) => !x.done && !x.overdue);
  const issues: FrFinding[] = overdue.map((x) => ({ sev: 'bad' as const, src: 'rokovi', area: 'Рок', txt: `Пропуштен рок ${x.date.split('-').reverse().join('.')}: ${x.what}.`, law: x.law, go: x.href }));
  const soon = upcoming.filter((x) => daysBetween(today, x.date) <= 7);
  for (const x of soon) issues.push({ sev: 'info', src: 'rokovi', area: 'Рок', txt: `Рок за ${daysBetween(today, x.date)} дена (${x.date.split('-').reverse().join('.')}): ${x.what}.`, law: x.law, go: x.href });
  return { data: { from, to, upcoming, overdue, done } as FrDeadlines, issues, links: [{ label: 'Календар на рокови', href: '/rokovi' }] };
}

/* ---------------- 8. legal compliance and controls ---------------- */

async function legalSection(db: Tx, f: Firm, Y: number, from: string, to: string, today: string) {
  const F: FrFinding[] = [];
  const failed: string[] = [];
  const counts: FrLegal['counts'] = {};
  const add = (x: FrFinding) => { F.push(x); const c = (counts[x.src] ??= { bad: 0, warn: 0 }); if (x.sev === 'bad') c.bad++; else if (x.sev === 'warn') c.warn++; };
  const yearOver = today > `${Y}-12-31`;
  let lawrep: FrLegal['lawrep'] = null, aml: FrLegal['aml'] = null, yearend: FrLegal['yearend'] = null;
  const kont: FrLegal['kontroli'] = [];
  // sequential: these controls each load a lot for one firm
  // 1. autopilot (balances, invoice gaps, VAT, payroll, cash in the red, dossier, collection)
  try {
    const S = await buildFirmSnapshot(db, f.id, { today: to });
    if (S) for (const x of alCompute(S)) add({ sev: x.lvl, src: 'autop', area: x.cat, txt: x.txt, go: '/' + x.go });
  } catch (e) { failed.push('автопилот: ' + (e as Error).message); }
  // 2. tax review by the laws (LR_RULES: ЗДДВ / ЗДД / ЗПДД / ЗДП, law + article)
  try {
    const X = await lawReview(db, f, Y, to);
    lawrep = { bad: X.bad, warn: X.warn, exp: X.exp };
    for (const r of X.R) if (r.s === 'bad' || r.s === 'warn') add({ sev: r.s, src: 'lawrep', area: 'Даночен преглед', txt: `${r.r.t}: ${r.txt}`, law: `${LR_SHORT[r.r.law] ?? LR_LAWS[r.r.law][0]} ${r.r.art} – ${LR_LAWS[r.r.law][0]}`, go: '/lawrep' });
  } catch (e) { failed.push('даночен преглед: ' + (e as Error).message); }
  // 3. legal compliance (invoice elements and numbering, cash limits, retention, data protection, VAT filed…)
  try {
    const CF = await complianceFacts(db, f.id, Y, to);
    if (CF) for (const r of complianceRows(CF)) if (r.s === 'bad' || r.s === 'warn') add({ sev: r.s, src: 'cmp', area: r.area, txt: `${r.title}: ${r.txt}`, law: r.law, go: r.go ? '/' + r.go.replace(/^\//, '') : '/zakon' });
  } catch (e) { failed.push('законска усогласеност: ' + (e as Error).message); }
  // 4. the book checks (unbalanced journals, duplicate purchase invoices, unposted statements)
  try {
    const B = await bookChecks({ db, firm: f }, from, to);
    for (const x of B.findings) add({ sev: x.lvl, src: 'books', area: x.area, txt: x.txt, law: x.law ?? null, go: x.href });
    failed.push(...B.failed);
  } catch (e) { failed.push('проверка на книгите: ' + (e as Error).message); }
  // 5. AML (ЗСППФТ): the client's file, its review date, reports to УФР
  try {
    const [a] = await db.select().from(amlRecords).where(eq(amlRecords.firmId, f.id)).limit(1);
    const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(amlReports).where(eq(amlReports.firmId, f.id));
    aml = a ? { level: a.level, lastReview: a.lastReview, nextReview: a.nextReview, reports: n?.n ?? 0 } : null;
    if (!a) add({ sev: 'warn', src: 'aml', area: 'УФР', txt: 'Нема анализа на клиентот (досие за спречување перење пари).', law: AML_LAW, go: '/aml' });
    else if (a.nextReview && a.nextReview < today) add({ sev: 'warn', src: 'aml', area: 'УФР', txt: `Прегледот на клиентот требаше да се обнови до ${a.nextReview.split('-').reverse().join('.')}.`, law: AML_LAW, go: '/aml' });
  } catch (e) { failed.push('УФР: ' + (e as Error).message); }
  // 6. open inspections and their remedy deadlines
  try {
    const K = await db.select().from(kontroli).where(and(eq(kontroli.firmId, f.id), ne(kontroli.status, 'closed'))).limit(30);
    for (const k of K) {
      const d = isKontrolaAuth(k.auth) && isKontrolaDoc(k.doc) && !k.filedOn ? kontrolaDeadlines(k.auth, k.doc, k.delivered, today, kontrolaDue(k))[0] : undefined;
      kont.push({ auth: isKontrolaAuth(k.auth) ? KONTROLA_AUTH[k.auth] as string : k.auth, doc: isKontrolaDoc(k.doc) ? KONTROLA_DOC[k.doc] as string : k.doc, docNo: k.docNo, status: k.status, due: d?.due ?? null, state: d ? (d.state === 'expired' ? 'late' : d.state === 'open' ? 'open' : 'soon') : null, remedy: d?.remedy.name ?? null, law: d ? (d.remedy as { law?: string }).law ?? null : null });
      if (d && d.state === 'expired') add({ sev: 'bad', src: 'kontroli', area: 'Контрола', txt: `Рокот за ${d.remedy.name.toLowerCase()} (акт ${k.docNo ?? ''}) истече на ${d.due.split('-').reverse().join('.')}.`, law: (d.remedy as { law?: string }).law ?? null, go: `/kontroli?id=${k.id}` });
      else if (d && d.state !== 'open') add({ sev: 'warn', src: 'kontroli', area: 'Контрола', txt: `Рокот за ${d.remedy.name.toLowerCase()} (акт ${k.docNo ?? ''}) е на ${d.due.split('-').reverse().join('.')}.`, law: (d.remedy as { law?: string }).law ?? null, go: `/kontroli?id=${k.id}` });
      else if (!k.filedOn) add({ sev: 'info', src: 'kontroli', area: 'Контрола', txt: `Отворена контрола: ${isKontrolaDoc(k.doc) ? KONTROLA_DOC[k.doc] : k.doc} ${k.docNo ?? ''}.`.replace(/\s+\./, '.'), go: `/kontroli?id=${k.id}` });
    }
  } catch (e) { failed.push('контроли: ' + (e as Error).message); }
  // 7. year-end control of the chosen year (a running year: information only — it is done after the year end)
  try {
    const L = await loadYear(db, f.id, Y);
    const Z = await yearFindings(db, L, today);
    yearend = { open: Z.open.length, all: Z.all.length };
    for (const z of Z.open) add({ sev: !yearOver ? 'info' : z.sev === 'block' ? 'bad' : 'warn', src: 'yearend', area: `Завршна сметка – ${z.area}`, txt: z.txt, go: '/' + (z.go ?? 'zsKontrola') });
  } catch (e) { failed.push('контрола на завршна сметка: ' + (e as Error).message); }
  // 8. program errors recorded on this firm (Грешки во програмата)
  try {
    const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(appErrors).where(and(eq(appErrors.firmRef, f.id), eq(appErrors.fixed, false)));
    if (n?.n) add({ sev: 'warn', src: 'errors', area: 'Грешки', txt: `${n.n} незатворени грешки во програмата при работа со фирмата.`, go: '/greski' });
  } catch (e) { failed.push('грешки: ' + (e as Error).message); }
  const ord = { bad: 0, warn: 1, info: 2 } as const;
  const seen = new Set<string>();
  const issues = F.filter((x) => (seen.has(x.txt) ? false : (seen.add(x.txt), true))).sort((a, b) => ord[a.sev] - ord[b.sev]);
  return {
    data: { findings: [], counts, lawrep, kontroli: kont, aml, yearend, failed } as FrLegal,
    issues,
    links: [{ label: 'Даночен преглед', href: '/lawrep' }, { label: 'Закони на УЈП', href: '/ujpZakoni' }, { label: 'Законска усогласеност', href: '/zakon' }, { label: 'Автопилот', href: '/autop' }, { label: 'УФР', href: '/aml' }, { label: 'Контроли', href: '/kontroli' }, { label: 'Контрола на завршна сметка', href: '/zsKontrola' }],
    note: failed.length ? `не успеа: ${failed.length}` : undefined,
  };
}

/* ---------------- 9. documents and activity ---------------- */

async function docsSection(db: Tx, f: Firm, from: string, to: string) {
  const ym = (c: Parameters<typeof sql>[1]) => sql<string>`to_char(${c}, 'YYYY-MM')`;
  const [I, P, J, S, IB, pend, U] = await Promise.all([
    db.select({ m: ym(invoices.date), n: sql<number>`count(*)::int` }).from(invoices).where(and(eq(invoices.firmId, f.id), ne(invoices.status, 'draft'), between(invoices.date, from, to))).groupBy(ym(invoices.date)),
    db.select({ m: ym(purchases.date), n: sql<number>`count(*)::int` }).from(purchases).where(and(eq(purchases.firmId, f.id), ne(purchases.status, 'draft'), between(purchases.date, from, to))).groupBy(ym(purchases.date)),
    db.select({ m: ym(journals.date), n: sql<number>`count(*)::int` }).from(journals).where(and(eq(journals.firmId, f.id), between(journals.date, from, to))).groupBy(ym(journals.date)),
    db.select({ m: ym(bankStatements.date), n: sql<number>`count(*)::int` }).from(bankStatements).where(and(eq(bankStatements.firmId, f.id), between(bankStatements.date, from, to))).groupBy(ym(bankStatements.date)),
    db.select({ n: sql<number>`count(*)::int`, oldest: sql<string | null>`min(${inboxItems.createdAt})` }).from(inboxItems).where(and(eq(inboxItems.firmId, f.id), eq(inboxItems.done, false), eq(inboxItems.fromOffice, false))),
    pendingClientCount(db, f.id),
    db.select({ id: auditLog.userId, name: users.name, role: users.role, n: sql<number>`count(*)::int`, first: sql<string>`min(${auditLog.at})`, last: sql<string>`max(${auditLog.at})` })
      .from(auditLog).innerJoin(users, eq(users.id, auditLog.userId))
      .where(and(eq(auditLog.firmId, f.id), gte(auditLog.at, new Date(`${from}T00:00:00Z`)), lte(auditLog.at, new Date(`${addDays(to, 1)}T00:00:00Z`))))
      .groupBy(auditLog.userId, users.name, users.role).orderBy(desc(sql`count(*)`)).limit(30),
  ]);
  const M = new Map<string, { m: string; inv: number; pur: number; jour: number; stmt: number }>();
  const put = (R: { m: string; n: number }[], k: 'inv' | 'pur' | 'jour' | 'stmt') => { for (const r of R) { const e = M.get(r.m) ?? { m: r.m, inv: 0, pur: 0, jour: 0, stmt: 0 }; e[k] = r.n; M.set(r.m, e); } };
  put(I, 'inv'); put(P, 'pur'); put(J, 'jour'); put(S, 'stmt');
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '')).replace(' ', 'T').slice(0, 10);
  const inbox = { open: IB[0]?.n ?? 0, oldest: IB[0]?.oldest ? iso(IB[0].oldest) : null };
  const issues: FrFinding[] = [];
  if (inbox.open) issues.push({ sev: inbox.oldest && daysBetween(inbox.oldest, to) > 7 ? 'warn' : 'info', src: 'dokumenti', area: 'Пристигнато', txt: `${inbox.open} документи од клиентот чекаат обработка${inbox.oldest ? ` (најстар од ${inbox.oldest.split('-').reverse().join('.')})` : ''}.`, go: '/klInbox' });
  if (pend) issues.push({ sev: 'info', src: 'dokumenti', area: 'Портал', txt: `${pend} ставки внесени од клиентот чекаат одобрување.`, go: '/klPortal' });
  return {
    data: {
      months: [...M.values()].sort((a, b) => a.m.localeCompare(b.m)), inbox, pendingClient: pend,
      workers: U.map((u) => ({ name: u.name, role: u.role, n: u.n, first: iso(u.first), last: iso(u.last) })),
    } as FrDocs,
    issues,
    links: [{ label: 'Пристигнато од клиенти', href: '/klInbox' }, { label: 'Дневник на активности', href: '/aktivnost' }],
  };
}

/* ---------------- 10. AI cost ---------------- */

async function aiSection(db: Tx, f: Firm, from: string, to: string) {
  const at = and(eq(aiUsage.firmId, f.id), gte(aiUsage.at, new Date(`${from}T00:00:00Z`)), lte(aiUsage.at, new Date(`${addDays(to, 1)}T00:00:00Z`)));
  const m = sql<string>`to_char(${aiUsage.at}, 'YYYY-MM')`;
  const [M, P] = await Promise.all([
    db.select({ m, usd: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)`, n: sql<number>`count(*)::int` }).from(aiUsage).where(at).groupBy(m).orderBy(m),
    db.select({ p: aiUsage.purpose, usd: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)`, n: sql<number>`count(*)::int` }).from(aiUsage).where(at).groupBy(aiUsage.purpose),
  ]);
  const months = M.map((x) => ({ m: x.m, usd: Number(x.usd) || 0, calls: x.n }));
  return {
    data: { months, total: months.reduce((s, x) => s + x.usd, 0), calls: months.reduce((s, x) => s + x.calls, 0), byPurpose: P.map((x) => ({ purpose: x.p, usd: Number(x.usd) || 0, calls: x.n })).sort((a, b) => b.usd - a.usd) } as FrAiCost,
    links: [{ label: 'AI трошок', href: '/aiTrosok' }],
  };
}

/* ====================================================================================================== */
/* „💲 AI анализа“ state (app_settings — no migration)                                                     */
/* ====================================================================================================== */

export interface FirmReportAiState extends FrAiView {
  reqId: string;
  firmId: string;
  year: number;
  userId: string | null;
  /** What goes to the model (numbers + scrubbed findings) — kept until the answer is stored. */
  payload?: unknown;
}

export async function firmReportAiState(db: Tx, firmId: string, year: number): Promise<FirmReportAiState | null> {
  const [r] = await db.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, firmReportAiKey(firmId, year))).limit(1);
  return (r?.v as FirmReportAiState | undefined) ?? null;
}

/**
 * Queue the AI analysis of a computed report: the payload is the report's numbers and findings with every name the
 * firm's data holds (the firm, its partners and employees, the office users) and every identifier scrubbed
 * (`frAiPayload`). Returns the stored request (its `reqId` goes with the job).
 */
export async function queueFirmReportAi(db: Tx, R: FirmReport, userId: string | null): Promise<FirmReportAiState> {
  const [P, E, U] = await Promise.all([
    db.select({ n: partners.name }).from(partners).where(eq(partners.firmId, R.firm.id)),
    db.select({ n: employees.name }).from(employees).where(eq(employees.firmId, R.firm.id)),
    db.select({ n: users.name }).from(users),
  ]);
  const s: FirmReportAiState = {
    status: 'queued', reqId: crypto.randomUUID(), firmId: R.firm.id, year: R.year, userId, at: new Date().toISOString(),
    payload: frAiPayload(R, [...P, ...E, ...U].map((x) => x.n)),
  };
  await putFirmReportAiState(db, s);
  return s;
}

export async function putFirmReportAiState(db: Tx, s: FirmReportAiState): Promise<void> {
  const key = firmReportAiKey(s.firmId, s.year);
  await db.insert(appSettings).values({ key, value: s, updatedBy: s.userId }).onConflictDoUpdate({ target: appSettings.key, set: { value: s, updatedBy: s.userId } });
}
