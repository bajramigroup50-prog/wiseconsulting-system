/**
 * Notifications + autopilot checks — legacy `alCompute` (8494 → 15278), `apExtra` / `apRisk` (16242–16290).
 *
 * Pure: everything is read from a `FirmSnapshot`. Data owned by other phases (invoices, payroll, fiscal
 * reports, VAT closes) is optional — `null` means "not available", and the check is skipped instead of
 * raising a false alarm. FIX(#10): legacy swapped the global `S.data`/`S.fid`/`S.year` (`alWith`) to evaluate
 * another firm; here every firm is an explicit argument.
 */
import { r2 } from '../money';
import type { LedgerLine } from '../ledger';
import { PP_TAX } from '../bank/pp';
import { addMonths, daysBetween, dmy, fmtMk, ymAdd } from './dates';

/** Legacy `AL_DDV_LIMIT`: VAT registration threshold (denars). */
export const AL_DDV_LIMIT = 2_000_000;
/** Legacy `AP_CASH_LIMIT` ≈ 1.000 € (FIX(#18): derived from the office EUR rate, default 61.5). */
export const apCashLimit = (eurRate = 61.5) => Math.round(1000 * eurRate);

export const AL_CATS = ['Изводи', 'Влезни фактури', 'Излезни фактури', 'ДДВ', 'Плати', 'Благајна', 'Залиха', 'Документи', 'Наплата', 'Фискални'] as const;

export const AL_DESC: Record<string, string> = {
  'Изводи': 'Броевите на изводите одат по ред; месец без извод; последниот извод постар од 35 дена.',
  'Влезни фактури': 'На добавувачот му е платено повеќе отколку што има внесени фактури → недостасува фактура.',
  'Излезни фактури': 'Прескокнати броеви на излезни фактури. Купувачот уплатил, а нема излезна фактура (аванс или незаведена фактура).',
  'ДДВ': 'ДДВ-04 некнижена по рокот; фирма без ДДВ со промет над 2.000.000 ден. (или над 80%).',
  'Плати': 'По 15-ти во месецот, а платата за претходниот месец не е пресметана (ако има вработени).',
  'Благајна': 'Салдото на 1020 е во минус; готовински плаќања над 1.000 €.',
  'Залиха': 'Артикли со негативна количина – продадено повеќе од примено.',
  'Документи': 'Документи во досието со „Важи до“ истечено или истекува за 30 дена; документи од клиентот што чекаат одобрување.',
  'Наплата': 'Излезни фактури ненаплатени повеќе од 90 дена по валута.',
};

export type FindingLvl = 'bad' | 'warn' | 'info';
export interface Finding { lvl: FindingLvl; cat: string; txt: string; go: string; key: string }
export interface ClientMessage { type: 'inv' | 'out' | 'cash' | 'izv' | 'vat'; key: string; subj: string; body: string }

export interface SnapshotInvoice { number: string; date: string; due?: string | null; credit?: boolean; advance?: boolean; total: number; paid: number }
export interface SnapshotEmployee { name: string; active: boolean }
/**
 * VAT due for one period (same shape as `@wise/db` `VatDueEstimate`, computed by the VAT module): `period` is
 * `YYYY-MM` / `YYYY-Тq`, `amount` the VAT payable (negative = refund) — for a period still running, the estimate
 * to its end — `due` the payment deadline and `closed` whether its ДДВ-04 is posted.
 */
export interface SnapshotVatEstimate { period: string; from: string; to: string; due: string; amount: number; closed: boolean }

export interface FirmSnapshot {
  firm: {
    id: string; name: string; short?: string | null; vatRegistered: boolean; vatPeriod?: 'month' | 'quarter';
    nkd?: string | null; alOff?: Record<string, boolean>; alAck?: Record<string, string>;
    /** Monthly profit-tax advance (legacy `f.akontDD`) and municipality code for the ПП50 account (`settings.muni`). */
    akontDD?: number | null; muni?: string | null;
  };
  today: string;
  /** Ledger lines of the current year (journal_lines ⋈ journals). */
  ledger: readonly LedgerLine[];
  partnerNames: Readonly<Record<string, string>>;
  dossier: readonly { category: string; title?: string | null; validTo?: string | null }[];
  /** Client entries + client inbox messages awaiting the office. */
  pendingClient: number;
  /** Cash accounts (legacy `1020` + `sch('kasaCash')`). */
  cashAccounts?: readonly string[];
  /** Phase 3 — issued invoices of the year (null = not available). */
  invoices?: readonly SnapshotInvoice[] | null;
  /** Phase 6 — employees and computed payroll months `YYYY-MM` (null = not available). */
  employees?: readonly SnapshotEmployee[] | null;
  payrollMonths?: readonly string[] | null;
  /** Phase 5 — VAT periods whose ДДВ-04 is posted, as period start dates (null = not available). */
  vatClosedPeriods?: readonly string[] | null;
  /** Phase 7 — dates with a fiscal Z report (null = not available). */
  fiscalDays?: readonly string[] | null;
  /** Phase 5 — VAT due estimate (null = not available / not a VAT payer). */
  vatEstimate?: SnapshotVatEstimate | null;
  /** Office EUR rate (default 61.5). */
  eurRate?: number;
  /** Signature used in client messages. */
  officeName?: string;
}

