/**
 * 🤖 WISE Робот — typed tools over the existing domain code (never free SQL from the model).
 *
 * FIRM ISOLATION: every tool reads the firm and year from `RobotCtx`, which the caller builds from the authenticated
 * request (web: `currentFirm` / `currentYear`; worker: the `robot_messages` row written by the web, re-checked with
 * `robotFirmAccess`). The input schemas have no firm / year field and `run` never reads one — an id the model invents
 * is simply ignored. Every query below filters by `c.firm.id`.
 *
 * READ-ONLY: the `propose_*` tools only insert a draft into `robot_proposals`; the human confirms it in the web app,
 * which then calls the module's existing server action.
 */
import { and, asc, between, desc, eq, ilike, inArray, isNotNull, lte, ne, or, sql } from 'drizzle-orm';
import { accountCard, periodDue, periodOf, periodsOfYear, trialBalance, type BbLevel, type LedgerLine } from '@wise/core';
import { iosStatement, partnerKontoCards } from '@wise/core/finance';
import { lagerRows, lagerSummary } from '@wise/core/stock-books';
import { complianceRows, ANNUAL_ACCOUNT_DAY, CASH_LIMIT_EUR, CASH_LIMIT_MONTH, CASH_LIMIT_SINGLE, CIT_ADVANCE_DAY, INVOICE_ISSUE_WORKDAYS, MIN_WAGE_LAW, MPIN_DAY, RETENTION, VAT_FILING_DAYS, VAT_MONTHLY_THRESHOLD, VAT_RATE_PERIODS, VAT_REGISTRATION_THRESHOLD } from '@wise/core/compliance';
import { LR_LAWS, LR_RULES, type LrLaw } from '@wise/core/law';
import { INSP } from '@wise/core/office/inspection';
import { addDays, alCompute, cashDays, dmy, fmtMk, type FirmSnapshot } from '@wise/core/office';
import { checkJournalProposal, normQ } from '@wise/core/robot';
import type { Tx } from '../audit';
import { complianceFacts, kontrolaDue } from '../compliance';
import { effectiveChart, loadLedgerLines } from '../ledger-queries';
import { lawReview } from '../lawrep';
import { buildFirmSnapshot } from '../office';
import { loadStockContext } from '../stock-service';
import { computeVatPeriod, firmVatPeriodKind } from '../vat-service';
import {
  bankStatements, employees, firmDeadlines, invoices, journalLines, journals, kontroli, lawChanges, partners, payrollRuns, purchases,
  robotProposals, vatPeriods, type Firm, type RobotProposalKind, type RobotSource,
} from '../schema/index';


export interface RobotCtx {
  db: Tx;
  /** The authenticated firm (never from model output). */
  firm: Firm;
  /** The authenticated working year. */
  year: number;
  userId: string;
  today: string;
}

export interface ToolOut {
  ok: boolean;
  /** Deterministic Macedonian summary (the free answer, and the text the model reads). */
  summary: string;
  data?: unknown;
  sources: RobotSource[];
  proposalId?: string;
}

export interface RobotToolDef {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  /** Creates a draft (proposal) — still nothing is executed. */
  proposal?: boolean;
  run(c: RobotCtx, input: Record<string, unknown>): Promise<ToolOut>;
}

/* ---------------- helpers ---------------- */

/** Owner-only screens (web `OWNER_VIEWS`): the robot never reports on them. */
export const ROBOT_OWNER_ONLY: readonly string[] = ['kdogovori', 'produktivnost', 'aiTrosok', 'uredi'];

const ISO = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');
const yFrom = (c: RobotCtx) => `${c.year}-01-01`;
const yTo = (c: RobotCtx) => `${c.year}-12-31`;
/** „As of“ date: today inside the working year, otherwise the year end. */
const asOf = (c: RobotCtx) => (c.today.slice(0, 4) === String(c.year) ? c.today : c.today < yFrom(c) ? yFrom(c) : yTo(c));
/** A date from the input clamped into the working year (default `d`). */
const dateIn = (c: RobotCtx, v: unknown, d: string): string => { const s = str(v, 10); return ISO.test(s) ? (s < yFrom(c) ? yFrom(c) : s > yTo(c) ? yTo(c) : s) : d; };
const den = (n: number) => `${fmtMk(n)} ден.`;
const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)] as [string, string]);
  return p.length ? '?' + new URLSearchParams(p).toString() : '';
};
const src = (label: string, href: string, tool?: string): RobotSource => ({ label, href, ...(tool ? { tool } : {}) });
const kontoCode = (v: unknown): string => { const s = str(v, 12).replace(/\s/g, ''); return /^\d{1,10}$/.test(s) ? s : ''; };
const like = (s: string) => `%${s.replace(/[%_\\]/g, (m) => '\\' + m)}%`;

async function ledgerOfYear(c: RobotCtx): Promise<LedgerLine[]> {
  return loadLedgerLines(c.db, c.firm.id, yFrom(c), yTo(c));
}
async function chartNames(c: RobotCtx): Promise<Map<string, string>> {
  return new Map((await effectiveChart(c.db, c.firm.id)).map((a) => [a.code, a.name]));
}

/** Partners of THIS firm matching a text (name / code / ЕДБ). */
async function findPartners(c: RobotCtx, text: string, limit = 6) {
  const t = text.trim();
  if (!t) return [];
  const exact = await c.db.select({ id: partners.id, name: partners.name, code: partners.code, edb: partners.edb, email: partners.email }).from(partners)
    .where(and(eq(partners.firmId, c.firm.id), or(eq(partners.code, t), eq(partners.edb, t), sql`lower(${partners.name}) = lower(${t})`))).limit(limit);
  if (exact.length) return exact;
  return c.db.select({ id: partners.id, name: partners.name, code: partners.code, edb: partners.edb, email: partners.email }).from(partners)
    .where(and(eq(partners.firmId, c.firm.id), or(ilike(partners.name, like(t)), ilike(partners.code, like(t)), ilike(partners.edb, like(t)))))
    .orderBy(asc(partners.name)).limit(limit);
}

/* ---------------- balances ---------------- */

const accountBalance: RobotToolDef = {
  name: 'account_balance',
  description: 'Салдо и промет на едно конто (со потконта) за период во работната година: почетно салдо, должи, побарува, крајно салдо и последните ставки. Аналитичка картица по конто.',
  input_schema: {
    type: 'object',
    properties: {
      konto: { type: 'string', description: 'Шифра на конто или почеток (пр. 1200, 120, 1020)' },
      from: { type: 'string', description: 'Од датум ГГГГ-ММ-ДД (стандардно 1 јануари)' },
      to: { type: 'string', description: 'До датум ГГГГ-ММ-ДД (стандардно денес / крај на година)' },
      partner: { type: 'string', description: 'Само ставки на овој комитент (назив, шифра или ЕДБ) – опционално' },
    },
    required: ['konto'],
  },
  async run(c, i) {
    const k = kontoCode(i.konto);
    if (!k) return { ok: false, summary: 'Внесете важечка шифра на конто (само цифри).', sources: [] };
    const from = dateIn(c, i.from, yFrom(c)), to = dateIn(c, i.to, asOf(c));
    let partnerId: string | null = null, pname = '';
    if (str(i.partner)) {
      const P = await findPartners(c, str(i.partner));
      if (P.length !== 1) return { ok: false, summary: P.length ? `Повеќе комитенти одговараат: ${P.map((p) => p.name).join('; ')}. Наведете поточно.` : `Нема комитент „${str(i.partner)}“ во оваа фирма.`, sources: [] };
      partnerId = P[0]!.id; pname = P[0]!.name;
    }
    const [L, names] = await Promise.all([ledgerOfYear(c), chartNames(c)]);
    const used = L.some((l) => String(l.account).startsWith(k));
    if (!names.has(k) && !used) return { ok: false, summary: `Контото ${k} не постои во контниот план на фирмата и нема книжења.`, sources: [] };
    const A = accountCard(L, { account: k, sub: true, from, to, partnerId });
    const last = A.rows.slice(-8).map((r) => ({ date: r.line.date, nalog: r.line.number, konto: r.line.account, opis: r.line.description ?? r.line.note ?? '', debit: r.line.debit, credit: r.line.credit, saldo: r.balance }));
    const name = names.get(k) ?? '';
    return {
      ok: true,
      summary: `Конто ${k}${name ? ` (${name})` : ''}${pname ? `, комитент ${pname}` : ''}, ${dmy(from)}–${dmy(to)}: почетно салдо ${den(A.opening)}, должи ${den(A.debit)}, побарува ${den(A.credit)}, крајно салдо ${den(A.closing)} (${A.rows.length} ставки).`,
      data: { konto: k, name, from, to, opening: A.opening, debit: A.debit, credit: A.credit, closing: A.closing, rows: A.rows.length, last },
      sources: [src(`Аналитичка картица по конто ${k}`, '/kkart' + qs({ k, sub: '1', from, to, p: partnerId ?? undefined }), 'account_balance')],
    };
  },
};

const LEVELS = new Set(['1', '2', '3', '4', '5', 'a']);
const trialBalanceTool: RobotToolDef = {
  name: 'trial_balance',
  description: 'Бруто биланс за период во работната година: почетна состојба, промет, вкупно и салдо по класа/група/синтетика/аналитика, опционално само за конта што почнуваат со дадена шифра.',
  input_schema: {
    type: 'object',
    properties: {
      konto: { type: 'string', description: 'Само конта што почнуваат со ова (пр. 4 за класа 4, 220)' },
      level: { type: 'string', enum: ['1', '2', '3', '4', '5', 'a'], description: '1=класи, 2=групи, 3=синтетики, a=аналитика (стандардно a ако е дадено конто, инаку 3)' },
      from: { type: 'string' }, to: { type: 'string' },
    },
  },
  async run(c, i) {
    const k = kontoCode(i.konto);
    const level = (LEVELS.has(str(i.level)) ? str(i.level) : k ? 'a' : '3') as BbLevel;
    const from = dateIn(c, i.from, yFrom(c)), to = dateIn(c, i.to, asOf(c));
    const [L, names] = await Promise.all([ledgerOfYear(c), chartNames(c)]);
    const T = trialBalance(L, { level, from: yFrom(c), to, accountName: (x) => names.get(x) });
    // the opening is the opening journal; turnover in [from, to] — `trialBalance` takes the year start to keep the opening
    const rows0 = from === yFrom(c) ? T.rows : trialBalance(L.filter((l) => l.kind === 'open' || l.date >= from), { level, from: yFrom(c), to, accountName: (x) => names.get(x) }).rows;
    const rows = rows0.filter((r) => !k || r.k.startsWith(k) || k.startsWith(r.k));
    const tot = rows.reduce((a, r) => ({ vd: a.vd + r.vd, vp: a.vp + r.vp, s: a.s + r.s }), { vd: 0, vp: 0, s: 0 });
    const R = rows.slice(0, 60).map((r) => ({ konto: r.k, name: r.name, opening_d: r.od, opening_p: r.op, debit: r.td, credit: r.tp, total_d: r.vd, total_p: r.vp, saldo: r.s }));
    return {
      ok: true,
      summary: `Бруто биланс ${dmy(from)}–${dmy(to)}${k ? `, конта ${k}…` : ''}: ${rows.length} редови, вкупно должи ${den(tot.vd)}, побарува ${den(tot.vp)}, салдо ${den(tot.s)}.${!k ? (T.balanced ? ' Билансот е изедначен.' : ` ⚠ Билансот НЕ е изедначен (должи ${den(T.total.vd)} ≠ побарува ${den(T.total.vp)}).`) : ''}${rows.length > 60 ? ' (прикажани првите 60)' : ''}`,
      data: { from, to, level, rows: R, total: { debit: +tot.vd.toFixed(2), credit: +tot.vp.toFixed(2), saldo: +tot.s.toFixed(2) }, balanced: T.balanced },
      sources: [src('Бруто биланс', '/bilanc' + qs({ lvl: level, from, to, q: k || undefined }), 'trial_balance')],
    };
  },
};

const partnerCard: RobotToolDef = {
  name: 'partner_card',
  description: 'Картица / ИОС на комитент (купувач или добавувач): салдо по конто 12x/22x и отворена состојба од главната книга.',
  input_schema: { type: 'object', properties: { partner: { type: 'string', description: 'Назив, шифра или ЕДБ на комитентот' } }, required: ['partner'] },
  async run(c, i) {
    const P = await findPartners(c, str(i.partner));
    if (!P.length) return { ok: false, summary: `Нема комитент „${str(i.partner)}“ во оваа фирма.`, sources: [] };
    if (P.length > 1) return { ok: false, summary: `Повеќе комитенти одговараат: ${P.map((p) => `${p.name}${p.code ? ` (${p.code})` : ''}`).join('; ')}. Наведете поточно.`, data: { candidates: P.map((p) => p.name) }, sources: [] };
    const p = P[0]!;
    const L = await ledgerOfYear(c);
    const to = asOf(c);
    const ios = iosStatement(L.filter((l) => l.date <= to), p.id);
    const cards = partnerKontoCards(L, p.id, { from: yFrom(c), to }).map((k) => ({ konto: k.k, opening: k.o, debit: k.td, credit: k.tp, saldo: k.end }));
    const side = ios.saldo > 0 ? 'во наша корист (тој ни должи)' : ios.saldo < 0 ? 'во негова корист (ние му должиме)' : 'нула';
    return {
      ok: true,
      summary: `${p.name}${p.edb ? ` (ЕДБ ${p.edb})` : ''}: ИОС салдо на ${dmy(to)} по 12x/22x = ${den(ios.saldo)} – ${side}. ${cards.map((k) => `Конто ${k.konto}: салдо ${den(k.saldo)}`).join('; ')}.`,
      data: { partner: p.name, edb: p.edb, asOf: to, iosSaldo: ios.saldo, kontos: cards },
      sources: [src(`Картица на ${p.name}`, '/kartici' + qs({ pid: p.id, from: yFrom(c), to }), 'partner_card'), src('Аналитика на партнери (ИОС)', '/analitika' + qs({ q: p.name }), 'partner_card')],
    };
  },
};