const isCash = (S: FirmSnapshot) => { const K = new Set(S.cashAccounts?.length ? S.cashAccounts : ['1020']); return (l: LedgerLine) => K.has(String(l.account)); };

/** Per-partner balances (debit − credit) on 12x / 22x. */
function partnerBalances(L: readonly LedgerLine[]) {
  const by = new Map<string, { p: string; t: '12' | '22'; s: number }>();
  for (const l of L) {
    if (!l.partnerId) continue;
    const t = String(l.account).slice(0, 2);
    if (t !== '12' && t !== '22') continue;
    const k = `${l.partnerId}|${t}`;
    const o = by.get(k) ?? { p: l.partnerId, t, s: 0 };
    o.s = r2(o.s + l.debit - l.credit);
    by.set(k, o);
  }
  return [...by.values()];
}

/** Daily running cash balance: first negative day and the minimum. */
export function cashDays(S: FirmSnapshot, year = S.today.slice(0, 4)) {
  const cash = isCash(S);
  const days = new Map<string, number>();
  for (const l of S.ledger) if (cash(l) && l.date.startsWith(year)) days.set(l.date, (days.get(l.date) ?? 0) + l.debit - l.credit);
  let bal = 0, firstNeg: string | null = null, minB = 0, minD: string | null = null;
  const out: [string, number][] = [];
  for (const d of [...days.keys()].sort()) {
    bal = r2(bal + days.get(d)!);
    out.push([d, bal]);
    if (bal < -1 && !firstNeg) firstNeg = d;
    if (bal < minB) { minB = bal; minD = d; }
  }
  return { days: out, bal, firstNeg, minB, minD };
}

/** Legacy `periodOf`/`perRange` for VAT: start and end of the period that contains `d`. */
export function vatPeriodRange(d: string, per: 'month' | 'quarter' = 'quarter'): [string, string] {
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
  const m0 = per === 'month' ? m : Math.floor((m - 1) / 3) * 3 + 1;
  const a = `${y}-${String(m0).padStart(2, '0')}-01`;
  const b = addMonths(a, per === 'month' ? 1 : 3);
  return [a, ymdMinus1(b)];
}
const ymdMinus1 = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };

/** Numbering gaps per series (legacy 2б: `^(\D*)(\d+)`, at least 3 invoices in the series). */
export function invoiceGaps(I: readonly SnapshotInvoice[], year: string): [string, number[]][] {
  const ser = new Map<string, number[]>();
  for (const i of I) {
    if (i.credit || i.advance || !i.date.startsWith(year)) continue;
    const m = /^(\D*)(\d+)/.exec(String(i.number ?? ''));
    if (!m) continue;
    const k = m[1]!.trim().toUpperCase();
    ser.set(k, [...(ser.get(k) ?? []), Number(m[2])]);
  }
  const out: [string, number[]][] = [];
  for (const [k, N] of ser) {
    if (N.length < 3) continue;
    const u = [...new Set(N)].sort((a, b) => a - b);
    const miss: number[] = [];
    for (let i = 1; i < u.length; i++) for (let n = u[i - 1]! + 1; n < u[i]! && miss.length < 40; n++) miss.push(n);
    if (miss.length) out.push([k, miss]);
  }
  return out;
}