const cashBank: RobotToolDef = {
  name: 'cash_bank',
  description: 'Состојба на парични средства: салда на жиро сметки (100x) и благајна (102x) на денес, и денови кога благајната била во минус.',
  input_schema: { type: 'object', properties: {} },
  async run(c) {
    const [L, names] = await Promise.all([ledgerOfYear(c), chartNames(c)]);
    const to = asOf(c);
    const T = trialBalance(L, { level: 'a', from: yFrom(c), to, accountName: (x) => names.get(x) });
    const rows = T.rows.filter((r) => r.k.startsWith('10')).map((r) => ({ konto: r.k, name: r.name, saldo: r.s }));
    const st = (c.firm.settings ?? {}) as { kasaCash?: string };
    const cashK = [...new Set(['1020', st.kasaCash ?? '1020'])];
    const cd = cashDays({ ledger: L, cashAccounts: cashK, today: to } as unknown as FirmSnapshot, String(c.year));
    const bank = rows.filter((r) => r.konto.startsWith('100')).reduce((a, r) => a + r.saldo, 0);
    const cash = rows.filter((r) => r.konto.startsWith('102')).reduce((a, r) => a + r.saldo, 0);
    return {
      ok: true,
      summary: `Парични средства на ${dmy(to)}: жиро сметки (100x) ${den(bank)}, благајна (102x) ${den(cash)}.${rows.length ? ' ' + rows.map((r) => `${r.konto}${r.name ? ` ${r.name}` : ''}: ${den(r.saldo)}`).join('; ') + '.' : ''}${cd.firstNeg ? ` ⚠ Благајната била во минус: прв ден ${dmy(cd.firstNeg)}, најниско ${den(cd.minB)} на ${dmy(cd.minD!)}.` : ' Благајната не била во минус.'}`,
      data: { asOf: to, accounts: rows, bank: +bank.toFixed(2), cash: +cash.toFixed(2), cashNegative: cd.firstNeg ? { firstDay: cd.firstNeg, min: cd.minB, minDay: cd.minD } : null },
      sources: [src('Благајна', '/blagajna', 'cash_bank'), src('Изводи', '/banka', 'cash_bank'), src('Картица 1020', '/kkart' + qs({ k: '102', sub: '1', from: yFrom(c), to }), 'cash_bank')],
    };
  },
};

/* ---------------- VAT ---------------- */

const vatSummary: RobotToolDef = {
  name: 'vat_summary',
  description: 'ДДВ за период (месец ГГГГ-ММ или тримесечје ГГГГ-Т1..Т4): излезен и влезен ДДВ по стапка, обврска/побарување, рок, дали е поднесена/книжена, и проверка дали книгите за ДДВ се совпаѓаат со ДДВ контата во главната книга.',
  input_schema: { type: 'object', properties: { period: { type: 'string', description: 'ГГГГ-ММ или ГГГГ-Т1..Т4 (стандардно тековниот период)' } } },
  async run(c, i) {
    if (!c.firm.vatRegistered) return { ok: true, summary: 'Фирмата не е ДДВ обврзник – нема ДДВ-04.', sources: [src('Фирма', '/firmi', 'vat_summary')] };
    const kind = firmVatPeriodKind(c.firm);
    let p = str(i.period, 10).replace(/-[TТ]([1-4])$/i, '-Т$1');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p) && !/^\d{4}-Т[1-4]$/.test(p)) p = periodOf(asOf(c), kind);
    if (Number(p.slice(0, 4)) !== c.year) return { ok: false, summary: `Периодот ${p} не е во работната година ${c.year}. Сменете ја годината во програмата.`, sources: [] };
    const V = await computeVatPeriod(c.db, c.firm, p);
    const [row] = await c.db.select({ status: vatPeriods.status }).from(vatPeriods).where(and(eq(vatPeriods.firmId, c.firm.id), eq(vatPeriods.period, p))).limit(1);
    const R = V.result;
    const byRate = (o: Record<number, { b: number; v: number }>) => Object.entries(o).filter(([, x]) => x.b || x.v).map(([r, x]) => ({ rate: Number(r), base: x.b, vat: x.v }));
    const ledgerNet = V.close.diff;
    const diff = +(ledgerNet - R.net).toFixed(2);
    const match = Math.abs(diff) < 0.01;
    return {
      ok: true,
      summary: `ДДВ ${p} (${dmy(V.from)}–${dmy(V.to)}): излезен ДДВ ${den(R.outV)}, влезен ДДВ ${den(R.inV)}, ${R.net >= 0 ? `обврска ${den(R.net)}` : `побарување ${den(-R.net)}`}. Рок за ДДВ-04 и плаќање: ${dmy(V.due)}. Статус: ${row?.status === 'closed' ? 'поднесена и книжена' : 'не е затворена'}. ${match ? 'Книгите за ДДВ се совпаѓаат со ДДВ контата во главната книга.' : `⚠ Разлика меѓу книгите за ДДВ (${den(R.net)}) и ДДВ контата во главната книга (${den(ledgerNet)}): ${den(diff)}.`}`,
      data: { period: p, from: V.from, to: V.to, due: V.due, closed: row?.status === 'closed', out: byRate(R.out), in: byRate(R.in), outVat: R.outV, inVat: R.inV, net: R.net, ledgerNet, booksMatchLedger: match, difference: diff, ddv04: V.fields },
      sources: [src(`ДДВ-04 ${p}`, '/ddv' + qs({ p }), 'vat_summary'), src('Книги за ДДВ', '/ddvKnigi', 'vat_summary')],
    };
  },
};

/* ---------------- payroll ---------------- */

const payrollSummary: RobotToolDef = {
  name: 'payroll_summary',
  description: 'Пресметка на плата за месец (ГГГГ-ММ): бруто, нето, придонеси, данок, број на вработени и дали е книжена. Без месец – последниот пресметан месец во работната година.',
  input_schema: { type: 'object', properties: { month: { type: 'string', description: 'ГГГГ-ММ' } } },
  async run(c, i) {
    const m = str(i.month, 7);
    const cond = /^\d{4}-(0[1-9]|1[0-2])$/.test(m) && m.startsWith(String(c.year)) ? eq(payrollRuns.month, m) : sql`${payrollRuns.month} like ${String(c.year) + '-%'}`;
    const [r] = await c.db.select().from(payrollRuns).where(and(eq(payrollRuns.firmId, c.firm.id), cond)).orderBy(desc(payrollRuns.month)).limit(1);
    if (!r) return { ok: true, summary: `Нема пресметана плата${m ? ` за ${m}` : ` во ${c.year}`}.`, sources: [src('Пресметка на плата', '/plati', 'payroll_summary')] };
    const t = r.totals ?? {};
    const n = (k: string) => Number(t[k] ?? 0) || 0;
    return {
      ok: true,
      summary: `Плата ${r.month}: бруто ${den(n('gross'))}, нето ${den(n('net'))}, придонеси ${den(n('contr'))}, персонален данок ${den(n('tax'))}${n('emps') ? `, ${n('emps')} вработени` : ''}. ${r.status === 'posted' ? 'Книжена.' : 'Не е книжена (нацрт).'}${r.locked ? ' Месецот е заклучен.' : ''}`,
      data: { month: r.month, status: r.status, locked: r.locked, totals: t },
      sources: [src(`Плата ${r.month}`, '/plati', 'payroll_summary')],
    };
  },
};

/* ---------------- stock ---------------- */

const stockSummary: RobotToolDef = {
  name: 'stock_summary',
  description: 'Лагер: вкупна набавна вредност на залихите на датум и артикли со негативна (минус) залиха.',
  input_schema: { type: 'object', properties: { date: { type: 'string', description: 'ГГГГ-ММ-ДД (стандардно денес)' } } },
  async run(c, i) {
    const date = dateIn(c, i.date, asOf(c));
    const L = await loadStockContext(c.db, c.firm.id);
    const rows = lagerRows(L.ctx, { date, zero: false });
    if (!rows.length) return { ok: true, summary: `Нема залихи на ${dmy(date)} (нема артикли со количина).`, sources: [src('Лагер листа', '/g_lager' + qs({ d: date }), 'stock_summary')] };
    const S = lagerSummary(rows);
    const neg = rows.filter((r) => r.s.qty < -1e-9).map((r) => ({ code: r.item.code ?? '', name: r.item.name ?? '', qty: r.s.qty, wh: '' }));
    return {
      ok: true,
      summary: `Лагер на ${dmy(date)}: ${rows.length} артикли, набавна вредност ${den(Number(S.fin.st))}.${neg.length ? ` ⚠ ${neg.length} артикли со минус залиха: ${neg.slice(0, 8).map((x) => `${x.name} (${x.qty})`).join(', ')}${neg.length > 8 ? '…' : ''}.` : ' Нема минус залихи.'}`,
      data: { date, items: rows.length, value: Number(S.fin.st), negative: neg.slice(0, 30) },
      sources: [src('Лагер листа', '/g_lager' + qs({ d: date }), 'stock_summary')],
    };
  },
};

/* ---------------- deadlines ---------------- */

interface Dl { date: string; what: string; law?: string; href: string; overdue?: boolean }

const deadlinesTool: RobotToolDef = {
  name: 'deadlines',
  description: 'Даночни и законски рокови за оваа фирма во наредните N дена (ДДВ-04, МПИН, аконтација на данок на добивка, годишна сметка, рокови од досието, рокови по контроли) и пропуштени рокови.',
  input_schema: { type: 'object', properties: { days: { type: 'number', description: 'Број на денови напред (1–120, стандардно 14)' } } },
  async run(c, i) {
    const days = Math.max(1, Math.min(120, Math.round(Number(i.days) || 14)));
    const from = c.today, to = addDays(c.today, days);
    const inW = (d: string) => d >= from && d <= to;
    const out: Dl[] = [];
    const st = (c.firm.settings ?? {}) as { akontDD?: number | string };
    // VAT returns
    if (c.firm.vatRegistered) {
      const kind = firmVatPeriodKind(c.firm);
      const y0 = Number(from.slice(0, 4));
      const P = [...periodsOfYear(y0 - 1, kind), ...periodsOfYear(y0, kind), ...periodsOfYear(y0 + 1, kind)];
      const closed = new Set((await c.db.select({ p: vatPeriods.period }).from(vatPeriods).where(and(eq(vatPeriods.firmId, c.firm.id), eq(vatPeriods.status, 'closed')))).map((r) => r.p));
      for (const p of P) {
        const due = periodDue(p);
        if (closed.has(p)) continue;
        if (inW(due)) out.push({ date: due, what: `ДДВ-04 за ${p} – поднесување и плаќање`, law: VAT_FILING_DAYS.law, href: '/ddv' + qs({ p }) });
        else if (due < from && due >= addDays(from, -90)) out.push({ date: due, what: `ДДВ-04 за ${p} не е затворена во програмата (рокот поминал)`, law: VAT_FILING_DAYS.law, href: '/ddv' + qs({ p }), overdue: true });
      }
    }
    // monthly: МПИН (if the firm has employees), profit-tax advance (if set on the firm)
    const [emp] = await c.db.select({ n: sql<number>`count(*)::int` }).from(employees).where(and(eq(employees.firmId, c.firm.id), eq(employees.active, true)));
    const months: string[] = [];
    for (let d = from.slice(0, 7); d <= to.slice(0, 7); d = addDays(`${d}-28`, 7).slice(0, 7)) months.push(d);
    for (const m of months) {
      const mp = `${m}-${String(MPIN_DAY.value).padStart(2, '0')}`;
      if ((emp?.n ?? 0) > 0 && inW(mp)) out.push({ date: mp, what: 'МПИН за претходниот месец', law: MPIN_DAY.law, href: '/plati' });
      const ak = `${m}-${String(CIT_ADVANCE_DAY.value).padStart(2, '0')}`;
      if (Number(st.akontDD) > 0 && inW(ak)) out.push({ date: ak, what: `Аконтација на данок на добивка за претходниот месец (${den(Number(st.akontDD))} според поставките на фирмата)`, law: CIT_ADVANCE_DAY.law, href: '/ppNal' });
    }
    for (const y of [Number(from.slice(0, 4)), Number(to.slice(0, 4))]) {
      const d = `${y}-${ANNUAL_ACCOUNT_DAY}`;
      if (inW(d) && !out.some((x) => x.date === d && x.what.startsWith('Годишна'))) out.push({ date: d, what: `Годишна сметка за ${y - 1} (електронски)`, law: 'Закон за трговските друштва; Централен регистар', href: '/zsRok' });
    }
    // firm deadlines from the dossier
    const FD = await c.db.select().from(firmDeadlines).where(and(eq(firmDeadlines.firmId, c.firm.id), eq(firmDeadlines.done, false), lte(firmDeadlines.due, to))).orderBy(asc(firmDeadlines.due)).limit(30);
    for (const d of FD) out.push({ date: d.due, what: d.title, href: '/dosie', overdue: d.due < from });
    // inspection remedies
    const K = await c.db.select().from(kontroli).where(and(eq(kontroli.firmId, c.firm.id), ne(kontroli.status, 'closed'))).limit(20);
    for (const k of K) {
      const due = kontrolaDue(k);
      if (due && due <= to) out.push({ date: due, what: `Рок за правен лек по контрола (${k.auth.toUpperCase()} ${k.docNo ?? ''})`.trim(), href: '/kontroli', overdue: due < from });
    }
    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const fut = out.filter((x) => !x.overdue), late = out.filter((x) => x.overdue);
    const line = (x: Dl) => `${dmy(x.date)} – ${x.what}`;
    return {
      ok: true,
      summary: `${fut.length ? `Рокови од ${dmy(from)} до ${dmy(to)}: ${fut.map(line).join('; ')}.` : `Нема рокови од ${dmy(from)} до ${dmy(to)}.`}${late.length ? ` ⚠ Пропуштени/отворени: ${late.map(line).join('; ')}.` : ''}`,
      data: { from, to, deadlines: out },
      sources: [...new Map(out.map((x) => [x.href, src(x.href === '/dosie' ? 'Досие – рокови' : x.href.startsWith('/ddv') ? 'ДДВ-04' : x.href === '/plati' ? 'Плата / МПИН' : x.href === '/kontroli' ? 'Контроли' : x.href, x.href, 'deadlines')])).values()],
    };
  },
};

/* ---------------- health check ---------------- */

interface HFind { lvl: 'bad' | 'warn' | 'info'; area: string; txt: string; law?: string; href: string }