/** Legacy `alCompute`: findings for one firm. Disabled categories (`alOff`) are dropped; acknowledged ones flagged by the caller. */
export function alCompute(S: FirmSnapshot): Finding[] {
  const A: Finding[] = [];
  const off = S.firm.alOff ?? {};
  const add = (lvl: FindingLvl, cat: string, txt: string, go: string) => { if (!off[cat]) A.push({ lvl, cat, txt, go, key: `${cat}|${txt}` }); };
  const td = S.today, y = td.slice(0, 4);
  const L = S.ledger.filter((l) => l.date.startsWith(y));
  const pn = (id: string, d: string) => S.partnerNames[id] ?? d;

  if (S.pendingClient) add('warn', 'Документи', `${S.pendingClient} документи/пораки од клиентот чекаат преглед и одобрување`, 'klInbox');

  /* 2. suppliers with a debit balance = paid without an invoice; customers with a credit balance */
  const PB = partnerBalances(L);
  const sup = PB.filter((o) => o.t === '22' && o.s > 1).sort((a, b) => b.s - a.s);
  for (const o of sup.slice(0, 10)) add('bad', 'Влезни фактури', `Недостасува влезна фактура: платено ${fmtMk(o.s)} ден. повеќе од фактурираното – ${pn(o.p, 'добавувач')}`, 'vlez');
  if (sup.length > 10) add('bad', 'Влезни фактури', `Уште ${sup.length - 10} добавувачи со платено без фактура`, 'vlez');
  const cus = PB.filter((o) => o.t === '12' && o.s < -1).sort((a, b) => a.s - b.s);
  for (const o of cus.slice(0, 5)) add('warn', 'Излезни фактури', `Примена уплата ${fmtMk(-o.s)} ден. без излезна фактура (аванс?) – ${pn(o.p, 'купувач')}`, 'izlez');

  /* 2б. invoice numbering gaps */
  if (S.invoices) for (const [k, miss] of invoiceGaps(S.invoices, y))
    add('bad', 'Излезни фактури', `Недостасуваат излезни фактури ${k ? `(серија ${k}) ` : ''}бр. ${miss.slice(0, 15).join(', ')}${miss.length > 15 ? '…' : ''} – прескокнат број или незаведена фактура.`, 'izlez');

  /* 3. VAT registration threshold */
  if (!S.firm.vatRegistered) {
    const rev = r2(L.filter((l) => /^7[4-6]/.test(l.account)).reduce((a, l) => a + l.credit - l.debit, 0));
    if (rev >= AL_DDV_LIMIT) add('bad', 'ДДВ', `Промет ${fmtMk(rev)} ден. во ${y} – над 2.000.000 ден. Фирмата треба да се регистрира за ДДВ – проверете го рокот со УЈП.`, 'firmi');
    else if (rev >= AL_DDV_LIMIT * 0.8) add('warn', 'ДДВ', `Промет ${fmtMk(rev)} ден. во ${y} – ${Math.round((rev / AL_DDV_LIMIT) * 100)}% од прагот од 2.000.000 ден. за ДДВ.`, 'firmi');
  }

  /* 4. previous VAT return not posted 25 days after the period */
  if (S.firm.vatRegistered && S.vatClosedPeriods) {
    const per = S.firm.vatPeriod ?? 'quarter';
    const [a, b] = vatPeriodRange(`${ymAdd(td.slice(0, 7), per === 'month' ? -1 : -3)}-15`, per);
    const due = new Date(`${b}T12:00:00Z`); due.setUTCDate(due.getUTCDate() + 25);
    const dueS = due.toISOString().slice(0, 10);
    const active = L.some((l) => l.date >= a && l.date <= b);
    if (td > dueS && active && !S.vatClosedPeriods.includes(a)) add('warn', 'ДДВ', `ДДВ-04 за ${dmy(a)} – ${dmy(b)} не е книжена (рок ${dmy(dueS)}).`, 'ddv');
  }

  /* 5. payroll for the previous month not computed after the 15th */
  if (S.employees && S.payrollMonths) {
    const act = S.employees.filter((e) => e.active);
    if (act.length && Number(td.slice(8, 10)) >= 15) {
      const pm = ymAdd(td.slice(0, 7), -1);
      if (!S.payrollMonths.includes(pm)) add('warn', 'Плати', `Платата за ${pm.split('-').reverse().join('/')} не е пресметана (${act.length} вработени).`, 'plati');
    }
  }

  /* 6. cash in the red */
  const cash = isCash(S);
  const cashBal = r2(S.ledger.filter(cash).reduce((a, l) => a + l.debit - l.credit, 0));
  if (cashBal < -1) add('bad', 'Благајна', `Благајната (1020) е во минус: ${fmtMk(cashBal)} ден.`, 'blagajna');

  /* 8. dossier documents that expire */
  for (const d of S.dossier) {
    if (!d.validTo) continue;
    const n = daysBetween(td, d.validTo);
    const t = d.title || d.category;
    if (n < 0) add('bad', 'Документи', `Истечено: ${t} (на ${dmy(d.validTo)})`, 'dosie');
    else if (n <= 30) add('warn', 'Документи', `Истекува за ${n} дена: ${t} (${dmy(d.validTo)})`, 'dosie');
  }

  /* 9. unpaid invoices more than 90 days after due date */
  if (S.invoices) {
    const old = S.invoices.filter((i) => !i.credit && i.due && daysBetween(i.due, td) > 90).map((i) => r2(i.total - i.paid)).filter((r) => r > 1);
    if (old.length) add('info', 'Наплата', `${old.length} фактури ненаплатени над 90 дена по валута – вкупно ${fmtMk(old.reduce((a, x) => a + x, 0))} ден.`, 'analitika');
  }
  return A;
}