const healthCheck: RobotToolDef = {
  name: 'health_check',
  description: '„Провери ја фирмата“: ги пушта постоечките контроли (автопилот, даночен преглед според законите, законска усогласеност) и дополнителни проверки: неизедначени налози, дупли влезни фактури (ист добавувач + број), прескокнати броеви на фактури, готовина над законскиот лимит, неклижени изводи, благајна во минус.',
  input_schema: { type: 'object', properties: {} },
  async run(c) {
    const F: HFind[] = [];
    const failed: string[] = [];
    const today = asOf(c);
    const from = yFrom(c), to = yTo(c);
    // 1. autopilot findings (supplier/customer balances, invoice gaps, VAT, payroll, cash in the red, dossier, collection)
    try {
      const S = await buildFirmSnapshot(c.db, c.firm.id, { today });
      if (S) for (const f of alCompute(S)) F.push({ lvl: f.lvl, area: f.cat, txt: f.txt, href: '/' + f.go });
    } catch (e) { failed.push('автопилот: ' + (e as Error).message); }
    // 2. tax review by the laws (ЗДДВ / ЗДД / ЗПДД / ЗДП)
    try {
      const X = await lawReview(c.db, c.firm, c.year, today);
      for (const r of X.R) if (r.s === 'bad' || r.s === 'warn') F.push({ lvl: r.s, area: 'Даночен преглед', txt: `${r.r.t}: ${r.txt}`, law: `${LR_LAWS[r.r.law][0]} ${r.r.art}`, href: '/lawrep' });
    } catch (e) { failed.push('даночен преглед: ' + (e as Error).message); }
    // 3. legal compliance (cash limits, invoice numbering / elements, retention…)
    try {
      const CF = await complianceFacts(c.db, c.firm.id, c.year, today);
      if (CF) for (const r of complianceRows(CF)) if (r.s === 'bad' || r.s === 'warn') F.push({ lvl: r.s, area: r.area, txt: `${r.title}: ${r.txt}`, law: r.law, href: r.go ? '/' + r.go.replace(/^\//, '') : '/zakon' });
    } catch (e) { failed.push('законска усогласеност: ' + (e as Error).message); }
    // 4. unbalanced journals
    try {
      const U = await c.db.select({ number: journals.number, date: journals.date, d: sql<string>`sum(${journalLines.debit})`, p: sql<string>`sum(${journalLines.credit})` })
        .from(journals).innerJoin(journalLines, eq(journalLines.journalId, journals.id))
        .where(and(eq(journals.firmId, c.firm.id), between(journals.date, from, to)))
        .groupBy(journals.id, journals.number, journals.date)
        .having(sql`abs(sum(${journalLines.debit}) - sum(${journalLines.credit})) >= 0.01`).limit(20);
      for (const u of U) F.push({ lvl: 'bad', area: 'Налози', txt: `Налог ${u.number} од ${dmy(u.date)} не е изедначен: должи ${den(Number(u.d))}, побарува ${den(Number(u.p))}.`, href: '/nalozi' + qs({ n: u.number }) });
    } catch (e) { failed.push('неизедначени налози: ' + (e as Error).message); }
    // 5. duplicate purchase invoices (same supplier + number)
    try {
      const D = await c.db.select({ number: purchases.number, partnerId: purchases.partnerId, name: sql<string>`max(coalesce(${partners.name}, ${purchases.supplierName}, ''))`, n: sql<number>`count(*)::int` })
        .from(purchases).leftJoin(partners, eq(partners.id, purchases.partnerId))
        .where(and(eq(purchases.firmId, c.firm.id), between(purchases.date, from, to), ne(purchases.number, '')))
        .groupBy(purchases.partnerId, purchases.number).having(sql`count(*) > 1`).limit(20);
      for (const d of D) F.push({ lvl: 'bad', area: 'Влезни фактури', txt: `Дупла влезна фактура бр. ${d.number} од ${d.name || 'добавувач'} (${d.n} пати).`, href: '/vlez' + qs({ q: d.number }) });
    } catch (e) { failed.push('дупли фактури: ' + (e as Error).message); }
    // 6. bank statements not posted
    try {
      const B = await c.db.select({ date: bankStatements.date, number: bankStatements.number }).from(bankStatements)
        .where(and(eq(bankStatements.firmId, c.firm.id), eq(bankStatements.status, 'draft'), between(bankStatements.date, from, to))).orderBy(asc(bankStatements.date)).limit(50);
      if (B.length) F.push({ lvl: 'warn', area: 'Изводи', txt: `${B.length} изводи не се книжени (${B.slice(0, 6).map((b) => dmy(b.date)).join(', ')}${B.length > 6 ? '…' : ''}).`, href: '/banka' });
    } catch (e) { failed.push('изводи: ' + (e as Error).message); }
    const order = { bad: 0, warn: 1, info: 2 } as const;
    // the same text from two controls once; owner-only areas (accounting contracts, productivity, AI cost) are left out
    const seen = new Set<string>();
    const R = F.filter((f) => !ROBOT_OWNER_ONLY.some((v) => f.href === '/' + v || f.href.startsWith('/' + v + '?') || f.href.startsWith('/' + v + '#')))
      .filter((f) => (seen.has(f.txt) ? false : (seen.add(f.txt), true))).sort((a, b) => order[a.lvl] - order[b.lvl]);
    const bad = R.filter((f) => f.lvl === 'bad').length, warn = R.filter((f) => f.lvl === 'warn').length;
    const top = R.slice(0, 40);
    const mark = { bad: '⛔', warn: '⚠', info: 'ℹ' } as const;
    return {
      ok: true,
      summary: `Проверка на ${c.firm.name} (${c.year}): ${bad} критични, ${warn} предупредувања${R.length - bad - warn ? `, ${R.length - bad - warn} информации` : ''}.${top.length ? '\n' + top.slice(0, 15).map((f) => `${mark[f.lvl]} ${f.area}: ${f.txt}${f.law ? ` [${f.law}]` : ''}`).join('\n') : ' Не се пронајдени проблеми.'}${R.length > 15 ? `\n… уште ${R.length - 15}.` : ''}${failed.length ? `\n(Не успеа: ${failed.join('; ')})` : ''}`,
      data: { bad, warn, findings: top, failed },
      sources: [...new Map(top.map((f) => [f.href, src(f.area, f.href, 'health_check')])).values()].slice(0, 12),
    };
  },
};

/* ---------------- law ---------------- */

interface LawDoc { ref: string; title: string; text: string; href: string; url?: string }

const LR_SHORT: Record<LrLaw, string> = { zddv: 'ЗДДВ', zdd: 'ЗДД', zdld: 'ЗПДД', zdp: 'ЗДП' };
const PARAMS: [string, { law: string; value?: unknown }][] = [
  ['Праг за задолжителна регистрација за ДДВ', VAT_REGISTRATION_THRESHOLD], ['Месечен даночен период за ДДВ', VAT_MONTHLY_THRESHOLD],
  ['Рок за ДДВ-04 и плаќање на ДДВ', VAT_FILING_DAYS], ['Рок за издавање фактура', INVOICE_ISSUE_WORKDAYS],
  ['Готовинско плаќање – по плаќање', CASH_LIMIT_SINGLE], ['Готовинско плаќање – месечно', CASH_LIMIT_MONTH], ['Забрана за готовинско плаќање над 1.000 €', CASH_LIMIT_EUR],
  ['Аконтација на данок на добивка', CIT_ADVANCE_DAY], ['Рок за МПИН', MPIN_DAY], ['Минимална плата', { law: MIN_WAGE_LAW }],
];

/** The implemented law texts (rules, legal parameters, inspection checklist, retention), each with its article. */
function lawCorpus(): LawDoc[] {
  const D: LawDoc[] = [];
  for (const r of LR_RULES) D.push({ ref: `${LR_SHORT[r.law]} ${r.art} [${r.id}]`, title: r.t, text: `${LR_LAWS[r.law][0]} ${r.art} ${r.t}`, href: '/lawrep', url: LR_LAWS[r.law][1] });
  for (const [t, p] of PARAMS) D.push({ ref: p.law.split(' – ')[0]!, title: t, text: `${t} ${p.law}${p.value != null ? ` (вредност: ${p.value})` : ''}`, href: '/zakon' });
  for (const v of VAT_RATE_PERIODS) D.push({ ref: v.law, title: `ДДВ стапки од ${v.from}: ${v.rates.join('%, ')}%`, text: `ДДВ стапки ${v.rates.join(' ')} ${v.law}`, href: '/zakon' });
  for (const r of Object.values(RETENTION)) D.push({ ref: r.law.split(';')[0]!, title: `Чување: ${r.label}${r.years ? ` – ${r.years} години` : ' – трајно'}`, text: `чување архива рок ${r.label} ${r.law}`, href: '/zakon' });
  for (const x of INSP) if (typeof x.t === 'string') D.push({ ref: `${x.law} [${x.id}]`, title: x.t, text: `${x.t} ${x.law} ${x.ev}${x.fine ? ' казна ' + x.fine : ''}`, href: '/ujpZakoni' });
  return D;
}

const STOP = new Set(['што', 'вели', 'законот', 'закон', 'за', 'на', 'од', 'до', 'во', 'со', 'дали', 'како', 'кој', 'која', 'кое', 'кои', 'член', 'чл', 'има', 'треба', 'над', 'под', 'по', 'се', 'е', 'и', 'или', 'а']);
const stem = (w: string) => w.slice(0, Math.max(4, Math.ceil(w.length * 0.7)));

/** Score documents for a query (word stems + article numbers). Exported for tests. */
export function lawScore(D: readonly LawDoc[], q: string): (LawDoc & { score: number })[] {
  const s = normQ(q);
  const arts = [...s.matchAll(/(?:чл\.?|член)\s*(\d+(?:-[а-ш])?)/g)].map((m) => m[1]!);
  const words = s.replace(/[^\p{L}\d\s-]/gu, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)).map(stem);
  const nums = s.match(/\d[\d.]*/g)?.map((n) => n.replace(/\./g, '')) ?? [];
  return D.map((d) => {
    const t = normQ(d.text + ' ' + d.ref);
    let score = 0;
    for (const w of words) if (t.includes(w)) score += 1;
    for (const a of arts) if (new RegExp(`чл\\. ${a}(?![\\d])`).test(t)) score += 3;
    for (const n of nums) if (n.length >= 3 && t.replace(/\./g, '').includes(n)) score += 1;
    return { ...d, score };
  }).filter((d) => d.score > 0).sort((a, b) => b.score - a.score);
}

const lawSearch: RobotToolDef = {
  name: 'law_search',
  description: 'Пребарување во законите имплементирани во програмата (ЗДДВ, ЗДД, ЗПДД, ЗДП, готовински плаќања, архива, инспекциски обврски) и во законските промени што ги собира роботот. Враќа член/ознака (ref) што МОРА да се цитира.',
  input_schema: { type: 'object', properties: { q: { type: 'string', description: 'Прашање или клучни зборови (пр. „репрезентација ДДВ“, „чл. 51“)' } }, required: ['q'] },
  async run(c, i) {
    const q = str(i.q, 300);
    if (!q) return { ok: false, summary: 'Внесете прашање за законот.', sources: [] };
    const hits = lawScore(lawCorpus(), q).slice(0, 6);
    // law changes found by the daily law robot (text search)
    const words = normQ(q).split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)).slice(0, 5);
    const ch = words.length ? await c.db.select({ title: lawChanges.title, what: lawChanges.what, date: lawChanges.date, urls: lawChanges.urls, verified: lawChanges.verified }).from(lawChanges)
      .where(or(...words.map((w) => or(ilike(lawChanges.title, like(stem(w))), ilike(lawChanges.what, like(stem(w)))))))
      .orderBy(desc(lawChanges.date)).limit(4) : [];
    if (!hits.length && !ch.length) return { ok: true, summary: `Во имплементираните закони не е пронајдено ништо за „${q}“.`, data: { results: [] }, sources: [src('Законска усогласеност', '/zakon', 'law_search')] };
    return {
      ok: true,
      summary: [...hits.map((h) => `[${h.ref}] ${h.title}`), ...ch.map((x) => `[Законска промена ${x.date ?? ''}${x.verified ? '' : ', да се потврди'}] ${x.title}`)].join('\n'),
      data: { results: hits.map((h) => ({ ref: h.ref, title: h.title, text: h.text, url: h.url ?? null })), changes: ch },
      sources: [...new Map([...hits.map((h) => [h.href, src(h.href === '/lawrep' ? 'Даночен преглед (според законите)' : h.href === '/ujpZakoni' ? 'Закони на УЈП' : 'Законска усогласеност', h.href, 'law_search')] as const), ...(ch.length ? [['/zakoni', src('Законски промени', '/zakoni', 'law_search')] as const] : [])]).values()],
    };
  },
};

/* ---------------- find documents ---------------- */

const findDocuments: RobotToolDef = {
  name: 'find_documents',
  description: 'Најди документи во избраната фирма и година: излезни фактури, влезни фактури, налози и комитенти – по текст (број, назив, опис), износ и/или датум.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Број на документ, назив на комитент или текст од описот' },
      amount: { type: 'number', description: 'Точен износ (вкупно на фактура или износ на ставка од налог)' },
      dateFrom: { type: 'string' }, dateTo: { type: 'string' },
      kind: { type: 'string', enum: ['all', 'invoice', 'purchase', 'journal', 'partner'] },
    },
  },
  async run(c, i) {
    const t = str(i.text, 100);
    const a = Number(i.amount);
    const amt = Number.isFinite(a) && a !== 0 ? Math.abs(a) : null;
    const from = dateIn(c, i.dateFrom, yFrom(c)), to = dateIn(c, i.dateTo, yTo(c));
    const kind = ['invoice', 'purchase', 'journal', 'partner'].includes(str(i.kind)) ? str(i.kind) : 'all';
    if (!t && amt == null && !str(i.dateFrom) && !str(i.dateTo)) return { ok: false, summary: 'Наведете текст, износ или датум за пребарување.', sources: [] };
    const near = (col: Parameters<typeof between>[0]) => between(col, String(amt! - 0.01), String(amt! + 0.01));
    const out: Record<string, unknown[]> = {};
    const S: RobotSource[] = [];
    if (kind === 'all' || kind === 'invoice') {
      const R = await c.db.select({ number: invoices.number, date: invoices.date, kind: invoices.kind, total: invoices.total, partner: partners.name, status: invoices.status })
        .from(invoices).leftJoin(partners, eq(partners.id, invoices.partnerId))
        .where(and(eq(invoices.firmId, c.firm.id), between(invoices.date, from, to), t ? or(ilike(invoices.number, like(t)), ilike(partners.name, like(t)), ilike(invoices.note, like(t))) : undefined, amt != null ? near(invoices.total) : undefined))
        .orderBy(desc(invoices.date)).limit(10);
      out.invoices = R.map((r) => ({ ...r, total: Number(r.total) }));
      if (R.length) S.push(src('Излезни фактури', '/izlez' + qs({ q: t || undefined }), 'find_documents'));
    }
    if (kind === 'all' || kind === 'purchase') {
      const R = await c.db.select({ number: purchases.number, date: purchases.date, total: purchases.total, supplier: sql<string>`coalesce(${partners.name}, ${purchases.supplierName})`, status: purchases.status })
        .from(purchases).leftJoin(partners, eq(partners.id, purchases.partnerId))
        .where(and(eq(purchases.firmId, c.firm.id), between(purchases.date, from, to), t ? or(ilike(purchases.number, like(t)), ilike(partners.name, like(t)), ilike(purchases.supplierName, like(t))) : undefined, amt != null ? near(purchases.total) : undefined))
        .orderBy(desc(purchases.date)).limit(10);
      out.purchases = R.map((r) => ({ ...r, total: Number(r.total) }));
      if (R.length) S.push(src('Влезни фактури', '/vlez' + qs({ q: t || undefined }), 'find_documents'));
    }
    if (kind === 'all' || kind === 'journal') {
      const R = await c.db.selectDistinct({ id: journals.id, number: journals.number, date: journals.date, description: journals.description, kind: journals.kind })
        .from(journals).innerJoin(journalLines, eq(journalLines.journalId, journals.id))
        .where(and(eq(journals.firmId, c.firm.id), between(journals.date, from, to),
          t ? or(ilike(journals.number, like(t)), ilike(journals.description, like(t)), ilike(journalLines.doc, like(t)), ilike(journalLines.note, like(t))) : undefined,
          amt != null ? or(near(journalLines.debit), near(journalLines.credit)) : undefined))
        .orderBy(desc(journals.date)).limit(10);
      out.journals = R.map(({ id: _id, ...r }) => r);
      for (const r of R.slice(0, 3)) S.push(src(`Налог ${r.number}`, '/nalozi' + qs({ n: r.number }), 'find_documents'));
    }
    if ((kind === 'all' || kind === 'partner') && t) {
      const R = await findPartners(c, t, 8);
      out.partners = R.map((p) => ({ name: p.name, code: p.code, edb: p.edb }));
      if (R.length) S.push(src('Комитенти', '/partneri' + qs({ q: t }), 'find_documents'));
    }
    const n = Object.values(out).reduce((s, x) => s + x.length, 0);
    const label: Record<string, string> = { invoices: 'излезни фактури', purchases: 'влезни фактури', journals: 'налози', partners: 'комитенти' };
    return {
      ok: true,
      summary: n ? Object.entries(out).filter(([, x]) => x.length).map(([k, x]) => `${label[k]}: ${x.length}${x.length === 10 ? '+' : ''}`).join(', ') + '.' : 'Ништо не е пронајдено.',
      data: out,
      sources: S,
    };
  },
};