export interface ApExtra { adds: Finding[]; msgs: ClientMessage[]; m: Record<string, number | string | null> }

/** Legacy `apExtra`: extra autopilot checks + messages to the client. */
export function apExtra(S: FirmSnapshot): ApExtra {
  const X: ApExtra = { adds: [], msgs: [], m: {} };
  const td = S.today, y = td.slice(0, 4), mo = td.slice(0, 7);
  const off = S.firm.alOff ?? {};
  const add = (lvl: FindingLvl, cat: string, txt: string, go: string) => { if (!off[cat]) X.adds.push({ lvl, cat, txt, go, key: `ap|${cat}|${txt}` }); };
  const fname = S.firm.short || S.firm.name;
  const hello = 'Почитувани,\n\n', sign = `\n\nСо почит,\n${S.officeName || 'Канцеларија'}`;
  const pn = (id: string, d: string) => S.partnerNames[id] ?? d;

  /* 1. cash: daily balance */
  const C = cashDays(S, y);
  X.m.cash = C.bal;
  if (C.firstNeg) {
    add('bad', 'Благајна', `Благајната е во минус од ${dmy(C.firstNeg)} (најниско ${fmtMk(C.minB)} ден. на ${dmy(C.minD)}) – недостасуваат дневни фискални извештаи (Z) или уплати во благајна.`, 'blagajna');
    const noZ = S.fiscalDays && !S.fiscalDays.some((d) => d.startsWith(y));
    X.msgs.push({
      type: 'cash', key: `cash|${S.firm.id}|${mo}`, subj: `Недостасуваат документи за благајна – ${fname}`,
      body: `${hello}Благајната на ${fname} во книгите е во минус од ${dmy(C.firstNeg)} (најниско ${fmtMk(C.minB)} ден. на ${dmy(C.minD)}). Тоа значи дека недостасуваат дневни фискални извештаи (Z), уплатници во благајна или документи за подигнати пари од банка.\n\nВе молиме испратете ги:\n– дневните фискални извештаи од ${dmy(C.firstNeg)} наваму${noZ ? ' (нема ниту еден внесен оваа година)' : ''}\n– уплатници/исплатници за благајна\n\nМожете да ги сликате и испратите преку порталот.${sign}`,
    });
  }

  /* 1б. working days without a Z report (current and previous month, Sundays excluded) */
  if (S.fiscalDays?.length) {
    const have = new Set(S.fiscalDays);
    const first = [...S.fiscalDays].sort()[0]!;
    const from = [`${ymAdd(mo, -1)}-01`, first].sort().pop()!;
    const miss: string[] = [];
    for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) < td; d.setUTCDate(d.getUTCDate() + 1)) {
      const s = d.toISOString().slice(0, 10);
      if (d.getUTCDay() === 0 || have.has(s)) continue;
      miss.push(s);
    }
    X.m.zMiss = miss.length;
    if (miss.length >= 3) add('warn', 'Фискални', `${miss.length} работни дена без дневен фискален извештај (${miss.slice(0, 6).map(dmy).join(', ')}${miss.length > 6 ? '…' : ''}) – ако фирмата работела, недостасуваат Z извештаи.`, 'fiskPer');
  }

  /* 1в. cash payments over 1.000 € (ЗСППФТ) */
  const lim = apCashLimit(S.eurRate);
  const cash = isCash(S);
  const big = S.ledger.filter((l) => cash(l) && l.date.startsWith(y) && l.partnerId && Math.max(l.debit, l.credit) >= lim);
  if (big.length) add('bad', 'Благајна', `${big.length} готовински плаќања/наплати над 1.000 € (${big.slice(0, 3).map((l) => `${dmy(l.date)} ${fmtMk(Math.max(l.debit, l.credit))}`).join('; ')}) – забрането по ЗСППФТ; проверете.`, 'blagajna');

  /* 2. suppliers paid without invoice; 2б. customer payments without invoice → messages */
  const PB = partnerBalances(S.ledger.filter((l) => l.date.startsWith(y)));
  const sup = PB.filter((o) => o.t === '22' && o.s > 1).sort((a, b) => b.s - a.s).map((o) => ({ n: pn(o.p, 'добавувач'), s: o.s }));
  X.m.missInv = sup.length;
  if (sup.length) X.msgs.push({
    type: 'inv', key: `inv|${S.firm.id}|${mo}|${sup.length}`, subj: `Недостасуваат влезни фактури – ${fname}`,
    body: `${hello}Во изводите на ${fname} има плаќања кон добавувачи за кои немаме фактура:\n\n${sup.slice(0, 25).map((x, i) => `${i + 1}. ${x.n} – ${fmtMk(x.s)} ден.`).join('\n')}${sup.length > 25 ? `\n… и уште ${sup.length - 25}` : ''}\n\nВе молиме испратете ги фактурите (слика или PDF преку порталот). Без нив трошокот и ДДВ не можат да се признаат.${sign}`,
  });
  const cus = PB.filter((o) => o.t === '12' && o.s < -1).sort((a, b) => a.s - b.s).map((o) => ({ n: pn(o.p, 'купувач'), s: r2(-o.s) }));
  X.m.missOut = cus.length;
  if (cus.length) X.msgs.push({
    type: 'out', key: `out|${S.firm.id}|${mo}|${cus.length}`, subj: `Уплати без излезна фактура – ${fname}`,
    body: `${hello}Во изводите на ${fname} има примени уплати од купувачи за кои немаме излезна фактура:\n\n${cus.slice(0, 25).map((x, i) => `${i + 1}. ${x.n} – ${fmtMk(x.s)} ден.`).join('\n')}${cus.length > 25 ? `\n… и уште ${cus.length - 25}` : ''}\n\nВе молиме испратете ги издадените фактури (или потврдете дали станува збор за аванс – тогаш ќе издадеме авансна фактура). Без фактура приходот и ДДВ не можат правилно да се пријават.${sign}`,
  });
  /* 4. VAT: amount due / estimate for the period, deadline, ПП50 data; monthly profit-tax advance */
  const E = S.firm.vatRegistered ? S.vatEstimate : null;
  if (E) {
    X.m.vatEst = r2(E.amount);
    const lbl = E.period.replace('-Т', ' – квартал ');
    const left = daysBetween(td, E.due);
    const lines: string[] = [];
    if (E.to < td) {
      // ended period: the amount to pay (legacy "ДДВ за <prev>")
      if (E.amount > 0 && left >= 0) {
        const T = PP_TAX.find((x) => x[4] === 'period');
        lines.push(`ДДВ за ${lbl}: ${fmtMk(E.amount)} ден., рок за плаќање ${dmy(E.due)} (уште ${left} дена).${T ? `\nУплатна сметка: ${T[2].replace('XXX', S.firm.muni || 'XXX')} · приходна шифра ${T[3]} · повикување ${E.period.replace('-Т', '-')}` : ''}`);
      }
    } else {
      lines.push(`ДДВ за тековниот период (${lbl}): проценка до крајот на периодот околу ${fmtMk(Math.max(0, E.amount))} ден., рок ${dmy(E.due)}.`);
    }
    if (lines.length && Number(S.firm.akontDD) > 0) lines.push(`Аконтација данок на добивка: ${fmtMk(Number(S.firm.akontDD))} ден. месечно, рок до 15-ти.`);
    if (lines.length) X.msgs.push({
      type: 'vat', key: `vat|${S.firm.id}|${E.period}|${mo}`, subj: `Даноци што доаѓаат – ${fname}`,
      body: `${hello}Ве известуваме однапред за обврските на ${fname}:\n\n${lines.map((x) => `• ${x}`).join('\n\n')}\n\nПроценката се менува со новите фактури. Платниот налог (ПП50) можеме да го подготвиме ние.${sign}`,
    });
  }

  /* 5. metrics for the peer comparison */
  const Y = S.ledger.filter((l) => l.date.startsWith(y));
  const sum = (re: RegExp, sg: number) => r2(Y.filter((l) => re.test(l.account)).reduce((a, l) => a + sg * (l.debit - l.credit), 0));
  const rev = sum(/^7[4-6]/, -1), cogs = sum(/^70/, 1), exp = sum(/^4/, 1), gross = sum(/^42/, 1);
  const cashIn = r2(Y.filter(cash).reduce((a, l) => a + l.debit, 0));
  const emp = S.employees ? S.employees.filter((e) => e.active).length : 0;
  const months = Math.max(1, Number(td.slice(5, 7)));
  Object.assign(X.m, {
    rev,
    margin: rev > 0 && cogs > 0 ? r2(((rev - cogs) / rev) * 100) : null,
    expR: rev > 0 ? r2(((exp + cogs) / rev) * 100) : null,
    cashR: rev > 0 ? r2((cashIn / rev) * 100) : null,
    sal: emp && gross > 0 ? r2(gross / emp / months) : null,
    emp,
    nkd: /\d{2}/.exec(String(S.firm.nkd ?? ''))?.[0] ?? '',
  });
  return X;
}