/* ---------------- proposals (drafts only) ---------------- */

async function saveProposal(c: RobotCtx, kind: RobotProposalKind, title: string, payload: Record<string, unknown>): Promise<string> {
  const [r] = await c.db.insert(robotProposals).values({ userId: c.userId, firmId: c.firm.id, year: c.year, kind, title: title.slice(0, 300), payload }).returning({ id: robotProposals.id });
  return r!.id;
}

const DRAFT_NOTE = 'Ова е само ПРЕДЛОГ – ништо не е книжено/испратено. Корисникот мора да кликне „✓ Потврди“.';

const proposeJournal: RobotToolDef = {
  name: 'propose_journal',
  proposal: true,
  description: 'Подготви ПРЕДЛОГ налог за книжење (не книжи!). Налогот мора да е изедначен, контата да постојат во контниот план, датумот да е во работната година; конта 120–128 / 220–228 бараат комитент. Предлогот се прикажува со „✓ Потврди / ✕ Откажи“.',
  input_schema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'ГГГГ-ММ-ДД' },
      description: { type: 'string' },
      lines: {
        type: 'array', minItems: 2, maxItems: 60,
        items: {
          type: 'object',
          properties: { konto: { type: 'string' }, debit: { type: 'number' }, credit: { type: 'number' }, partner: { type: 'string', description: 'Назив/шифра/ЕДБ на комитентот (за 12x/22x)' }, note: { type: 'string' } },
          required: ['konto'],
        },
      },
    },
    required: ['date', 'lines'],
  },
  async run(c, i) {
    const raw = Array.isArray(i.lines) ? (i.lines as Record<string, unknown>[]).slice(0, 60) : [];
    const errors: string[] = [];
    const lines: Record<string, unknown>[] = [];
    for (const [n, l] of raw.entries()) {
      let partnerId: string | null = null, partnerName: string | null = null;
      const pt = str(l?.partner);
      if (pt) {
        const P = await findPartners(c, pt, 3);
        if (P.length !== 1) errors.push(`Ред ${n + 1}: ${P.length ? `повеќе комитенти „${pt}“ (${P.map((p) => p.name).join('; ')})` : `нема комитент „${pt}“ во оваа фирма`}.`);
        else { partnerId = P[0]!.id; partnerName = P[0]!.name; }
      }
      lines.push({ konto: l?.konto, debit: l?.debit ?? 0, credit: l?.credit ?? 0, partnerId, partnerName, note: str(l?.note) });
    }
    const chart = new Set((await effectiveChart(c.db, c.firm.id)).map((a) => a.code));
    const chk = checkJournalProposal({ date: i.date, lines }, chart, c.year);
    const date = str(i.date, 10);
    if (c.firm.lockDate && ISO.test(date) && date <= c.firm.lockDate) errors.push(`Датумот ${dmy(date)} е во заклучен период (до ${dmy(c.firm.lockDate)}).`);
    const all = [...errors, ...chk.errors];
    if (all.length) return { ok: false, summary: 'Предлог-налогот е ОДБИЕН:\n' + all.join('\n'), data: { errors: all }, sources: [] };
    const description = str(i.description, 300) || 'Предлог од WISE Робот';
    const id = await saveProposal(c, 'journal', `Налог ${dmy(date)} – ${description}`, { date, description, lines: chk.lines });
    return {
      ok: true, proposalId: id,
      summary: `Предлог-налог подготвен (${chk.lines.length} редови, должи = побарува = ${den(chk.debit)}). ${DRAFT_NOTE}`,
      data: { proposalId: id, date, description, debit: chk.debit, credit: chk.credit, lines: chk.lines },
      sources: [src('Налози за книжење', '/nalozi', 'propose_journal')],
    };
  },
};