export interface RiskResult { score: number; why: string[]; peers: number }

/** Legacy `apRisk`: inspection risk score vs. anonymous peers with the same NKD division. */
export function apRisk(rows: readonly { id: string; m: ApExtra['m'] }[]): Map<string, RiskResult> {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const G = new Map<string, typeof rows[number][]>();
  for (const r of rows) { const k = String(r.m.nkd ?? ''); if (!k || !((num(r.m.rev) ?? 0) > 0)) continue; G.set(k, [...(G.get(k) ?? []), r]); }
  const med = (a: (number | null)[]) => {
    const v = a.filter((x): x is number => x != null).sort((x, y) => x - y);
    if (!v.length) return null;
    const i = Math.floor(v.length / 2);
    return v.length % 2 ? v[i]! : (v[i - 1]! + v[i]!) / 2;
  };
  const out = new Map<string, RiskResult>();
  for (const r of rows) {
    const R: RiskResult = { score: 0, why: [], peers: 0 };
    out.set(r.id, R);
    const m = { rev: num(r.m.rev) ?? 0, margin: num(r.m.margin), sal: num(r.m.sal), cashR: num(r.m.cashR), expR: num(r.m.expR), emp: num(r.m.emp) ?? 0 };
    const P = (G.get(String(r.m.nkd ?? '')) ?? []).filter((x) => x !== r);
    R.peers = P.length;
    if (!(m.rev > 0)) continue;
    const add = (w: number, t: string) => { R.score += w; R.why.push(t); };
    if (m.expR != null && m.expR > 100) add(25, `загуба: трошоци ${fmtMk(m.expR)}% од приходите`);
    if (m.cashR != null && m.cashR > 60) add(10, `многу готовина: ${fmtMk(m.cashR)}% од прометот`);
    if (P.length >= 3) {
      const M = med(P.map((x) => num(x.m.margin))), S2 = med(P.map((x) => num(x.m.sal))), C = med(P.map((x) => num(x.m.cashR))), E = med(P.map((x) => num(x.m.expR)));
      if (m.margin != null && M != null && M > 10 && m.margin < M * 0.5) add(30, `маржа ${fmtMk(m.margin)}% наспроти ${fmtMk(M)}% кај сличните`);
      if (m.sal != null && S2 != null && S2 > 0 && m.sal < S2 * 0.7) add(20, `просечна бруто плата ${fmtMk(m.sal)} наспроти ${fmtMk(S2)} ден. кај сличните`);
      if (m.cashR != null && C != null && m.cashR > C * 1.5 && m.cashR > 30) add(15, `удел на готовина ${fmtMk(m.cashR)}% наспроти ${fmtMk(C)}%`);
      if (m.expR != null && E != null && m.expR > E * 1.25 && m.expR > 90) add(15, `трошоци ${fmtMk(m.expR)}% од приходите наспроти ${fmtMk(E)}%`);
    }
    if (m.emp === 0 && m.rev > 6_000_000) add(10, `промет ${fmtMk(m.rev)} ден. без ниту еден вработен`);
    R.score = Math.min(100, R.score);
  }
  return out;
}

/** Legacy `apHash` (FNV-1a, base 36) — stable short key for the sent-message log. */
export const apHash = (s: string) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h.toString(36); };