const proposeDunning: RobotToolDef = {
  name: 'propose_dunning',
  proposal: true,
  description: 'Подготви ПРЕДЛОГ опомена за купувачи со отворено салдо (12x) и фактури со поминат рок. Не праќа ништо: по потврда се отвора екранот „Опомени“ со тие фактури, каде човекот ја печати/праќа.',
  input_schema: { type: 'object', properties: { partner: { type: 'string', description: 'Само за овој купувач (опционално)' } } },
  async run(c, i) {
    const to = asOf(c);
    let only: { id: string; name: string }[] | null = null;
    if (str(i.partner)) {
      const P = await findPartners(c, str(i.partner), 3);
      if (P.length !== 1) return { ok: false, summary: P.length ? `Повеќе купувачи: ${P.map((p) => p.name).join('; ')}.` : `Нема купувач „${str(i.partner)}“.`, sources: [] };
      only = P;
    }
    const L = (await ledgerOfYear(c)).filter((l) => /^12[0-8]/.test(String(l.account)) && l.partnerId && l.date <= to && (!only || l.partnerId === only[0]!.id));
    const bal = new Map<string, number>();
    for (const l of L) bal.set(l.partnerId!, (bal.get(l.partnerId!) ?? 0) + l.debit - l.credit);
    const pos = [...bal].filter(([, s]) => s > 0.009);
    if (!pos.length) return { ok: true, summary: 'Нема купувачи со отворено салдо на 12x.', sources: [src('Опомени', '/opomeni', 'propose_dunning')] };
    const ids = pos.map(([p]) => p);
    const inv = await c.db.select({ id: invoices.id, number: invoices.number, partnerId: invoices.partnerId, due: invoices.due, date: invoices.date })
      .from(invoices).where(and(eq(invoices.firmId, c.firm.id), eq(invoices.kind, 'invoice'), eq(invoices.status, 'posted'), inArray(invoices.partnerId, ids), isNotNull(invoices.due), sql`${invoices.due} < ${to}`))
      .orderBy(asc(invoices.due)).limit(300);
    const names = new Map((await c.db.select({ id: partners.id, name: partners.name }).from(partners).where(and(eq(partners.firmId, c.firm.id), inArray(partners.id, ids)))).map((p) => [p.id, p.name]));
    const G = pos.map(([pid, s]) => ({ partnerId: pid, name: names.get(pid) ?? '', saldo: +s.toFixed(2), invoices: inv.filter((x) => x.partnerId === pid).map((x) => ({ id: x.id, number: x.number, due: x.due })) }))
      .filter((g) => g.invoices.length).sort((a, b) => b.saldo - a.saldo).slice(0, 15);
    if (!G.length) return { ok: true, summary: 'Купувачите со отворено салдо немаат фактури со поминат рок на плаќање.', sources: [src('Опомени', '/opomeni', 'propose_dunning')] };
    const id = await saveProposal(c, 'dunning', `Опомени за ${G.length} купувачи`, { partners: G, asOf: to });
    return {
      ok: true, proposalId: id,
      summary: `Предлог-опомена за ${G.length} купувачи со доспеани фактури: ${G.slice(0, 8).map((g) => `${g.name} (салдо ${den(g.saldo)}, ${g.invoices.length} фактури)`).join('; ')}. ${DRAFT_NOTE}`,
      data: { proposalId: id, partners: G.map((g) => ({ name: g.name, saldo: g.saldo, overdueInvoices: g.invoices.map((x) => `${x.number} (рок ${x.due})`) })) },
      sources: [src('Опомени', '/opomeni', 'propose_dunning')],
    };
  },
};

const proposeTask: RobotToolDef = {
  name: 'propose_task',
  proposal: true,
  description: 'Подготви ПРЕДЛОГ задача во канцеларијата (Мои задачи / Канцеларија) за оваа фирма. Не ја креира додека човекот не потврди.',
  input_schema: { type: 'object', properties: { title: { type: 'string' }, due: { type: 'string', description: 'ГГГГ-ММ-ДД (опционално)' }, description: { type: 'string' } }, required: ['title'] },
  async run(c, i) {
    const title = str(i.title, 200);
    if (!title) return { ok: false, summary: 'Задачата нема наслов.', sources: [] };
    const due = str(i.due, 10);
    if (due && (!ISO.test(due) || due < c.today)) return { ok: false, summary: 'Рокот на задачата мора да е важечки датум од денес натаму.', sources: [] };
    const id = await saveProposal(c, 'task', `Задача: ${title}`, { title, due: due || null, description: str(i.description, 2000) });
    return { ok: true, proposalId: id, summary: `Предлог-задача „${title}“${due ? ` со рок ${dmy(due)}` : ''}. ${DRAFT_NOTE}`, data: { proposalId: id }, sources: [src('Канцеларија – задачи', '/kanc', 'propose_task')] };
  },
};

const proposeReminder: RobotToolDef = {
  name: 'propose_reminder',
  proposal: true,
  description: 'Подготви ПРЕДЛОГ потсетник/рок во досието на фирмата (потсетникот се појавува N дена пред рокот). Не го зачувува додека човекот не потврди.',
  input_schema: { type: 'object', properties: { title: { type: 'string' }, due: { type: 'string', description: 'ГГГГ-ММ-ДД' }, remindDays: { type: 'number', description: 'Денови пред рокот (стандардно 7)' }, note: { type: 'string' } }, required: ['title', 'due'] },
  async run(c, i) {
    const title = str(i.title, 200), due = str(i.due, 10);
    if (!title || !ISO.test(due) || due < c.today) return { ok: false, summary: 'Потсетникот бара наслов и рок (важечки датум од денес натаму).', sources: [] };
    const remindDays = Math.max(0, Math.min(365, Math.round(Number(i.remindDays) || 7)));
    const id = await saveProposal(c, 'reminder', `Потсетник: ${title}`, { title, due, remindDays, note: str(i.note, 1000) });
    return { ok: true, proposalId: id, summary: `Предлог-потсетник „${title}“, рок ${dmy(due)}, потсетување ${remindDays} дена пред. ${DRAFT_NOTE}`, data: { proposalId: id }, sources: [src('Досие – рокови', '/dosie', 'propose_reminder')] };
  },
};

/* ---------------- registry ---------------- */

export const ROBOT_TOOLS: readonly RobotToolDef[] = [
  accountBalance, trialBalanceTool, partnerCard, cashBank, vatSummary, payrollSummary, stockSummary, deadlinesTool, healthCheck,
  lawSearch, findDocuments, proposeJournal, proposeDunning, proposeTask, proposeReminder,
];

export const robotTool = (name: string): RobotToolDef | undefined => ROBOT_TOOLS.find((t) => t.name === name);

/** Keys the model must never set (a firm / year / user comes only from the context) — dropped before `run`. */
const CONTEXT_KEYS = new Set(['firmId', 'firm_id', 'firm', 'year', 'userId', 'user_id', 'tenant']);

/** Run one tool for the context's firm; errors become a failed result (the loop goes on). */
export async function runRobotTool(c: RobotCtx, name: string, input: unknown): Promise<ToolOut> {
  const t = robotTool(name);
  if (!t) return { ok: false, summary: `Непозната алатка „${name}“.`, sources: [] };
  const clean: Record<string, unknown> = {};
  if (input && typeof input === 'object' && !Array.isArray(input)) for (const [k, v] of Object.entries(input)) if (!CONTEXT_KEYS.has(k)) clean[k] = v;
  try {
    const out = await t.run(c, clean);
    return { ...out, summary: out.summary.replace(/ден\.\./g, 'ден.') };
  } catch (e) {
    return { ok: false, summary: `Алатката „${name}“ не успеа: ${(e as Error).message || e}`, sources: [] };
  }
}

/** Tool definitions for the Anthropic API (the last one carries the cache breakpoint). */
export function robotToolSpecs(): { name: string; description: string; input_schema: RobotToolDef['input_schema'] }[] {
  return ROBOT_TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
}

